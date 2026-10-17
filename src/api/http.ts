/**
 * Cliente HTTP de SICIL.
 *
 * - Sesión por cookies HttpOnly (`credentials: 'same-origin'`); el código nunca toca tokens (RS-SES-02)
 * - Envía el token anti-CSRF en toda petición que cambia estado (RS-WEB-02)
 * - Envía Idempotency-Key en operaciones que mueven inventario (RS-TRX-07)
 * - Renueva el token de acceso una sola vez por expiración y reintenta (RS-SES-01)
 * - Traduce errores a ApiError con el código de correlación para soporte (RS-WEB-04)
 */
import { CONFIG } from '@/config/env';

export interface DetalleError {
  campo: string;
  mensaje: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    message: string,
    public readonly idCorrelacion: string | null = null,
    public readonly detalles: DetalleError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Errores de un campo concreto, para mostrarlos junto al control del formulario */
  erroresPorCampo(): Record<string, string> {
    return Object.fromEntries(this.detalles.map((d) => [d.campo, d.mensaje]));
  }
}

export interface OpcionesSolicitud {
  query?: Record<string, string | number | boolean | null | undefined>;
  cuerpo?: unknown;
  idempotencia?: string;
  senal?: AbortSignal;
  /** No intentar renovar la sesión (lo usan las propias rutas de autenticación) */
  sinRenovar?: boolean;
}

interface RespuestaCruda {
  status: number;
  cuerpo: unknown;
  encabezados: Record<string, string>;
}

type Evento = 'sesion-terminada' | 'cambio-password';
const oyentes = new Map<Evento, Set<(mensaje: string) => void>>();

export function escuchar(evento: Evento, fn: (mensaje: string) => void): () => void {
  if (!oyentes.has(evento)) oyentes.set(evento, new Set());
  oyentes.get(evento)!.add(fn);
  return () => oyentes.get(evento)?.delete(fn);
}

function emitir(evento: Evento, mensaje: string) {
  oyentes.get(evento)?.forEach((fn) => fn(mensaje));
}

/* ───────────── Transporte ───────────── */

type ServidorMockTipo = import('./mock/servidor').ServidorMock;
let servidorMock: Promise<ServidorMockTipo> | null = null;

/** Solo pruebas: permite inyectar un servidor simulado con reloj o latencia controlados. */
export function usarServidorMock(s: ServidorMockTipo | null): void {
  servidorMock = s ? Promise.resolve(s) : null;
  csrf = null;
}

/** Constante en compilación: con VITE_API_MODE=real el mock no entra al bundle de producción. */
const MOCK_HABILITADO = import.meta.env.VITE_API_MODE !== 'real';

async function obtenerServidorMock(): Promise<ServidorMockTipo> {
  if (!MOCK_HABILITADO) throw new Error('El backend simulado está deshabilitado en este build.');
  servidorMock ??= import('./mock/servidor').then(({ ServidorMock }) => new ServidorMock());
  return servidorMock;
}

