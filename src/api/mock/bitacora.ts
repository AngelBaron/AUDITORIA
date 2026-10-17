/**
 * Bitácora de auditoría del mock (ERS sección 8).
 * - Solo se agregan eventos (append-only): no existe función para editar ni borrar.
 * - Cada evento se encadena con SHA-256: hashActual = SHA256(hashAnterior + contenido canónico).
 * - Se escriben en la misma "transacción" que el cambio de negocio (RA-LOG-03).
 */
import type { AlmacenClave, EventoBitacora, ResultadoEvento, RolClave, Severidad, VerificacionCadena } from '@/api/types';
import { sha256Hex } from '@/domain/seguridad';

export const HASH_GENESIS = '0'.repeat(64);

export interface EventoPendiente {
  fechaHoraUtc: string;
  usuarioId: string | null;
  usuarioNombre: string;
  rolesActivos: RolClave[];
  ipOrigen: string;
  userAgent: string;
  idSesionHash: string | null;
  idCorrelacion: string;
  accion: string;
  entidad: string;
  idEntidad: string | null;
  folio: string | null;
  almacen: AlmacenClave | 'TRANSITO' | null;
  valorAnterior: Record<string, unknown> | null;
  valorNuevo: Record<string, unknown> | null;
  resultado: ResultadoEvento;
  motivoRechazo: string | null;
  severidad: Severidad;
}

const CAMPOS_PROHIBIDOS = /password|contrasena|contraseña|token|pin|secreto|csrf|refresh/i;

/** RA-LOG-05 y RA-LOG-11: sin secretos, sin caracteres de control, correos enmascarados. */
export function sanearDetalle(valor: unknown, profundidad = 0): unknown {
  if (profundidad > 4) return '[…]';
  if (typeof valor === 'string') {
    // eslint-disable-next-line no-control-regex
    const limpio = valor.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 500);
    return limpio.replace(/([A-Za-z0-9._%+-]{1,2})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+)/g, '$1***@$2');
  }
  if (Array.isArray(valor)) return valor.slice(0, 50).map((v) => sanearDetalle(v, profundidad + 1));
  if (valor && typeof valor === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) {
      salida[k] = CAMPOS_PROHIBIDOS.test(k) ? '[omitido]' : sanearDetalle(v, profundidad + 1);
    }
    return salida;
  }
  return valor;
}

/** Representación canónica (claves ordenadas) para que el hash sea reproducible. */
export function canonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  const obj = valor as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(obj[k])}`)
    .join(',')}}`;
}

function contenidoParaHash(e: Omit<EventoBitacora, 'hashActual'>): string {
  const { hashAnterior, ...resto } = e;
  return hashAnterior + canonico(resto);
}

export async function sellarEventos(bitacora: EventoBitacora[], pendientes: EventoPendiente[]): Promise<EventoBitacora[]> {
  const sellados: EventoBitacora[] = [];
  let anterior = bitacora.at(-1)?.hashActual ?? HASH_GENESIS;
  let id = (bitacora.at(-1)?.id ?? 0) + 1;
  for (const p of pendientes) {
    const base: Omit<EventoBitacora, 'hashActual'> = {
      id,
      uuid: crypto.randomUUID(),
      ...p,
      valorAnterior: (sanearDetalle(p.valorAnterior) as Record<string, unknown> | null) ?? null,
      valorNuevo: (sanearDetalle(p.valorNuevo) as Record<string, unknown> | null) ?? null,
      motivoRechazo: p.motivoRechazo ? String(sanearDetalle(p.motivoRechazo)) : null,
      hashAnterior: anterior,
    };
    const hashActual = await sha256Hex(contenidoParaHash(base));
    const evento: EventoBitacora = Object.freeze({ ...base, hashActual }) as EventoBitacora;
    sellados.push(evento);
    anterior = hashActual;
    id += 1;
  }
  return sellados;
}

/** RA-LOG-02: recorre la cadena y reporta el primer eslabón roto. */
export async function verificarCadena(bitacora: readonly EventoBitacora[]): Promise<VerificacionCadena> {
  let anterior = HASH_GENESIS;
  for (const e of bitacora) {
    const { hashActual, ...resto } = e;
    if (resto.hashAnterior !== anterior) {
      return { integra: false, eventosVerificados: e.id - 1, primerEslabonRoto: e.id, verificadoEn: new Date().toISOString() };
    }
    const calculado = await sha256Hex(contenidoParaHash(resto));
    if (calculado !== hashActual) {
      return { integra: false, eventosVerificados: e.id - 1, primerEslabonRoto: e.id, verificadoEn: new Date().toISOString() };
    }
    anterior = hashActual;
  }
  return { integra: true, eventosVerificados: bitacora.length, primerEslabonRoto: null, verificadoEn: new Date().toISOString() };
}
