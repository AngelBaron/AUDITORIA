/**
 * Consultas de solo lectura del mock: tablero, bandeja, bitácora y reportes (RF-REP).
 */
import type {
  AlmacenClave,
  DocumentoResumen,
  ElementoBandeja,
  EventoBitacora,
  EventoTimeline,
  FilaConciliacion,
  FilaDiscrepancia,
  FilaFueraHorario,
  FilaMerma,
  FilaTopUsuario,
  FilaValuacion,
  FiltrosBitacora,
  Paginado,
  Tablero,
} from '@/api/types';
import { redondear } from '@/domain/formato';
import { ErrorApi, TODOS_ALMACENES, type Ctx, type Motor } from './motor';
import { paginar, vistaConteo } from './inventario';
import { llaveExistencia } from './estado';
import { MOTIVOS } from './semilla';

const HORA_MX = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', hour: 'numeric', hour12: false, weekday: 'short' });

export function fueraDeHorario(iso: string): boolean {
  const partes = HORA_MX.formatToParts(new Date(iso));
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? '12') % 24;
  const dia = partes.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  return dia === 'Sun' || hora < 7 || hora >= 20;
}

function documentosVisibles(m: Motor, ctx: Ctx) {
  const u = m.exigirSesion(ctx);
  return m.db.t.documentos.filter((d) => m.puedeVerDocumento(u.id, d, ctx.ahora));
}

export function listarDocumentos(
  m: Motor,
  ctx: Ctx,
  f: { tipo?: string; estado?: string; almacen?: string; q?: string; pagina?: number; mios?: boolean },
): Paginado<DocumentoResumen> {
  const u = m.exigirSesion(ctx);
  const q = (f.q ?? '').trim().toUpperCase();
  const lista = documentosVisibles(m, ctx).filter(
    (d) =>
      (!f.tipo || d.tipo === f.tipo) &&
      (!f.estado || d.estado === f.estado) &&
      (!f.almacen || d.almacenOrigen === f.almacen || d.almacenDestino === f.almacen) &&
      (!f.mios || d.creadoPor.usuarioId === u.id) &&
      (!q || d.folio.includes(q) || d.renglones.some((r) => m.producto(r.productoId).sku.includes(q))),
  );
  const p = paginar(lista, f.pagina ?? 1);
  return { ...p, datos: p.datos.map((d) => m.resumenDocumento(d, u.id, ctx.ahora)) };
}

export function timelineDocumento(m: Motor, docId: string): EventoTimeline[] {
  return m.db.bitacora
    .filter((e) => e.idEntidad === docId)
    .map((e) => ({
      id: e.id,
      fecha: e.fechaHoraUtc,
      accion: e.accion,
      usuario: e.usuarioNombre,
      resultado: e.resultado,
      detalle: e.motivoRechazo ?? (typeof e.valorNuevo?.motivo === 'string' ? e.valorNuevo.motivo : null),
      ip: e.ipOrigen,
    }))
    .reverse()
    .slice(0, 200);
}