function cadenaQuery(query?: OpcionesSolicitud['query']): URLSearchParams {
  const qs = new URLSearchParams();
  Object.entries(query ?? {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  return qs;
}

async function transporte(
  metodo: string,
  ruta: string,
  qs: URLSearchParams,
  cuerpo: unknown,
  encabezados: Record<string, string>,
  senal?: AbortSignal,
): Promise<RespuestaCruda> {
  if (MOCK_HABILITADO && CONFIG.modoApi === 'mock') {
    const s = await obtenerServidorMock();
    const enc = Object.fromEntries(Object.entries(encabezados).map(([k, v]) => [k.toLowerCase(), v]));
    // Ida y vuelta por JSON: el mock recibe exactamente lo que recibiría el backend
    const r = await s.manejar({
      metodo,
      ruta,
      query: qs,
      cuerpo: cuerpo === undefined ? undefined : JSON.parse(JSON.stringify(cuerpo)),
      encabezados: enc,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'pruebas',
    });
    return { ...r, cuerpo: r.cuerpo == null ? null : JSON.parse(JSON.stringify(r.cuerpo)) };
  }

  const url = `${CONFIG.apiBase}${ruta}${qs.toString() ? `?${qs}` : ''}`;
  const tiempo = AbortSignal.timeout(CONFIG.timeoutMs);
  const resp = await fetch(url, {
    method: metodo,
    headers: { Accept: 'application/json', ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...encabezados },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'strict-origin-when-cross-origin',
    signal: senal ? AbortSignal.any([senal, tiempo]) : tiempo,
  });
  const tipo = resp.headers.get('content-type') ?? '';
  const datos = resp.status === 204 ? null : tipo.includes('application/json') ? await resp.json() : null;
  return { status: resp.status, cuerpo: datos, encabezados: { 'x-correlation-id': resp.headers.get('x-correlation-id') ?? '' } };
}

/* ───────────── CSRF y renovación ───────────── */

let csrf: string | null = null;
let renovacion: Promise<boolean> | null = null;

async function asegurarCsrf(forzar = false): Promise<string> {
  if (csrf && !forzar) return csrf;
  const r = await transporte('GET', '/auth/csrf', new URLSearchParams(), undefined, {});
  const token = (r.cuerpo as { token?: string } | null)?.token;
  if (r.status !== 200 || !token) throw new ApiError(r.status, 'CSRF_NO_DISPONIBLE', 'No se pudo iniciar una conexión segura con el servidor.');
  csrf = token;
  return token;
}

export function olvidarCsrf(): void {
  csrf = null;
}

async function renovarSesion(): Promise<boolean> {
  // Una sola renovación en curso aunque varias peticiones expiren a la vez
  renovacion ??= (async () => {
    try {
      let r = await transporte('POST', '/auth/refresh', new URLSearchParams(), {}, { 'X-CSRF-Token': await asegurarCsrf() });
      if (r.status === 403 && (r.cuerpo as { codigo?: string } | null)?.codigo === 'CSRF_INVALIDO') {
        r = await transporte('POST', '/auth/refresh', new URLSearchParams(), {}, { 'X-CSRF-Token': await asegurarCsrf(true) });
      }
      return r.status >= 200 && r.status < 300;
    } catch {
      return false;
    } finally {
      setTimeout(() => {
        renovacion = null;
      }, 0);
    }
  })();
  return renovacion;
}

/* ───────────── Solicitud ───────────── */

const CODIGOS_SESION = new Set(['SESION_EXPIRADA', 'SESION_INVALIDA', 'NO_AUTENTICADO']);

function aError(r: RespuestaCruda): ApiError {
  const c = (r.cuerpo ?? {}) as { codigo?: string; mensaje?: string; idCorrelacion?: string; detalles?: DetalleError[] };
  const mensajes: Record<number, string> = {
    400: 'La petición no es válida.',
    403: 'No tienes permiso para esta operación.',
    404: 'No se encontró lo que buscas.',
    409: 'La información cambió; recarga e inténtalo de nuevo.',
    429: 'Demasiadas peticiones. Espera un momento.',
    500: 'Ocurrió un error en el servidor.',
  };
  return new ApiError(
    r.status,
    c.codigo ?? `HTTP_${r.status}`,
    c.mensaje ?? mensajes[r.status] ?? 'No se pudo completar la operación.',
    c.idCorrelacion ?? r.encabezados['x-correlation-id'] ?? null,
    Array.isArray(c.detalles) ? c.detalles : [],
  );
}

export async function solicitar<T>(metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', ruta: string, op: OpcionesSolicitud = {}): Promise<T> {
  const qs = cadenaQuery(op.query);
  const ejecutar = async (): Promise<RespuestaCruda> => {
    const enc: Record<string, string> = { 'X-Requested-With': 'SICIL' };
    if (metodo !== 'GET') enc['X-CSRF-Token'] = await asegurarCsrf();
    if (op.idempotencia) enc['Idempotency-Key'] = op.idempotencia;
    return transporte(metodo, ruta, qs, op.cuerpo, enc, op.senal);
  };

  let r: RespuestaCruda;
  try {
    r = await ejecutar();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof DOMException && (e.name === 'AbortError' || e.name === 'TimeoutError')) {
      throw new ApiError(0, 'TIEMPO_AGOTADO', 'El servidor tardó demasiado en responder. Revisa tu conexión e inténtalo de nuevo.');
    }
    throw new ApiError(0, 'SIN_CONEXION', 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.');
  }

  const codigo = (r.cuerpo as { codigo?: string } | null)?.codigo;

  if (r.status === 403 && codigo === 'CSRF_INVALIDO') {
    csrf = null;
    r = await ejecutar();
  } else if (r.status === 401 && codigo === 'TOKEN_EXPIRADO' && !op.sinRenovar) {
    if (await renovarSesion()) r = await ejecutar();
  }

  if (r.status >= 200 && r.status < 300) {
    // El servidor rota el token anti-CSRF al autenticar o cerrar sesión: se descarta el anterior
    if (ruta === '/auth/login' || ruta === '/auth/mfa' || ruta === '/auth/logout') csrf = null;
    return r.cuerpo as T;
  }

  const error = aError(r);
  if (r.status === 401 && !op.sinRenovar && (CODIGOS_SESION.has(error.codigo) || error.codigo === 'TOKEN_EXPIRADO')) {
    csrf = null;
    emitir('sesion-terminada', error.message);
  }
  if (r.status === 403 && error.codigo === 'CAMBIO_PASSWORD_REQUERIDO') emitir('cambio-password', error.message);
  throw error;
}
