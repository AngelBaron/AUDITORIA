/**
 * Usuarios, accesos, parámetros, hallazgos y periodos del mock.
 * Controles: RF-USR-01 a 05, RS-SOD-10 a 14, RN-07, RA-ALR-07, RF-PER-01/02.
 */
import type {
  AlmacenClave,
  AsignacionDetalle,
  EstadoHallazgo,
  FilaPermisos,
  Hallazgo,
  Parametro,
  Periodo,
  RolClave,
  UsuarioAdmin,
  UsuarioNuevo,
} from '@/api/types';
import { evaluarCombinacionRoles, ROL_PERMISOS, ROLES_CON_MFA, ROLES_GLOBALES } from '@/domain/permisos';
import { ErrorApi, TODOS_ALMACENES, type Ctx, type Motor } from './motor';
import { nuevoId, type AsignacionDB } from './estado';

const ROLES: RolClave[] = ['ALM', 'SUP', 'GER', 'SOL', 'CMP', 'CON', 'AUD', 'ADM', 'SEG'];

function vistaAsignacion(m: Motor, a: AsignacionDB): AsignacionDetalle {
  return {
    id: a.id,
    usuarioId: a.usuarioId,
    usuarioNombre: m.nombre(a.usuarioId),
    rol: a.rol,
    almacenes: a.almacenes,
    estado: a.estado,
    solicitadoPor: m.nombre(a.solicitadoPor),
    aprobadoPor: a.aprobadoPor ? m.nombre(a.aprobadoPor) : null,
    fechaSolicitud: a.fechaSolicitud,
    ultimaRecertificacion: a.ultimaRecertificacion,
    excepcionSod: a.excepcionSod,
  };
}