export function bandeja(m: Motor, ctx: Ctx): ElementoBandeja[] {
  const u = m.exigirSesion(ctx);
  const items: ElementoBandeja[] = [];
  const RUTA: Record<string, string> = { ENT: '/recepciones', SAL: '/salidas', TRF: '/transferencias', AJU: '/ajustes' };
  const TEXTO: Record<string, string> = {
    aprobar: 'Aprobar o rechazar',
    surtir: 'Surtir material',
    enviar: 'Enviar transferencia',
    recibir: 'Recibir a ciegas',
    resolver_incidencia: 'Resolver incidencia',
    confirmar_entrega: 'Confirmar que lo recibiste',
    confirmar_recepcion: 'Confirmar recepción',
    enviar_aprobacion: 'Enviar a aprobación',
  };
  for (const d of documentosVisibles(m, ctx)) {
    const { permitidas } = m.evaluarAcciones(d, u.id, ctx.ahora);
    const principal = permitidas.find((a) => a !== 'cancelar' && a !== 'rechazar');
    if (!principal) continue;
    // En recepción ciega no se revela ni el importe enviado (permitiría inferir cantidades)
    const monto = principal === 'recibir' ? null : m.montoDocumento(d);
    items.push({
      id: d.id,
      tipo: 'DOCUMENTO',
      titulo: TEXTO[principal] ?? principal,
      detalle: [
        `${d.renglones.length} producto(s)`,
        monto == null ? null : monto.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }),
        d.almacenOrigen && d.almacenDestino ? `${d.almacenOrigen} → ${d.almacenDestino}` : null,
      ]
        .filter(Boolean)
        .join(', '),
      folio: d.folio,
      ruta: `${RUTA[d.tipo]}/${d.id}`,
      accion: principal,
      fecha: d.actualizadoEn,
      urgente: d.estado === 'CON_DISCREPANCIA' || d.nivelAprobacion !== 'SUP',
    });
  }
  for (const c of m.db.t.conteos) {
    if (!m.almacenesDe(u.id, ctx.ahora).includes(c.almacen)) continue;
    const v = vistaConteo(m, c, u.id, ctx.ahora);
    const a = v.accionesPermitidas.find((x) => x !== 'cancelar');
    if (!a) continue;
    items.push({
      id: c.id,
      tipo: 'CONTEO',
      titulo: { iniciar: 'Iniciar conteo', capturar_primero: 'Capturar conteo', capturar_segundo: 'Capturar segundo conteo', cerrar: 'Cerrar conteo', cancelar: '' }[a],
      detalle: `${c.renglones.length} productos en ${c.almacen}`,
      folio: c.folio,
      ruta: `/conteos/${c.id}`,
      accion: a,
      fecha: c.creadoEn,
      urgente: false,
    });
  }
  if (m.tienePermisoEn(u.id, 'usuarios.aprobar', null, ctx.ahora)) {
    for (const a of m.db.t.asignaciones.filter((x) => x.estado === 'PENDIENTE' && x.usuarioId !== u.id && x.solicitadoPor !== u.id)) {
      items.push({
        id: a.id,
        tipo: 'ASIGNACION',
        titulo: 'Aprobar acceso',
        detalle: `${m.nombre(a.usuarioId)} · rol ${a.rol}${a.excepcionSod ? ' · con excepción SoD' : ''}`,
        folio: null,
        ruta: '/usuarios?pestana=pendientes',
        accion: 'aprobar',
        fecha: a.fechaSolicitud,
        urgente: !!a.excepcionSod,
      });
    }
  }
  if (m.tienePermisoEn(u.id, 'parametros.aprobar', null, ctx.ahora)) {
    for (const p of m.db.t.parametros.filter((x) => x.solicitud && x.solicitud.solicitadoPor !== u.id)) {
      items.push({ id: p.clave, tipo: 'PARAMETRO', titulo: 'Aprobar cambio de parámetro', detalle: `${p.nombre}: ${p.valor} → ${p.solicitud!.valorPropuesto} ${p.unidad}`, folio: null, ruta: '/parametros', accion: 'aprobar', fecha: p.solicitud!.fecha, urgente: true });
    }
  }
  if (m.tienePermisoEn(u.id, 'periodo.aprobar', null, ctx.ahora)) {
    for (const p of m.db.t.periodos.filter((x) => x.estado === 'REAPERTURA_SOLICITADA' && x.solicitudReapertura?.usuarioId !== u.id)) {
      items.push({ id: p.clave, tipo: 'PERIODO', titulo: 'Autorizar reapertura de periodo', detalle: `Periodo ${p.clave}`, folio: null, ruta: '/reportes?pestana=periodos', accion: 'aprobar', fecha: p.solicitudReapertura!.fecha, urgente: true });
    }
  }
  if (m.tienePermisoEn(u.id, 'hallazgos.gestionar', null, ctx.ahora)) {
    const roles = m.rolesDe(u.id, ctx.ahora);
    for (const h of m.db.t.hallazgos.filter((x) => x.estado === 'ABIERTO' && x.destinatarios.some((d) => roles.includes(d)))) {
      items.push({ id: h.id, tipo: 'HALLAZGO', titulo: 'Revisar hallazgo', detalle: h.titulo, folio: null, ruta: `/hallazgos?id=${h.id}`, accion: 'revisar', fecha: h.fecha, urgente: h.severidad === 'ALTA' || h.severidad === 'CRITICA' });
    }
  }
  return items.sort((a, b) => Number(b.urgente) - Number(a.urgente) || b.fecha.localeCompare(a.fecha));
}

