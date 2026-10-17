/**
 * Autenticación y sesiones del mock (ERS sección 10).
 * - Mensaje de error genérico, bloqueo tras 5 intentos (RS-AUT-03)
 * - MFA TOTP para roles que aprueban o administran (RS-AUT-04)
 * - Sesión con acceso de 15 min y renovación rotada; reuso de renovación revoca la sesión (RS-SES-01)
 * - Máximo 2 sesiones, revocación al cambiar contraseña (RS-SES-04, RS-SES-06)
 */
import type { RespuestaLogin, SesionActiva, UsuarioSesion } from '@/api/types';
import { evaluarPassword, igualSeguro } from '@/domain/seguridad';
import { ErrorApi, type Ctx, type Motor } from './motor';
import { nuevoId, type SesionDB, type UsuarioDB } from './estado';
import { DEMO_TOTP } from './semilla';

const MIN = 60 * 1000;
export const ACCESO_MS = 15 * MIN;
export const RENOVACION_MS = 8 * 60 * MIN;
const MENSAJE_GENERICO = 'Usuario o contraseña incorrectos. Después de 5 intentos fallidos la cuenta se bloquea 15 minutos.';

function token(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function vistaSesion(m: Motor, u: UsuarioDB, s: SesionDB, ahora: Date): UsuarioSesion {
  return {
    id: u.id,
    nombre: u.nombre,
    correo: u.correo,
    numEmpleado: u.numEmpleado,
    puesto: u.puesto,
    centroCosto: u.centroCosto,
    roles: m.asignacionesVigentes(u.id, ahora).map((a) => ({ id: a.id, rol: a.rol, almacenes: a.almacenes })),
    permisos: m.permisosDe(u.id, ahora),
    almacenes: m.almacenesDe(u.id, ahora),
    mfaActivo: u.mfaActivo,
    debeCambiarPassword: u.debeCambiarPassword,
    ultimoAccesoExitoso: u.ultimoAccesoAnterior,
    intentosFallidosDesdeUltimo: u.fallidosDesdeUltimoAcceso,
    sesionExpiraEn: new Date(Math.min(s.renovacionExpira, s.ultimaActividad + m.parametro('minutos_inactividad') * MIN)).toISOString(),
  };
}

function limitarPorIp(m: Motor, ctx: Ctx): void {
  const ahora = ctx.ahora.getTime();
  const lista = (m.db.t.intentosLoginPorIp[ctx.ip] ?? []).filter((t) => ahora - t < MIN);
  lista.push(ahora);
  m.db.t.intentosLoginPorIp[ctx.ip] = lista;
  if (lista.length > 10) {
    throw new ErrorApi(429, 'DEMASIADAS_PETICIONES', 'Demasiados intentos desde esta red. Espera un minuto e inténtalo de nuevo.');
  }
}

function crearSesion(m: Motor, ctx: Ctx, u: UsuarioDB): SesionDB {
  const ahora = ctx.ahora.getTime();
  // RS-SES-04: máximo 2 sesiones simultáneas, se revoca la más antigua
  const activas = m.db.t.sesiones.filter((s) => s.usuarioId === u.id && !s.revocada && s.renovacionExpira > ahora);
  activas
    .sort((a, b) => a.ultimaActividad - b.ultimaActividad)
    .slice(0, Math.max(0, activas.length - 1))
    .forEach((s) => {
      s.revocada = true;
    });
  const s: SesionDB = {
    id: nuevoId('ses'), // RS-SES-05: identificador nuevo en cada inicio de sesión
    usuarioId: u.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    creada: ctx.ahora.toISOString(),
    ultimaActividad: ahora,
    accesoExpira: ahora + ACCESO_MS,
    renovacionExpira: ahora + RENOVACION_MS,
    refresh: token(),
    refreshUsados: [],
    revocada: false,
  };
  m.db.t.sesiones.push(s);
  u.fallidosDesdeUltimoAcceso = u.fallidosPendientes;
  u.fallidosPendientes = 0;
  u.intentosFallidos = 0;
  u.bloqueadoHasta = null;
  const previo = u.ultimoAcceso;
  u.ultimoAccesoAnterior = previo;
  u.ultimoAcceso = ctx.ahora.toISOString();
  const ctxU = { ...ctx, usuario: u, sesion: s };
  m.evento(ctxU, {
    accion: 'LOGIN_EXITOSO',
    entidad: 'sesion',
    idEntidad: s.id.slice(-12),
    valorNuevo: { accesoAnterior: previo, sesionesRevocadasPorLimite: Math.max(0, activas.length - 1) },
  });
  return s;
}

type ResultadoLogin = { tipo: 'ok'; respuesta: RespuestaLogin; sesion: SesionDB | null } | { tipo: 'error'; error: ErrorApi };

export async function login(
  m: Motor,
  ctx: Ctx,
  correo: string,
  password: string,
): Promise<{ respuesta: RespuestaLogin; sesion: SesionDB | null }> {
  // El límite por IP vive fuera de la transacción para que un rollback no lo reinicie (RS-WEB-03)
  try {
    limitarPorIp(m, ctx);
  } catch (e) {
    await m.registrarSuelto(ctx, { accion: 'LOGIN', entidad: 'sesion', resultado: 'RECHAZADO', motivoRechazo: 'LIMITE_PETICIONES', severidad: 'ALTA' });
    throw e;
  }
  const r = await m.transaccion<ResultadoLogin>(ctx, { accion: 'LOGIN', entidad: 'sesion' }, () => {
    const u = m.db.t.usuarios.find((x) => x.correo.toLowerCase() === String(correo).trim().toLowerCase());
    const ahora = ctx.ahora.getTime();
    // Los fallos se confirman (no rollback) para conservar intentos y bitácora; el cliente
    // siempre recibe el mismo mensaje sin importar la causa.
    const fallo = (motivo: string, usuario?: UsuarioDB): ResultadoLogin => {
      m.evento(
        { ...ctx, usuario: usuario ?? null },
        {
          accion: 'LOGIN_FALLIDO',
          entidad: 'sesion',
          resultado: 'RECHAZADO',
          motivoRechazo: motivo,
          severidad: 'MEDIA',
          usuarioNombre: usuario?.nombre ?? `Intento con usuario "${String(correo).slice(0, 60)}"`,
        },
      );
      return { tipo: 'error', error: new ErrorApi(401, 'CREDENCIALES_INVALIDAS', MENSAJE_GENERICO) };
    };

    if (!u) return fallo('USUARIO_INEXISTENTE');
    if (u.bloqueadoHasta && u.bloqueadoHasta > ahora) return fallo('CUENTA_BLOQUEADA', u);
    if (u.bloqueadoHasta && u.bloqueadoHasta <= ahora) {
      // El bloqueo temporal terminó: el contador consecutivo vuelve a cero
      u.bloqueadoHasta = null;
      u.intentosFallidos = 0;
    }
    if (u.estado === 'BAJA' || u.estado === 'PENDIENTE') return fallo(`CUENTA_${u.estado}`, u);
    if (u.estado === 'BLOQUEADO') return fallo('CUENTA_BLOQUEADA_ADMIN', u);
    if (!igualSeguro(u.password, password)) {
      u.intentosFallidos += 1;
      u.fallidosPendientes += 1;
      if (u.intentosFallidos >= 5) {
        u.bloqueadoHasta = ahora + 15 * MIN;
        m.evento({ ...ctx, usuario: u }, { accion: 'CUENTA_BLOQUEADA', entidad: 'usuario', idEntidad: u.id, severidad: 'ALTA', valorNuevo: { minutos: 15, intentos: u.intentosFallidos } });
        if (u.intentosFallidos === 5) {
          m.crearHallazgo(ctx, {
            categoria: 'SEGURIDAD',
            regla: 'RA-ALR-01',
            titulo: 'Cuenta bloqueada por intentos fallidos',
            detalle: `${u.nombre} acumuló 5 intentos fallidos de inicio de sesión desde ${ctx.ip}. La cuenta quedó bloqueada 15 minutos.`,
            severidad: 'ALTA',
            referencia: u.id,
            destinatarios: ['SEG'],
          });
        }
      }
      return fallo('PASSWORD_INCORRECTA', u);
    }
    if (u.passwordTemporalExpira && u.passwordTemporalExpira < ahora) return fallo('PASSWORD_TEMPORAL_VENCIDA', u);
    if (u.mfaActivo) {
      const desafio = { id: nuevoId('mfa'), usuarioId: u.id, expira: ahora + 5 * MIN, intentos: 0, ip: ctx.ip, userAgent: ctx.userAgent };
      m.db.t.desafios.push(desafio);
      m.evento({ ...ctx, usuario: u }, { accion: 'LOGIN_PASO1_OK', entidad: 'sesion', valorNuevo: { mfa: true } });
      return { tipo: 'ok', respuesta: { estado: 'MFA_REQUERIDO', desafioId: desafio.id }, sesion: null };
    }
    const s = crearSesion(m, ctx, u);
    return { tipo: 'ok', respuesta: { estado: 'OK', usuario: vistaSesion(m, u, s, ctx.ahora) }, sesion: s };
  });
  if (r.tipo === 'error') throw r.error;
  return { respuesta: r.respuesta, sesion: r.sesion };
}

export async function verificarMfa(m: Motor, ctx: Ctx, desafioId: string, codigo: string) {
  return m
    .transaccion(ctx, { accion: 'LOGIN_MFA', entidad: 'sesion' }, () => {
      const ahora = ctx.ahora.getTime();
      const d = m.db.t.desafios.find((x) => x.id === desafioId);
      if (!d || d.expira < ahora || d.intentos >= 5) {
        return { error: new ErrorApi(401, 'MFA_VENCIDO', 'El código expiró. Vuelve a iniciar sesión.') };
      }
      const u = m.usuario(d.usuarioId)!;
      if (String(codigo).trim() !== DEMO_TOTP) {
        d.intentos += 1;
        m.evento({ ...ctx, usuario: u }, { accion: 'MFA_FALLIDO', entidad: 'sesion', resultado: 'RECHAZADO', motivoRechazo: 'CODIGO_INCORRECTO', severidad: 'MEDIA' });
        return { error: new ErrorApi(401, 'MFA_INVALIDO', `Código incorrecto. Te quedan ${5 - d.intentos} intentos.`) };
      }
      m.db.t.desafios = m.db.t.desafios.filter((x) => x.id !== d.id);
      const s = crearSesion(m, ctx, u);
      return { usuario: vistaSesion(m, u, s, ctx.ahora), sesion: s };
    })
    .then((r) => {
      if ('error' in r && r.error) throw r.error;
      return r as { usuario: UsuarioSesion; sesion: SesionDB };
    });
}

/** Valida la "cookie" de acceso. Devuelve el usuario o un error 401 con código específico. */
export function validarAcceso(m: Motor, sesionId: string | null, ahora: Date): { usuario: UsuarioDB; sesion: SesionDB } {
  const s = sesionId ? m.db.t.sesiones.find((x) => x.id === sesionId) : undefined;
  const t = ahora.getTime();
  if (!s || s.revocada) throw new ErrorApi(401, 'SESION_INVALIDA', 'Tu sesión terminó. Inicia sesión de nuevo.');
  const u = m.usuario(s.usuarioId);
  if (!u || u.estado !== 'ACTIVO') {
    s.revocada = true;
    throw new ErrorApi(401, 'SESION_INVALIDA', 'Tu cuenta ya no está activa.');
  }
  const inactividad = m.parametro('minutos_inactividad') * MIN;
  if (t - s.ultimaActividad > inactividad) {
    s.revocada = true;
    throw new ErrorApi(401, 'SESION_EXPIRADA', 'Tu sesión se cerró por inactividad.');
  }
  if (t > s.renovacionExpira) {
    s.revocada = true;
    throw new ErrorApi(401, 'SESION_EXPIRADA', 'Tu turno de sesión terminó (8 h). Inicia sesión de nuevo.');
  }
  if (t > s.accesoExpira) throw new ErrorApi(401, 'TOKEN_EXPIRADO', 'El token de acceso expiró.');
  s.ultimaActividad = t;
  return { usuario: u, sesion: s };
}

export async function renovar(m: Motor, ctx: Ctx, sesionId: string | null, refresh: string | null) {
  return m
    .transaccion(ctx, { accion: 'SESION_RENOVAR', entidad: 'sesion' }, () => {
      const s = sesionId ? m.db.t.sesiones.find((x) => x.id === sesionId) : undefined;
      const t = ctx.ahora.getTime();
      if (!s || s.revocada || !refresh) return { error: new ErrorApi(401, 'SESION_INVALIDA', 'Tu sesión terminó. Inicia sesión de nuevo.') };
      const u = m.usuario(s.usuarioId)!;
      if (s.refreshUsados.includes(refresh)) {
        // RS-SES-01: reuso de un token ya rotado → posible robo → se revoca toda la sesión
        s.revocada = true;
        m.evento({ ...ctx, usuario: u, sesion: s }, { accion: 'TOKEN_REUTILIZADO', entidad: 'sesion', resultado: 'RECHAZADO', motivoRechazo: 'REFRESH_REUSO', severidad: 'CRITICA' });
        m.crearHallazgo(ctx, {
          categoria: 'SEGURIDAD',
          regla: 'RS-SES-01',
          titulo: 'Reutilización de token de sesión',
          detalle: `Se presentó un token de renovación ya utilizado para la sesión de ${u.nombre}. La sesión se revocó.`,
          severidad: 'CRITICA',
          referencia: u.id,
          destinatarios: ['SEG'],
        });
        return { error: new ErrorApi(401, 'SESION_INVALIDA', 'Por seguridad, tu sesión se cerró. Inicia sesión de nuevo.') };
      }
      if (s.refresh !== refresh) return { error: new ErrorApi(401, 'SESION_INVALIDA', 'Tu sesión terminó.') };
      if (t - s.ultimaActividad > m.parametro('minutos_inactividad') * MIN || t > s.renovacionExpira || u.estado !== 'ACTIVO') {
        s.revocada = true;
        return { error: new ErrorApi(401, 'SESION_EXPIRADA', 'Tu sesión se cerró por inactividad.') };
      }
      s.refreshUsados.push(s.refresh);
      s.refresh = token();
      s.accesoExpira = t + ACCESO_MS;
      s.ultimaActividad = t;
      return { sesion: s, usuario: vistaSesion(m, u, s, ctx.ahora) };
    })
    .then((r) => {
      if ('error' in r && r.error) throw r.error;
      return r as { sesion: SesionDB; usuario: UsuarioSesion };
    });
}

export async function cerrarSesion(m: Motor, ctx: Ctx): Promise<void> {
  if (!ctx.sesion) return;
  const s = ctx.sesion;
  await m.transaccion(ctx, { accion: 'LOGOUT', entidad: 'sesion' }, () => {
    const real = m.db.t.sesiones.find((x) => x.id === s.id);
    if (real) real.revocada = true;
    m.evento(ctx, { accion: 'LOGOUT', entidad: 'sesion', idEntidad: s.id.slice(-12) });
  });
}

export async function cambiarPassword(m: Motor, ctx: Ctx, actual: string, nueva: string): Promise<void> {
  await m.transaccion(ctx, { accion: 'PASSWORD_CAMBIAR', entidad: 'usuario', idEntidad: ctx.usuario?.id }, () => {
    const u = m.db.t.usuarios.find((x) => x.id === ctx.usuario?.id);
    if (!u) throw new ErrorApi(401, 'NO_AUTENTICADO', 'Inicia sesión.');
    if (!igualSeguro(actual, u.password)) throw new ErrorApi(422, 'VALIDACION', 'La contraseña actual no es correcta.', [{ campo: 'actual', mensaje: 'No coincide.' }]);
    const ev = evaluarPassword(nueva, { nombre: u.nombre, correo: u.correo, numEmpleado: u.numEmpleado });
    if (!ev.valida) {
      throw new ErrorApi(422, 'VALIDACION', 'La nueva contraseña no cumple la política.', ev.reglas.filter((r) => !r.ok).map((r) => ({ campo: 'nueva', mensaje: r.texto })));
    }
    if (nueva === u.password || u.historialPasswords.includes(nueva)) {
      throw new ErrorApi(422, 'VALIDACION', 'No puedes repetir ninguna de tus últimas 5 contraseñas.', [{ campo: 'nueva', mensaje: 'Ya la usaste antes.' }]);
    }
    u.historialPasswords = [u.password, ...u.historialPasswords].slice(0, 5);
    u.password = nueva;
    u.debeCambiarPassword = false;
    u.passwordTemporalExpira = null;
    // RS-SES-06: se revocan las demás sesiones
    let revocadas = 0;
    m.db.t.sesiones.forEach((s) => {
      if (s.usuarioId === u.id && s.id !== ctx.sesion?.id && !s.revocada) {
        s.revocada = true;
        revocadas += 1;
      }
    });
    m.evento(ctx, { accion: 'PASSWORD_CAMBIAR', entidad: 'usuario', idEntidad: u.id, severidad: 'MEDIA', valorNuevo: { otrasSesionesRevocadas: revocadas } });
  });
}

export function listarSesiones(m: Motor, ctx: Ctx): SesionActiva[] {
  const u = m.exigirSesion(ctx);
  const t = ctx.ahora.getTime();
  return m.db.t.sesiones
    .filter((s) => s.usuarioId === u.id && !s.revocada && s.renovacionExpira > t)
    .sort((a, b) => b.ultimaActividad - a.ultimaActividad)
    .map((s) => ({
      id: s.id.slice(-12),
      ip: s.ip,
      dispositivo: describirDispositivo(s.userAgent),
      creada: s.creada,
      ultimaActividad: new Date(s.ultimaActividad).toISOString(),
      actual: s.id === ctx.sesion?.id,
    }));
}

export async function revocarSesion(m: Motor, ctx: Ctx, idCorto: string): Promise<void> {
  await m.transaccion(ctx, { accion: 'SESION_REVOCAR', entidad: 'sesion', idEntidad: idCorto }, () => {
    const u = m.exigirSesion(ctx);
    const s = m.db.t.sesiones.find((x) => x.usuarioId === u.id && x.id.endsWith(idCorto));
    if (!s) throw new ErrorApi(404, 'NO_ENCONTRADO', 'La sesión no existe.');
    s.revocada = true;
    m.evento(ctx, { accion: 'SESION_REVOCAR', entidad: 'sesion', idEntidad: idCorto, severidad: 'MEDIA' });
  });
}

export function describirDispositivo(ua: string): string {
  const nav = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const so = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPad|iPhone/.test(ua) ? 'iPadOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Sistema desconocido';
  return `${nav} en ${so}`;
}