export function listarUsuarios(m: Motor, ctx: Ctx): UsuarioAdmin[] {
  m.exigir(ctx, 'usuarios.ver');
  const ahora = ctx.ahora.getTime();
  return m.db.t.usuarios
    .map((u) => ({
      id: u.id,
      nombre: u.nombre,
      correo: u.correo,
      numEmpleado: u.numEmpleado,
      puesto: u.puesto,
      estado: u.bloqueadoHasta && u.bloqueadoHasta > ahora && u.estado === 'ACTIVO' ? ('BLOQUEADO' as const) : u.estado,
      mfaActivo: u.mfaActivo,
      ultimoAcceso: u.ultimoAcceso,
      asignaciones: m.db.t.asignaciones.filter((a) => a.usuarioId === u.id && a.estado !== 'RECHAZADA').map((a) => vistaAsignacion(m, a)),
      creadoPor: m.nombre(u.creadoPor),
      diasSinUso: u.ultimoAcceso ? Math.floor((ahora - new Date(u.ultimoAcceso).getTime()) / 86400000) : null,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

function validarAlmacenes(rol: RolClave, almacenes: AlmacenClave[] | 'TODOS'): AlmacenClave[] | 'TODOS' {
  if (ROLES_GLOBALES.includes(rol)) return 'TODOS';
  if (almacenes === 'TODOS' || !Array.isArray(almacenes) || almacenes.length === 0) {
    throw new ErrorApi(422, 'VALIDACION', 'Elige al menos un almacén para este rol.', [{ campo: 'almacenes', mensaje: 'Requerido.' }]);
  }
  const invalidos = almacenes.filter((a) => !TODOS_ALMACENES.includes(a));
  if (invalidos.length) throw new ErrorApi(422, 'VALIDACION', 'Almacén inválido.', [{ campo: 'almacenes', mensaje: 'Inválido.' }]);
  return [...new Set(almacenes)];
}

function validarExcepcion(ctx: Ctx, exc: UsuarioNuevo['excepcionSod']) {
  if (!exc) return null;
  const j = (exc.justificacion ?? '').trim();
  if (j.length < 40) throw new ErrorApi(422, 'VALIDACION', 'La excepción exige una justificación de al menos 40 caracteres con el control compensatorio.', [{ campo: 'excepcion', mensaje: 'Mínimo 40 caracteres.' }]);
  const hoy = ctx.ahora.toISOString().slice(0, 10);
  const max = new Date(ctx.ahora.getTime() + 180 * 86400000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exc.vence) || exc.vence <= hoy || exc.vence > max) {
    throw new ErrorApi(422, 'VALIDACION', 'La excepción debe vencer en una fecha futura, máximo 180 días.', [{ campo: 'vence', mensaje: 'Fecha inválida.' }]);
  }
  return { justificacion: j.slice(0, 500), vence: exc.vence };
}

export function crearUsuario(m: Motor, ctx: Ctx, datos: UsuarioNuevo, password: string | undefined) {
  const admin = m.exigir(ctx, 'usuarios.gestionar');
  m.validarPasswordReautenticacion(ctx, password);
  const errores: { campo: string; mensaje: string }[] = [];
  const nombre = (datos.nombre ?? '').trim();
  const correo = (datos.correo ?? '').trim().toLowerCase();
  const num = (datos.numEmpleado ?? '').trim().toUpperCase();
  if (nombre.length < 5 || nombre.length > 80) errores.push({ campo: 'nombre', mensaje: 'Escribe el nombre completo (5 a 80 caracteres).' });
  if (!/^[a-z0-9._-]+@logitech\.mx$/.test(correo)) errores.push({ campo: 'correo', mensaje: 'Usa el correo laboral @logitech.mx.' });
  if (/^(almacen|admin|usuario|generico|temp)\d*@/.test(correo)) errores.push({ campo: 'correo', mensaje: 'No se permiten cuentas genéricas o compartidas (RF-USR-05).' });
  if (!/^LT-\d{4}$/.test(num)) errores.push({ campo: 'numEmpleado', mensaje: 'Formato LT-0000.' });
  if (m.db.t.usuarios.some((u) => u.correo === correo)) errores.push({ campo: 'correo', mensaje: 'Ya existe un usuario con ese correo.' });
  if (m.db.t.usuarios.some((u) => u.numEmpleado === num)) errores.push({ campo: 'numEmpleado', mensaje: 'Ya existe un usuario con ese número de empleado.' });
  if (!ROLES.includes(datos.rol)) errores.push({ campo: 'rol', mensaje: 'Rol inválido.' });
  if ((datos.puesto ?? '').trim().length < 3) errores.push({ campo: 'puesto', mensaje: 'Indica el puesto.' });
  if (errores.length) throw new ErrorApi(422, 'VALIDACION', 'Revisa los datos marcados.', errores);
  const almacenes = validarAlmacenes(datos.rol, datos.almacenes);

  const temporal = generarTemporal();
  const ahoraIso = ctx.ahora.toISOString();
  const id = nuevoId('u');
  m.db.t.usuarios.push({
    id,
    correo,
    nombre,
    numEmpleado: num,
    puesto: datos.puesto.trim(),
    centroCosto: datos.centroCosto ?? null,
    password: temporal,
    historialPasswords: [],
    estado: 'PENDIENTE',
    intentosFallidos: 0,
    bloqueadoHasta: null,
    mfaActivo: ROLES_CON_MFA.includes(datos.rol),
    debeCambiarPassword: true,
    passwordTemporalExpira: null, // corre a partir de la aprobación de SEG
    ultimoAcceso: null,
    ultimoAccesoAnterior: null,
    fallidosDesdeUltimoAcceso: 0,
    fallidosPendientes: 0,
    ipHabitual: '10.20.0.0',
    creadoPor: admin.id,
    creadoEn: ahoraIso,
  });
  const asig: AsignacionDB = {
    id: nuevoId('asg'),
    usuarioId: id,
    rol: datos.rol,
    almacenes,
    estado: 'PENDIENTE',
    solicitadoPor: admin.id,
    aprobadoPor: null,
    fechaSolicitud: ahoraIso,
    ultimaRecertificacion: null,
    excepcionSod: null,
  };
  m.db.t.asignaciones.push(asig);
  m.evento(ctx, {
    accion: 'USUARIO_CREAR',
    entidad: 'usuario',
    idEntidad: id,
    severidad: 'MEDIA',
    valorNuevo: { nombre, numEmpleado: num, rol: datos.rol, almacenes, estado: 'PENDIENTE' },
  });
  // La contraseña temporal se muestra una sola vez al ADM para entregarla en persona
  return { id, passwordTemporal: temporal };
}

function generarTemporal(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = new Uint8Array(14);
  crypto.getRandomValues(b);
  return [...b].map((x) => alfabeto[x % alfabeto.length]).join('') + '.7';
}

export function solicitarAsignacion(
  m: Motor,
  ctx: Ctx,
  usuarioId: string,
  datos: { rol: RolClave; almacenes: AlmacenClave[] | 'TODOS'; excepcionSod?: UsuarioNuevo['excepcionSod'] },
  password: string | undefined,
): void {
  const admin = m.exigir(ctx, 'usuarios.gestionar');
  m.validarPasswordReautenticacion(ctx, password);
  if (usuarioId === admin.id) {
    throw new ErrorApi(403, 'SOD_VIOLATION', 'No puedes asignarte roles a ti mismo (RS-SOD-10).');
  }
  const u = m.usuario(usuarioId);
  if (!u || u.estado === 'BAJA') throw new ErrorApi(404, 'NO_ENCONTRADO', 'El usuario no existe o está dado de baja.');
  if (!ROLES.includes(datos.rol)) throw new ErrorApi(422, 'VALIDACION', 'Rol inválido.', [{ campo: 'rol', mensaje: 'Inválido.' }]);
  const almacenes = validarAlmacenes(datos.rol, datos.almacenes);
  const existentes = m.db.t.asignaciones.filter((a) => a.usuarioId === usuarioId && (a.estado === 'VIGENTE' || a.estado === 'PENDIENTE'));
  if (existentes.some((a) => a.rol === datos.rol && JSON.stringify(a.almacenes) === JSON.stringify(almacenes))) {
    throw new ErrorApi(409, 'DUPLICADO', 'El usuario ya tiene (o tiene pendiente) esa asignación.');
  }
  const combinacion = evaluarCombinacionRoles(existentes, { rol: datos.rol, almacenes });
  let excepcion = null;
  if (combinacion?.tipo === 'prohibida') throw new ErrorApi(403, 'SOD_VIOLATION', `${combinacion.mensaje} (${combinacion.codigo})`);
  if (combinacion?.tipo === 'excepcion') {
    if (!datos.excepcionSod) throw new ErrorApi(422, 'EXCEPCION_REQUERIDA', `${combinacion.mensaje} (${combinacion.codigo})`, [{ campo: 'excepcion', mensaje: 'Requerida.' }]);
    excepcion = validarExcepcion(ctx, datos.excepcionSod);
  }
  const asig: AsignacionDB = {
    id: nuevoId('asg'),
    usuarioId,
    rol: datos.rol,
    almacenes,
    estado: 'PENDIENTE',
    solicitadoPor: admin.id,
    aprobadoPor: null,
    fechaSolicitud: ctx.ahora.toISOString(),
    ultimaRecertificacion: null,
    excepcionSod: excepcion,
  };
  m.db.t.asignaciones.push(asig);
  m.evento(ctx, { accion: 'ROL_SOLICITAR', entidad: 'asignacion', idEntidad: asig.id, severidad: 'MEDIA', valorNuevo: { usuario: u.nombre, rol: datos.rol, almacenes, excepcion: !!excepcion } });
}

export function resolverAsignacion(m: Motor, ctx: Ctx, asignacionId: string, aprobar: boolean, motivo: string | undefined, password: string | undefined): void {
  const seg = m.exigir(ctx, 'usuarios.aprobar');
  m.validarPasswordReautenticacion(ctx, password);
  const a = m.db.t.asignaciones.find((x) => x.id === asignacionId);
  if (!a || a.estado !== 'PENDIENTE') throw new ErrorApi(409, 'ESTADO_INVALIDO', 'La solicitud ya no está pendiente.');
  if (a.usuarioId === seg.id) throw new ErrorApi(403, 'SOD_VIOLATION', 'No puedes aprobar accesos para ti mismo (RS-SOD-10).');
  if (a.solicitadoPor === seg.id) throw new ErrorApi(403, 'SOD_VIOLATION', 'Quien solicita el acceso no puede aprobarlo (RS-SOD-10).');
  const u = m.usuario(a.usuarioId)!;
  if (aprobar) {
    const vigentes = m.db.t.asignaciones.filter((x) => x.usuarioId === a.usuarioId && x.estado === 'VIGENTE');
    const comb = evaluarCombinacionRoles(vigentes, a);
    if (comb?.tipo === 'prohibida') throw new ErrorApi(403, 'SOD_VIOLATION', `${comb.mensaje} (${comb.codigo})`);
    if (comb?.tipo === 'excepcion' && !a.excepcionSod) throw new ErrorApi(422, 'EXCEPCION_REQUERIDA', comb.mensaje);
    a.estado = 'VIGENTE';
    a.aprobadoPor = seg.id;
    a.ultimaRecertificacion = ctx.ahora.toISOString();
    if (u.estado === 'PENDIENTE') {
      u.estado = 'ACTIVO';
      u.passwordTemporalExpira = ctx.ahora.getTime() + 24 * 3600 * 1000; // RS-AUT-05
    }
    if (ROLES_CON_MFA.includes(a.rol)) u.mfaActivo = true;
    // RS-SES-06: cambio de privilegios revoca sesiones
    m.db.t.sesiones.forEach((s) => {
      if (s.usuarioId === u.id) s.revocada = true;
    });
  } else {
    const mot = (motivo ?? '').trim();
    if (mot.length < 15) throw new ErrorApi(422, 'VALIDACION', 'Escribe el motivo del rechazo (mínimo 15 caracteres).', [{ campo: 'motivo', mensaje: 'Mínimo 15.' }]);
    a.estado = 'RECHAZADA';
    a.aprobadoPor = seg.id;
  }
  m.evento(ctx, {
    accion: aprobar ? 'ROL_APROBAR' : 'ROL_RECHAZAR',
    entidad: 'asignacion',
    idEntidad: a.id,
    severidad: 'ALTA',
    valorNuevo: { usuario: u.nombre, rol: a.rol, almacenes: a.almacenes, estado: a.estado, excepcion: a.excepcionSod },
  });
}

export function retirarAsignacion(m: Motor, ctx: Ctx, asignacionId: string, motivo: string): void {
  const actor = m.exigirSesion(ctx);
  const puede = m.tienePermisoEn(actor.id, 'usuarios.gestionar', null, ctx.ahora) || m.tienePermisoEn(actor.id, 'usuarios.aprobar', null, ctx.ahora);
  if (!puede) throw new ErrorApi(403, 'SIN_PERMISO', 'No tienes permiso para retirar accesos.');
  const a = m.db.t.asignaciones.find((x) => x.id === asignacionId);
  if (!a || a.estado !== 'VIGENTE') throw new ErrorApi(409, 'ESTADO_INVALIDO', 'La asignación no está vigente.');
  if ((motivo ?? '').trim().length < 15) throw new ErrorApi(422, 'VALIDACION', 'Escribe el motivo (mínimo 15 caracteres).', [{ campo: 'motivo', mensaje: 'Mínimo 15.' }]);
  a.estado = 'RETIRADA';
  m.db.t.sesiones.forEach((s) => {
    if (s.usuarioId === a.usuarioId) s.revocada = true;
  });
  m.evento(ctx, { accion: 'ROL_RETIRAR', entidad: 'asignacion', idEntidad: a.id, severidad: 'ALTA', valorNuevo: { usuario: m.nombre(a.usuarioId), rol: a.rol, motivo } });
}

export function recertificar(m: Motor, ctx: Ctx, asignacionId: string, confirmar: boolean, motivo: string | undefined): void {
  const seg = m.exigir(ctx, 'usuarios.aprobar');
  const a = m.db.t.asignaciones.find((x) => x.id === asignacionId);
  if (!a || a.estado !== 'VIGENTE') throw new ErrorApi(409, 'ESTADO_INVALIDO', 'La asignación no está vigente.');
  if (a.usuarioId === seg.id) throw new ErrorApi(403, 'SOD_VIOLATION', 'No puedes recertificar tus propios accesos.');
  if (confirmar) {
    a.ultimaRecertificacion = ctx.ahora.toISOString();
    m.evento(ctx, { accion: 'ROL_RECERTIFICAR', entidad: 'asignacion', idEntidad: a.id, severidad: 'MEDIA', valorNuevo: { usuario: m.nombre(a.usuarioId), rol: a.rol, resultado: 'CONFIRMADO' } });
  } else {
    retirarAsignacion(m, ctx, asignacionId, motivo ?? '');
  }
}

export function cambiarEstadoUsuario(m: Motor, ctx: Ctx, usuarioId: string, accion: 'baja' | 'desbloquear' | 'bloquear', motivo: string): void {
  const admin = m.exigir(ctx, 'usuarios.gestionar');
  if (usuarioId === admin.id) throw new ErrorApi(403, 'SOD_VIOLATION', 'No puedes cambiar el estado de tu propia cuenta.');
  const u = m.usuario(usuarioId);
  if (!u) throw new ErrorApi(404, 'NO_ENCONTRADO', 'El usuario no existe.');
  if ((motivo ?? '').trim().length < 15) throw new ErrorApi(422, 'VALIDACION', 'Escribe el motivo (mínimo 15 caracteres).', [{ campo: 'motivo', mensaje: 'Mínimo 15.' }]);
  const antes = u.estado;
  if (accion === 'baja') {
    u.estado = 'BAJA';
    m.db.t.asignaciones.forEach((a) => {
      if (a.usuarioId === u.id && (a.estado === 'VIGENTE' || a.estado === 'PENDIENTE')) a.estado = 'RETIRADA';
    });
  } else if (accion === 'bloquear') {
    u.estado = 'BLOQUEADO';
  } else {
    if (u.estado === 'BAJA') throw new ErrorApi(409, 'ESTADO_INVALIDO', 'Un usuario dado de baja no se reactiva; crea una cuenta nueva.');
    u.estado = 'ACTIVO';
    u.bloqueadoHasta = null;
    u.intentosFallidos = 0;
  }
  // RF-USR-02: la baja o el bloqueo revoca sesiones de inmediato
  if (accion !== 'desbloquear') {
    m.db.t.sesiones.forEach((s) => {
      if (s.usuarioId === u.id) s.revocada = true;
    });
  }
  m.evento(ctx, { accion: `USUARIO_${accion.toUpperCase()}`, entidad: 'usuario', idEntidad: u.id, severidad: 'ALTA', valorAnterior: { estado: antes }, valorNuevo: { estado: u.estado, motivo } });
}

export function pendientesAcceso(m: Motor, ctx: Ctx): AsignacionDetalle[] {
  m.exigir(ctx, 'usuarios.ver');
  return m.db.t.asignaciones.filter((a) => a.estado === 'PENDIENTE').map((a) => vistaAsignacion(m, a));
}

export function matrizPermisos(m: Motor, ctx: Ctx): FilaPermisos[] {
  m.exigir(ctx, 'usuarios.ver');
  return m.db.t.asignaciones
    .filter((a) => a.estado === 'VIGENTE')
    .map((a) => ({
      usuario: m.nombre(a.usuarioId),
      rol: a.rol,
      almacenes: a.almacenes === 'TODOS' ? 'Todos' : a.almacenes.join(', '),
      permisos: [...ROL_PERMISOS[a.rol]],
    }))
    .sort((x, y) => x.usuario.localeCompare(y.usuario, 'es'));
}

/* ───────────── Parámetros (RN-07, RA-ALR-07) ───────────── */

export function listarParametros(m: Motor, ctx: Ctx): Parametro[] {
  m.exigir(ctx, 'parametros.ver');
  return m.db.t.parametros.map((p) => ({
    clave: p.clave,
    nombre: p.nombre,
    descripcion: p.descripcion,
    valor: p.valor,
    unidad: p.unidad,
    modificadoPor: p.modificadoPor ? m.nombre(p.modificadoPor) : null,
    modificadoEn: p.modificadoEn,
    solicitudPendiente: p.solicitud ? { ...p.solicitud, solicitadoPor: m.nombre(p.solicitud.solicitadoPor) } : null,
  }));
}

export function proponerParametro(m: Motor, ctx: Ctx, clave: string, valor: number, motivo: string, password: string | undefined): void {
  const adm = m.exigir(ctx, 'parametros.proponer');
  m.validarPasswordReautenticacion(ctx, password);
  const p = m.db.t.parametros.find((x) => x.clave === clave);
  if (!p) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Parámetro inexistente.');
  if (p.solicitud) throw new ErrorApi(409, 'ESTADO_INVALIDO', 'Ya hay un cambio pendiente de aprobación para este parámetro.');
  const v = Number(valor);
  const limites: Record<string, [number, number]> = { MXN: [100, 1_000_000], '%': [0.5, 20], días: [1, 30], horas: [4, 168], minutos: [5, 30] };
  const [min, max] = limites[p.unidad] ?? [0, 1e9];
  if (!Number.isFinite(v) || v < min || v > max) throw new ErrorApi(422, 'VALIDACION', `El valor debe estar entre ${min} y ${max} ${p.unidad}.`, [{ campo: 'valor', mensaje: 'Fuera de rango.' }]);
  if ((motivo ?? '').trim().length < 20) throw new ErrorApi(422, 'VALIDACION', 'Justifica el cambio (mínimo 20 caracteres).', [{ campo: 'motivo', mensaje: 'Mínimo 20.' }]);
  p.solicitud = { id: nuevoId('par'), valorPropuesto: v, motivo: motivo.trim().slice(0, 500), solicitadoPor: adm.id, fecha: ctx.ahora.toISOString() };
  m.evento(ctx, { accion: 'PARAMETRO_PROPONER', entidad: 'parametro', idEntidad: clave, severidad: 'MEDIA', valorAnterior: { valor: p.valor }, valorNuevo: { valorPropuesto: v } });
}

export function resolverParametro(m: Motor, ctx: Ctx, clave: string, aprobar: boolean, password: string | undefined): void {
  const seg = m.exigir(ctx, 'parametros.aprobar');
  m.validarPasswordReautenticacion(ctx, password);
  const p = m.db.t.parametros.find((x) => x.clave === clave);
  if (!p?.solicitud) throw new ErrorApi(409, 'ESTADO_INVALIDO', 'No hay un cambio pendiente.');
  if (p.solicitud.solicitadoPor === seg.id) throw new ErrorApi(403, 'SOD_VIOLATION', 'Quien propone un cambio no puede aprobarlo.');
  const anterior = p.valor;
  if (aprobar) {
    p.valor = p.solicitud.valorPropuesto;
    p.modificadoPor = p.solicitud.solicitadoPor;
    p.modificadoEn = ctx.ahora.toISOString();
    m.crearHallazgo(ctx, {
      categoria: 'INTEGRIDAD',
      regla: 'RA-ALR-07',
      titulo: 'Cambio de parámetro de control',
      detalle: `${p.nombre}: ${anterior} → ${p.valor} ${p.unidad}. Propuso ${m.nombre(p.solicitud.solicitadoPor)}, aprobó ${seg.nombre}. Motivo: ${p.solicitud.motivo}`,
      severidad: 'MEDIA',
      referencia: clave,
      destinatarios: ['GER'],
    });
  }
  m.evento(ctx, { accion: aprobar ? 'PARAMETRO_APROBAR' : 'PARAMETRO_RECHAZAR', entidad: 'parametro', idEntidad: clave, severidad: 'ALTA', valorAnterior: { valor: anterior }, valorNuevo: { valor: p.valor } });
  p.solicitud = null;
}

/* ───────────── Hallazgos ───────────── */

export function listarHallazgos(m: Motor, ctx: Ctx): Hallazgo[] {
  const u = m.exigir(ctx, 'hallazgos.ver');
  const roles = m.rolesDe(u.id, ctx.ahora);
  const esAud = roles.includes('AUD');
  return m.db.t.hallazgos
    .filter((h) => esAud || h.destinatarios.some((d) => roles.includes(d)))
    .map(({ destinatarios: _d, ...h }) => h);
}

export function actualizarHallazgo(m: Motor, ctx: Ctx, id: string, estado: EstadoHallazgo, comentario: string): void {
  const u = m.exigir(ctx, 'hallazgos.gestionar');
  const h = m.db.t.hallazgos.find((x) => x.id === id);
  if (!h) throw new ErrorApi(404, 'NO_ENCONTRADO', 'El hallazgo no existe.');
  const roles = m.rolesDe(u.id, ctx.ahora);
  if (!h.destinatarios.some((d) => roles.includes(d))) throw new ErrorApi(403, 'SIN_PERMISO', 'Este hallazgo corresponde a otra área.');
  const validos: Record<EstadoHallazgo, EstadoHallazgo[]> = { ABIERTO: ['EN_REVISION'], EN_REVISION: ['JUSTIFICADO', 'ESCALADO'], JUSTIFICADO: [], ESCALADO: ['EN_REVISION'] };
  if (!validos[h.estado].includes(estado)) throw new ErrorApi(409, 'ESTADO_INVALIDO', `No se puede pasar de ${h.estado} a ${estado}.`);
  if ((comentario ?? '').trim().length < 15) throw new ErrorApi(422, 'VALIDACION', 'Escribe un comentario de al menos 15 caracteres.', [{ campo: 'comentario', mensaje: 'Mínimo 15.' }]);
  // Un hallazgo sobre un usuario no puede ser justificado por ese mismo usuario
  if (h.referencia === u.id || h.referencia?.startsWith(`${u.id}|`)) throw new ErrorApi(403, 'SOD_VIOLATION', 'No puedes revisar un hallazgo que te involucra.');
  const antes = h.estado;
  h.estado = estado;
  h.historial.push({ fecha: ctx.ahora.toISOString(), usuario: u.nombre, estado, comentario: comentario.trim().slice(0, 500) });
  m.evento(ctx, { accion: 'HALLAZGO_ACTUALIZAR', entidad: 'hallazgo', idEntidad: h.id, severidad: 'MEDIA', valorAnterior: { estado: antes }, valorNuevo: { estado } });
}

/* ───────────── Periodos (RF-PER-01, RF-PER-02) ───────────── */

export function listarPeriodos(m: Motor, ctx: Ctx): Periodo[] {
  const u = m.exigirSesion(ctx);
  if (!m.tienePermisoEn(u.id, 'periodo.cerrar', null, ctx.ahora) && !m.tienePermisoEn(u.id, 'periodo.aprobar', null, ctx.ahora) && !m.tienePermisoEn(u.id, 'reportes.ver', null, ctx.ahora)) {
    throw new ErrorApi(403, 'SIN_PERMISO', 'No tienes acceso a los periodos.');
  }
  const actual = ctx.ahora.toISOString().slice(0, 7);
  const claves = new Set(m.db.t.periodos.map((p) => p.clave));
  claves.add(actual);
  return [...claves]
    .sort()
    .reverse()
    .map((clave) => {
      const p = m.db.t.periodos.find((x) => x.clave === clave);
      return {
        clave,
        estado: p?.estado ?? 'ABIERTO',
        cerradoPor: p?.cerradoPor ? { usuario: { id: p.cerradoPor.usuarioId, nombre: m.nombre(p.cerradoPor.usuarioId) }, fecha: p.cerradoPor.fecha } : null,
        solicitudReapertura: p?.solicitudReapertura ? { usuario: m.nombre(p.solicitudReapertura.usuarioId), motivo: p.solicitudReapertura.motivo, fecha: p.solicitudReapertura.fecha } : null,
      };
    });
}

export function cerrarPeriodo(m: Motor, ctx: Ctx, clave: string): void {
  const u = m.exigir(ctx, 'periodo.cerrar');
  if (!/^\d{4}-\d{2}$/.test(clave)) throw new ErrorApi(422, 'VALIDACION', 'Periodo inválido.');
  if (clave >= ctx.ahora.toISOString().slice(0, 7)) throw new ErrorApi(422, 'VALIDACION', 'Solo puedes cerrar meses ya terminados.');
  let p = m.db.t.periodos.find((x) => x.clave === clave);
  if (p && p.estado !== 'ABIERTO') throw new ErrorApi(409, 'ESTADO_INVALIDO', 'El periodo ya está cerrado.');
  if (!p) {
    p = { clave, estado: 'ABIERTO', cerradoPor: null, solicitudReapertura: null };
    m.db.t.periodos.push(p);
  }
  p.estado = 'CERRADO';
  p.cerradoPor = { usuarioId: u.id, fecha: ctx.ahora.toISOString() };
  m.evento(ctx, { accion: 'PERIODO_CERRAR', entidad: 'periodo', idEntidad: clave, severidad: 'ALTA', valorNuevo: { estado: 'CERRADO' } });
}

export function solicitarReapertura(m: Motor, ctx: Ctx, clave: string, motivo: string): void {
  const u = m.exigir(ctx, 'periodo.cerrar');
  const p = m.db.t.periodos.find((x) => x.clave === clave);
  if (!p || p.estado !== 'CERRADO') throw new ErrorApi(409, 'ESTADO_INVALIDO', 'El periodo no está cerrado.');
  if ((motivo ?? '').trim().length < 30) throw new ErrorApi(422, 'VALIDACION', 'Justifica la reapertura (mínimo 30 caracteres).', [{ campo: 'motivo', mensaje: 'Mínimo 30.' }]);
  p.estado = 'REAPERTURA_SOLICITADA';
  p.solicitudReapertura = { usuarioId: u.id, motivo: motivo.trim().slice(0, 500), fecha: ctx.ahora.toISOString() };
  m.evento(ctx, { accion: 'PERIODO_SOLICITAR_REAPERTURA', entidad: 'periodo', idEntidad: clave, severidad: 'ALTA', valorNuevo: { motivo } });
}

export function resolverReapertura(m: Motor, ctx: Ctx, clave: string, aprobar: boolean, password: string | undefined): void {
  const u = m.exigir(ctx, 'periodo.aprobar');
  m.validarPasswordReautenticacion(ctx, password);
  const p = m.db.t.periodos.find((x) => x.clave === clave);
  if (!p || p.estado !== 'REAPERTURA_SOLICITADA' || !p.solicitudReapertura) throw new ErrorApi(409, 'ESTADO_INVALIDO', 'No hay solicitud de reapertura.');
  if (p.solicitudReapertura.usuarioId === u.id) throw new ErrorApi(403, 'SOD_VIOLATION', 'Quien solicita la reapertura no puede aprobarla.');
  p.estado = aprobar ? 'ABIERTO' : 'CERRADO';
  m.evento(ctx, { accion: aprobar ? 'PERIODO_REABRIR' : 'PERIODO_REAPERTURA_RECHAZAR', entidad: 'periodo', idEntidad: clave, severidad: 'ALTA', valorNuevo: { estado: p.estado } });
  p.solicitudReapertura = null;
}