export function tablero(m: Motor, ctx: Ctx): Tablero {
  const u = m.exigirSesion(ctx);
  const alcance = m.almacenesDe(u.id, ctx.ahora);
  const docs = documentosVisibles(m, ctx);
  const veValor = m.tienePermisoEn(u.id, 'valuacion.ver', null, ctx.ahora) || m.tienePermisoEn(u.id, 'existencias.ver', null, ctx.ahora);
  const mes = ctx.ahora.toISOString().slice(0, 7);
  const mermasMes = m.db.t.movimientos.filter((x) => (x.tipo === 'MERMA' || x.tipo === 'AJUSTE_NEG') && x.fecha.startsWith(mes) && (x.almacen === 'TRANSITO' || alcance.includes(x.almacen)));
  const conteosCerrados = m.db.t.conteos.filter((c) => c.estado === 'CERRADO' && alcance.includes(c.almacen) && c.ira != null);
  let bajo = 0;
  for (const a of alcance) {
    for (const p of m.db.t.productos.filter((x) => x.activo)) {
      const ex = m.db.t.existencias[llaveExistencia(a, p.id)];
      if (ex && ex.fisica - ex.reservada < p.puntoReorden * (a === 'CEN' ? 1 : 0.4)) bajo += 1;
    }
  }
  const roles = m.rolesDe(u.id, ctx.ahora);
  const veHallazgos = m.tienePermisoEn(u.id, 'hallazgos.ver', null, ctx.ahora);
  return {
    pendientesMios: bandeja(m, ctx).length,
    enTransito: docs.filter((d) => d.estado === 'EN_TRANSITO').length,
    discrepanciasAbiertas: docs.filter((d) => d.estado === 'CON_DISCREPANCIA').length,
    valorInventario: veValor && m.tienePermisoEn(u.id, 'existencias.ver', null, ctx.ahora)
      ? redondear(alcance.reduce((s, a) => s + m.db.t.productos.reduce((x, p) => x + (m.db.t.existencias[llaveExistencia(a, p.id)]?.fisica ?? 0) * p.costoPromedio, 0), 0))
      : null,
    mermaMes: m.tienePermisoEn(u.id, 'reportes.ver', null, ctx.ahora) ? redondear(mermasMes.reduce((s, x) => s + x.salida * x.costoUnitario, 0)) : null,
    ira: conteosCerrados.length ? redondear(conteosCerrados.reduce((s, c) => s + (c.ira ?? 0), 0) / conteosCerrados.length, 1) : null,
    bajoReorden: m.tienePermisoEn(u.id, 'existencias.ver', null, ctx.ahora) ? bajo : 0,
    hallazgosAbiertos: veHallazgos
      ? m.db.t.hallazgos.filter((h) => h.estado !== 'JUSTIFICADO' && (roles.includes('AUD') || h.destinatarios.some((d) => roles.includes(d)))).length
      : 0,
    recientes: docs.slice(0, 8).map((d) => m.resumenDocumento(d, u.id, ctx.ahora)),
    mermaPorAlmacen: m.tienePermisoEn(u.id, 'reportes.ver', null, ctx.ahora)
      ? alcance.map((a) => ({
          almacen: a,
          valor: redondear(
            mermasMes
              .filter((x) => x.almacen === a || (x.almacen === 'TRANSITO' && m.db.t.documentos.find((d) => d.id === x.documentoId)?.almacenOrigen === a))
              .reduce((s, x) => s + x.salida * x.costoUnitario, 0),
          ),
        }))
      : null,
  };
}

/* ───────────── Bitácora (RA-LOG-09, RA-LOG-10) ───────────── */

export function consultarBitacora(m: Motor, ctx: Ctx, f: FiltrosBitacora): Paginado<EventoBitacora> {
  const u = m.exigir(ctx, 'bitacora.ver');
  const roles = m.rolesDe(u.id, ctx.ahora);
  const alcance = m.almacenesDe(u.id, ctx.ahora);
  const t = (s: string | undefined) => (s ?? '').trim().toLowerCase();
  const lista = m.db.bitacora
    .filter((e) => {
      if (!roles.includes('AUD') && !roles.includes('SEG') && e.almacen && e.almacen !== 'TRANSITO' && !alcance.includes(e.almacen)) return false;
      if (f.desde && e.fechaHoraUtc < new Date(f.desde).toISOString()) return false;
      if (f.hasta && e.fechaHoraUtc > new Date(`${f.hasta}T23:59:59.999-06:00`).toISOString()) return false;
      if (f.usuario && !e.usuarioNombre.toLowerCase().includes(t(f.usuario))) return false;
      if (f.accion && !e.accion.toLowerCase().includes(t(f.accion))) return false;
      if (f.folio && !(e.folio ?? '').toLowerCase().includes(t(f.folio))) return false;
      if (f.almacen && e.almacen !== f.almacen) return false;
      if (f.resultado && e.resultado !== f.resultado) return false;
      if (f.severidad && e.severidad !== f.severidad) return false;
      if (f.ip && !e.ipOrigen.includes(t(f.ip))) return false;
      return true;
    })
    .slice()
    .reverse();
  return paginar(lista, f.pagina ?? 1, 50);
}

/* ───────────── Reportes ───────────── */

function exigirReportes(m: Motor, ctx: Ctx) {
  const u = m.exigir(ctx, 'reportes.ver');
  return { u, alcance: m.almacenesDe(u.id, ctx.ahora) };
}

export function reporteValuacion(m: Motor, ctx: Ctx): FilaValuacion[] {
  const u = m.exigir(ctx, 'valuacion.ver');
  const alcance = m.almacenesDe(u.id, ctx.ahora);
  const filas: FilaValuacion[] = [];
  for (const a of [...alcance, 'TRANSITO' as const]) {
    for (const p of m.db.t.productos) {
      const ex = m.db.t.existencias[llaveExistencia(a, p.id)];
      if (!ex || ex.fisica === 0) continue;
      filas.push({ almacen: a, sku: p.sku, descripcion: p.descripcion, existencia: ex.fisica, costoPromedio: p.costoPromedio, valor: redondear(ex.fisica * p.costoPromedio) });
    }
  }
  return filas;
}

export function reporteMermas(m: Motor, ctx: Ctx): FilaMerma[] {
  const { alcance } = exigirReportes(m, ctx);
  return m.db.t.movimientos
    .filter((x) => (x.tipo === 'MERMA' || x.tipo === 'AJUSTE_NEG') && (x.almacen === 'TRANSITO' || alcance.includes(x.almacen)))
    .map((x) => {
      const d = m.db.t.documentos.find((y) => y.id === x.documentoId)!;
      return {
        folio: x.folio,
        documentoId: x.documentoId,
        fecha: x.fecha,
        almacen: x.almacen,
        motivo:
          d.tipo === 'TRF'
            ? `Incidencia de transferencia (${(d.incidencia?.tipoResolucion ?? '').replace('_', ' ').toLowerCase()})`
            : (MOTIVOS.find((mo) => mo.clave === d.motivo)?.nombre ?? d.motivo ?? ''),
        usuario: m.nombre(d.creadoPor.usuarioId),
        aprobadores: [d.aprobador1, d.aprobador2, d.incidencia?.resueltoPor].filter(Boolean).map((p) => m.nombre(p!.usuarioId)).join(', '),
        cantidad: x.salida,
        valor: redondear(x.salida * x.costoUnitario),
      };
    })
    .reverse();
}

export function reporteDiscrepancias(m: Motor, ctx: Ctx): FilaDiscrepancia[] {
  const { alcance } = exigirReportes(m, ctx);
  return m.db.t.documentos
    .filter((d) => d.tipo === 'TRF' && d.incidencia && (alcance.includes(d.almacenOrigen!) || alcance.includes(d.almacenDestino!)))
    .map((d) => ({
      folio: d.folio,
      documentoId: d.id,
      origen: d.almacenOrigen!,
      destino: d.almacenDestino!,
      transportista: d.transporte?.transportista ?? '—',
      diferenciaPiezas: d.incidencia!.renglones.reduce((s, r) => s + r.diferencia, 0),
      diferenciaValor: redondear(
        d.incidencia!.renglones.reduce((s, r) => {
          const ren = d.renglones.find((x) => m.producto(x.productoId).sku === r.sku);
          return s + r.diferencia * (ren?.costoUnitario ?? 0);
        }, 0),
      ),
      estado: d.incidencia!.estado,
      resolucion: d.incidencia!.resolucion ? `${d.incidencia!.tipoResolucion}: ${d.incidencia!.resolucion}` : null,
    }));
}

/** RF-REP-06 / RS-TRX-11: existencias = suma de movimientos, por almacén y producto. */
export function conciliacion(m: Motor, ctx: Ctx): FilaConciliacion[] {
  const { alcance } = exigirReportes(m, ctx);
  const filas: FilaConciliacion[] = [];
  for (const a of [...alcance, 'TRANSITO' as const]) {
    for (const p of m.db.t.productos) {
      const registrada = m.db.t.existencias[llaveExistencia(a, p.id)]?.fisica ?? 0;
      const suma = redondear(
        m.db.t.movimientos.filter((x) => x.almacen === a && x.productoId === p.id).reduce((s, x) => s + x.entrada - x.salida, 0),
        4,
      );
      if (registrada === 0 && suma === 0) continue;
      filas.push({ almacen: a, sku: p.sku, existenciaRegistrada: registrada, sumaMovimientos: suma, diferencia: redondear(registrada - suma, 4) });
    }
  }
  return filas;
}

export function reporteFueraHorario(m: Motor, ctx: Ctx): FilaFueraHorario[] {
  const { alcance } = exigirReportes(m, ctx);
  return m.db.bitacora
    .filter((e) => e.entidad === 'documento' && e.resultado === 'EXITO' && (!e.almacen || e.almacen === 'TRANSITO' || alcance.includes(e.almacen as AlmacenClave)) && fueraDeHorario(e.fechaHoraUtc))
    .map((e) => ({ fecha: e.fechaHoraUtc, folio: e.folio ?? '—', accion: e.accion, usuario: e.usuarioNombre, almacen: e.almacen ?? '—' }))
    .reverse();
}

export function reporteTopUsuarios(m: Motor, ctx: Ctx): FilaTopUsuario[] {
  exigirReportes(m, ctx);
  const mapa = new Map<string, FilaTopUsuario>();
  const fila = (id: string) => {
    if (!mapa.has(id)) mapa.set(id, { usuario: m.nombre(id), ajustes: 0, cancelaciones: 0, rechazos: 0, valorAjustesNeg: 0 });
    return mapa.get(id)!;
  };
  for (const d of m.db.t.documentos) {
    if (d.tipo === 'AJU') {
      const f = fila(d.creadoPor.usuarioId);
      f.ajustes += 1;
      if (d.estado === 'APLICADO') f.valorAjustesNeg = redondear(f.valorAjustesNeg + d.renglones.filter((r) => r.cantidad < 0).reduce((s, r) => s + -r.cantidad * r.costoUnitario, 0));
    }
    if (d.canceladoPor) fila(d.canceladoPor.usuarioId).cancelaciones += 1;
    if (d.rechazadoPor) fila(d.creadoPor.usuarioId).rechazos += 1;
  }
  return [...mapa.values()].sort((a, b) => b.valorAjustesNeg - a.valorAjustesNeg || b.ajustes + b.cancelaciones - (a.ajustes + a.cancelaciones)).slice(0, 10);
}

/** RN-08: los folios son consecutivos; cualquier hueco indica un documento borrado. */
export function foliosFaltantes(m: Motor, ctx: Ctx): { serie: string; faltantes: string[]; emitidos: number }[] {
  exigirReportes(m, ctx);
  const resultado: { serie: string; faltantes: string[]; emitidos: number }[] = [];
  for (const [serie, ultimo] of Object.entries(m.db.t.folios)) {
    const existentes = new Set(
      [...m.db.t.documentos.map((d) => d.folio), ...m.db.t.conteos.map((c) => c.folio), ...m.db.t.ordenesCompra.map((o) => o.folio)].filter((f) => f.startsWith(`${serie}-`)),
    );
    const faltantes: string[] = [];
    for (let i = 1; i <= ultimo; i++) {
      const f = `${serie}-${String(i).padStart(6, '0')}`;
      if (!existentes.has(f)) faltantes.push(f);
    }
    resultado.push({ serie, faltantes, emitidos: ultimo });
  }
  return resultado.sort((a, b) => a.serie.localeCompare(b.serie));
}

export function exigirAlmacenValido(a: string | null | undefined): AlmacenClave | null {
  if (!a) return null;
  if (!(TODOS_ALMACENES as string[]).includes(a)) throw new ErrorApi(400, 'PARAMETRO_INVALIDO', 'Almacén inválido.');
  return a as AlmacenClave;
}
