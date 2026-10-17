/**
 * Catálogo, órdenes de compra, existencias, kardex, series y conteos físicos del mock.
 */
import type {
  AlmacenClave,
  CambioCosto,
  ClaseAbc,
  Conteo,
  Existencia,
  Movimiento,
  OrdenCompra,
  Paginado,
  Producto,
  RastreoSerie,
  UnidadMedida,
} from '@/api/types';
import { redondear } from '@/domain/formato';
import { ErrorApi, TODOS_ALMACENES, type Ctx, type Motor } from './motor';
import { llaveExistencia, nuevoId, siguienteFolio, type ConteoDB, type DocumentoDB, type ProductoDB } from './estado';

export function paginar<T>(lista: T[], pagina: number, porPagina = 25): Paginado<T> {
  const pp = Math.min(100, Math.max(1, porPagina)); // RS-VAL-07
  const p = Math.max(1, Math.floor(pagina) || 1);
  return { datos: lista.slice((p - 1) * pp, p * pp), pagina: p, porPagina: pp, total: lista.length };
}

function vistaProducto({ historialCosto: _h, ...p }: ProductoDB): Producto {
  return p;
}

/* ───────────── Productos ───────────── */

export function listarProductos(m: Motor, ctx: Ctx, q: string, incluirInactivos: boolean): Producto[] {
  m.exigir(ctx, 'catalogo.ver');
  const t = q.trim().toLowerCase();
  return m.db.t.productos
    .filter((p) => (incluirInactivos || p.activo) && (!t || p.sku.toLowerCase().includes(t) || p.descripcion.toLowerCase().includes(t) || p.categoria.toLowerCase().includes(t)))
    .map(vistaProducto);
}

export function historialCosto(m: Motor, ctx: Ctx, id: string): CambioCosto[] {
  m.exigir(ctx, 'catalogo.ver');
  const p = m.producto(id);
  return p.historialCosto.map((h) => ({ fecha: h.fecha, anterior: h.anterior, nuevo: h.nuevo, motivo: h.motivo, usuario: m.nombre(h.usuarioId) })).reverse();
}

type DatosProducto = {
  sku: string;
  descripcion: string;
  categoria: string;
  unidad: UnidadMedida;
  costoEstandar: number;
  stockMinimo: number;
  stockMaximo: number;
  puntoReorden: number;
  claseAbc: ClaseAbc;
  serializado: boolean;
  sensible: boolean;
};

function validarProducto(d: DatosProducto) {
  const e: { campo: string; mensaje: string }[] = [];
  if (!/^[A-Z0-9-]{3,20}$/.test(d.sku ?? '')) e.push({ campo: 'sku', mensaje: 'SKU de 3 a 20 caracteres: mayúsculas, números y guiones.' });
  if ((d.descripcion ?? '').trim().length < 5 || d.descripcion.length > 120) e.push({ campo: 'descripcion', mensaje: 'Descripción de 5 a 120 caracteres.' });
  if ((d.categoria ?? '').trim().length < 3) e.push({ campo: 'categoria', mensaje: 'Indica la categoría.' });
  if (!['PZA', 'CAJA', 'M', 'KIT'].includes(d.unidad)) e.push({ campo: 'unidad', mensaje: 'Unidad inválida.' });
  if (!(d.costoEstandar > 0) || d.costoEstandar > 1_000_000) e.push({ campo: 'costoEstandar', mensaje: 'Costo mayor a 0.' });
  if (!(d.stockMinimo >= 0)) e.push({ campo: 'stockMinimo', mensaje: 'Mínimo 0.' });
  if (!(d.stockMaximo > d.stockMinimo)) e.push({ campo: 'stockMaximo', mensaje: 'Debe ser mayor que el mínimo.' });
  if (!(d.puntoReorden >= d.stockMinimo && d.puntoReorden <= d.stockMaximo)) e.push({ campo: 'puntoReorden', mensaje: 'Entre el mínimo y el máximo.' });
  if (!['A', 'B', 'C'].includes(d.claseAbc)) e.push({ campo: 'claseAbc', mensaje: 'Clase inválida.' });
  if (e.length) throw new ErrorApi(422, 'VALIDACION', 'Revisa los datos marcados.', e);
}

export function crearProducto(m: Motor, ctx: Ctx, d: DatosProducto): Producto {
  const u = m.exigir(ctx, 'catalogo.editar');
  const datos = { ...d, sku: String(d.sku ?? '').trim().toUpperCase() };
  validarProducto(datos);
  if (m.db.t.productos.some((p) => p.sku === datos.sku)) throw new ErrorApi(409, 'DUPLICADO', 'Ya existe un producto con ese SKU.', [{ campo: 'sku', mensaje: 'Duplicado.' }]);
  const p: ProductoDB = {
    id: nuevoId('p'),
    sku: datos.sku,
    descripcion: datos.descripcion.trim(),
    categoria: datos.categoria.trim(),
    unidad: datos.unidad,
    costoEstandar: redondear(datos.costoEstandar),
    costoPromedio: redondear(datos.costoEstandar),
    stockMinimo: datos.stockMinimo,
    stockMaximo: datos.stockMaximo,
    puntoReorden: datos.puntoReorden,
    claseAbc: datos.claseAbc,
    serializado: !!datos.serializado,
    sensible: !!datos.sensible,
    activo: true,
    version: 1,
    historialCosto: [{ fecha: ctx.ahora.toISOString(), anterior: 0, nuevo: redondear(datos.costoEstandar), motivo: 'Alta del producto', usuarioId: u.id }],
  };
  m.db.t.productos.push(p);
  m.evento(ctx, { accion: 'PRODUCTO_CREAR', entidad: 'producto', idEntidad: p.id, valorNuevo: { ...vistaProducto(p) } });
  return vistaProducto(p);
}

export function actualizarProducto(m: Motor, ctx: Ctx, id: string, d: DatosProducto & { version: number; motivoCambioCosto?: string; activo?: boolean }): Producto {
  const u = m.exigir(ctx, 'catalogo.editar');
  const p = m.producto(id);
  if (d.version !== p.version) throw new ErrorApi(409, 'VERSION_CONFLICTO', 'Otra persona modificó este producto. Se recargó la versión actual.');
  validarProducto({ ...d, sku: p.sku });
  const antes = vistaProducto(structuredClone(p));
  if (d.serializado !== p.serializado) {
    const hayExistencia = Object.entries(m.db.t.existencias).some(([k, v]) => k.endsWith(`|${p.id}`) && v.fisica > 0);
    if (hayExistencia) throw new ErrorApi(409, 'REGLA_NEGOCIO', 'No se puede cambiar el control por serie mientras haya existencia.', [{ campo: 'serializado', mensaje: 'Hay existencia.' }]);
  }
  if (redondear(d.costoEstandar) !== p.costoEstandar) {
    const motivo = (d.motivoCambioCosto ?? '').trim();
    if (motivo.length < 15) throw new ErrorApi(422, 'VALIDACION', 'Explica el cambio de costo (mínimo 15 caracteres).', [{ campo: 'motivoCambioCosto', mensaje: 'Requerido (RF-CAT-03).' }]);
    p.historialCosto.push({ fecha: ctx.ahora.toISOString(), anterior: p.costoEstandar, nuevo: redondear(d.costoEstandar), motivo, usuarioId: u.id });
  }
  if (d.activo === false && p.activo) {
    const hayExistencia = Object.entries(m.db.t.existencias).some(([k, v]) => k.endsWith(`|${p.id}`) && v.fisica > 0);
    if (hayExistencia) throw new ErrorApi(409, 'REGLA_NEGOCIO', 'No puedes desactivar un producto con existencia.');
  }
  Object.assign(p, {
    descripcion: d.descripcion.trim(),
    categoria: d.categoria.trim(),
    unidad: d.unidad,
    costoEstandar: redondear(d.costoEstandar),
    stockMinimo: d.stockMinimo,
    stockMaximo: d.stockMaximo,
    puntoReorden: d.puntoReorden,
    claseAbc: d.claseAbc,
    serializado: !!d.serializado,
    sensible: !!d.sensible,
    activo: d.activo ?? p.activo,
    version: p.version + 1,
  });
  const cambios = Object.fromEntries(Object.entries(vistaProducto(p)).filter(([k, v]) => (antes as unknown as Record<string, unknown>)[k] !== v && k !== 'version'));
  m.evento(ctx, {
    accion: d.activo === false ? 'PRODUCTO_DESACTIVAR' : 'PRODUCTO_EDITAR',
    entidad: 'producto',
    idEntidad: p.id,
    severidad: 'costoEstandar' in cambios ? 'MEDIA' : 'INFO',
    valorAnterior: Object.fromEntries(Object.keys(cambios).map((k) => [k, (antes as unknown as Record<string, unknown>)[k]])),
    valorNuevo: cambios,
  });
  return vistaProducto(p);
}

/* ───────────── Órdenes de compra ───────────── */

export function vistaOc(m: Motor, oc: Motor['db']['t']['ordenesCompra'][number]): OrdenCompra {
  const prov = m.proveedores.find((p) => p.id === oc.proveedorId)!;
  return {
    id: oc.id,
    folio: oc.folio,
    proveedor: prov,
    almacenDestino: oc.almacenDestino,
    estado: oc.estado,
    renglones: oc.renglones.map((r) => {
      const p = m.producto(r.productoId);
      return { productoId: r.productoId, sku: p.sku, descripcion: p.descripcion, cantidad: r.cantidad, recibida: r.recibida, costoUnitario: r.costoUnitario };
    }),
    creadoPor: { usuario: { id: oc.creadoPor.usuarioId, nombre: m.nombre(oc.creadoPor.usuarioId) }, fecha: oc.creadoPor.fecha },
    total: redondear(oc.renglones.reduce((s, r) => s + r.cantidad * r.costoUnitario, 0)),
  };
}

export function listarOc(m: Motor, ctx: Ctx, soloAbiertas: boolean, almacen: AlmacenClave | null): OrdenCompra[] {
  const u = m.exigir(ctx, 'oc.ver');
  const alcance = m.almacenesDe(u.id, ctx.ahora);
  return m.db.t.ordenesCompra
    .filter((o) => alcance.includes(o.almacenDestino) && (!almacen || o.almacenDestino === almacen) && (!soloAbiertas || o.estado === 'ABIERTA' || o.estado === 'PARCIAL'))
    .map((o) => vistaOc(m, o));
}

export function crearOc(m: Motor, ctx: Ctx, d: { proveedorId: string; almacenDestino: AlmacenClave; renglones: { productoId: string; cantidad: number; costoUnitario: number }[] }): OrdenCompra {
  const u = m.exigir(ctx, 'oc.crear');
  const e: { campo: string; mensaje: string }[] = [];
  if (!m.proveedores.some((p) => p.id === d.proveedorId)) e.push({ campo: 'proveedorId', mensaje: 'Elige un proveedor.' });
  if (!TODOS_ALMACENES.includes(d.almacenDestino)) e.push({ campo: 'almacenDestino', mensaje: 'Elige el almacén.' });
  if (!d.renglones?.length) e.push({ campo: 'renglones', mensaje: 'Agrega al menos un producto.' });
  d.renglones?.forEach((r, i) => {
    if (!m.db.t.productos.some((p) => p.id === r.productoId && p.activo)) e.push({ campo: `renglones.${i}`, mensaje: 'Producto inválido.' });
    if (!(r.cantidad > 0) || r.cantidad > 1_000_000) e.push({ campo: `renglones.${i}`, mensaje: 'Cantidad inválida.' });
    if (!(r.costoUnitario > 0)) e.push({ campo: `renglones.${i}`, mensaje: 'Costo inválido.' });
  });
  if (e.length) throw new ErrorApi(422, 'VALIDACION', 'Revisa los datos marcados.', e);
  const oc = {
    id: nuevoId('oc'),
    folio: siguienteFolio(m.db.t, 'OC', d.almacenDestino),
    proveedorId: d.proveedorId,
    almacenDestino: d.almacenDestino,
    estado: 'ABIERTA' as const,
    renglones: d.renglones.map((r) => ({ productoId: r.productoId, cantidad: r.cantidad, recibida: 0, costoUnitario: redondear(r.costoUnitario, 4) })),
    creadoPor: { usuarioId: u.id, fecha: ctx.ahora.toISOString() },
  };
  m.db.t.ordenesCompra.unshift(oc);
  m.evento(ctx, { accion: 'OC_CREAR', entidad: 'orden_compra', idEntidad: oc.id, folio: oc.folio, almacen: oc.almacenDestino, valorNuevo: { renglones: oc.renglones } });
  return vistaOc(m, oc);
}

/* ───────────── Existencias, kardex y series ───────────── */

export function existencias(m: Motor, ctx: Ctx, almacen: AlmacenClave | null, q: string, soloBajoReorden: boolean): Existencia[] {
  const u = m.exigir(ctx, 'existencias.ver');
  const alcance = m.almacenesDe(u.id, ctx.ahora);
  if (almacen && !alcance.includes(almacen)) throw new ErrorApi(403, 'FUERA_DE_ALCANCE', `No tienes acceso al almacén ${almacen}.`);
  const almacenes = almacen ? [almacen] : alcance;
  const t = q.trim().toLowerCase();
  const filas: Existencia[] = [];
  for (const a of almacenes) {
    for (const p of m.db.t.productos) {
      if (!p.activo) continue;
      if (t && !p.sku.toLowerCase().includes(t) && !p.descripcion.toLowerCase().includes(t)) continue;
      const ex = m.db.t.existencias[llaveExistencia(a, p.id)] ?? { fisica: 0, reservada: 0 };
      const entrante = m.db.t.documentos
        .filter((d) => d.tipo === 'TRF' && d.estado === 'EN_TRANSITO' && d.almacenDestino === a)
        .reduce((s, d) => s + d.renglones.filter((r) => r.productoId === p.id).reduce((x, r) => x + (r.cantidadEnviada ?? 0), 0), 0);
      if (ex.fisica === 0 && entrante === 0 && ex.reservada === 0) continue;
      const fila: Existencia = {
        almacen: a,
        producto: { id: p.id, sku: p.sku, descripcion: p.descripcion, unidad: p.unidad, categoria: p.categoria, serializado: p.serializado, sensible: p.sensible, claseAbc: p.claseAbc, puntoReorden: p.puntoReorden },
        fisica: ex.fisica,
        reservada: ex.reservada,
        disponible: redondear(ex.fisica - ex.reservada, 4),
        enTransitoEntrante: entrante,
        costoPromedio: p.costoPromedio,
        valor: redondear(ex.fisica * p.costoPromedio),
        bajoReorden: ex.fisica - ex.reservada < p.puntoReorden * (a === 'CEN' ? 1 : 0.4),
        bloqueadaPorConteo: !!m.conteoActivo(a, p.id),
      };
      if (!soloBajoReorden || fila.bajoReorden) filas.push(fila);
    }
  }
  return filas;
}

export function kardex(m: Motor, ctx: Ctx, productoId: string, almacen: AlmacenClave | 'TRANSITO'): Movimiento[] {
  const u = m.exigir(ctx, 'existencias.ver');
  if (almacen !== 'TRANSITO' && !m.almacenesDe(u.id, ctx.ahora).includes(almacen)) {
    throw new ErrorApi(403, 'FUERA_DE_ALCANCE', `No tienes acceso al almacén ${almacen}.`);
  }
  m.producto(productoId);
  return m.db.t.movimientos.filter((x) => x.productoId === productoId && x.almacen === almacen).slice().reverse();
}

export function rastrearSerie(m: Motor, ctx: Ctx, numero: string): RastreoSerie {
  m.exigir(ctx, 'existencias.ver');
  const n = numero.trim().toUpperCase();
  const s = m.db.t.series[n];
  if (!s) throw new ErrorApi(404, 'NO_ENCONTRADO', `No hay registro de la serie ${n}.`);
  const p = m.producto(s.productoId);
  return { numero: n, producto: { id: p.id, sku: p.sku, descripcion: p.descripcion }, ubicacion: s.ubicacion, recorrido: s.recorrido.slice().reverse() };
}

export function seriesDisponibles(m: Motor, ctx: Ctx, productoId: string, almacen: AlmacenClave): string[] {
  const u = m.exigirSesion(ctx);
  if (!m.almacenesDe(u.id, ctx.ahora).includes(almacen)) throw new ErrorApi(403, 'FUERA_DE_ALCANCE', 'Fuera de tu alcance.');
  const reservadas = new Set(
    m.db.t.documentos
      .filter((d) => (d.estado === 'EN_TRANSITO' || d.estado === 'SURTIDA') && d.almacenOrigen === almacen)
      .flatMap((d) => d.renglones.flatMap((r) => r.series)),
  );
  return Object.entries(m.db.t.series)
    .filter(([k, v]) => v.productoId === productoId && v.ubicacion === almacen && !reservadas.has(k))
    .map(([k]) => k)
    .sort();
}

/* ───────────── Conteos físicos (RF-CNT) ───────────── */

export function vistaConteo(m: Motor, c: ConteoDB, uid: string, ahora: Date): Conteo {
  const puedeCerrar = m.tienePermisoEn(uid, 'conteo.cerrar', c.almacen, ahora);
  const esContador = m.tienePermisoEn(uid, 'conteo.capturar', c.almacen, ahora);
  const cerrado = c.estado === 'CERRADO' || c.estado === 'CANCELADO';
  // Conteo ciego (RF-CNT-03): quien cuenta no ve la existencia del sistema ni el primer conteo
  const ocultarSistema = !cerrado && esContador && !puedeCerrar && !m.rolesDe(uid, ahora).includes('AUD');
  const ocultarPrimero = c.estado === 'SEGUNDO_CONTEO' && ocultarSistema;
  const permitidas: Conteo['accionesPermitidas'] = [];
  const bloqueos: Conteo['bloqueos'] = [];
  const participo = c.renglones.some((r) => r.contador1 === uid || r.contador2 === uid);
  if (c.estado === 'PROGRAMADO' && m.tienePermisoEn(uid, 'conteo.programar', c.almacen, ahora)) permitidas.push('iniciar', 'cancelar');
  if (c.estado === 'EN_CONTEO' && esContador) permitidas.push('capturar_primero');
  if (c.estado === 'SEGUNDO_CONTEO' && esContador) {
    if (c.renglones.some((r) => r.requiereSegundo && r.contador1 === uid)) bloqueos.push({ accion: 'capturar_segundo', mensaje: 'Hiciste el primer conteo; el segundo debe hacerlo otra persona (RF-CNT-04).' });
    else permitidas.push('capturar_segundo');
  }
  const listoParaCerrar = (c.estado === 'EN_CONTEO' && c.renglones.every((r) => r.conteo1 != null)) || (c.estado === 'SEGUNDO_CONTEO' && c.renglones.every((r) => !r.requiereSegundo || r.conteo2 != null));
  if (listoParaCerrar && puedeCerrar) {
    if (participo) bloqueos.push({ accion: 'cerrar', mensaje: 'Participaste en el conteo; otra persona debe cerrarlo (RS-SOD-08).' });
    else permitidas.push('cerrar');
  }
  return {
    id: c.id,
    folio: c.folio,
    almacen: c.almacen,
    tipo: c.tipo,
    clase: c.clase,
    estado: c.estado,
    programadoPor: { usuario: { id: c.programadoPor.usuarioId, nombre: m.nombre(c.programadoPor.usuarioId) }, fecha: c.programadoPor.fecha },
    iniciadoPor: c.iniciadoPor ? { usuario: { id: c.iniciadoPor.usuarioId, nombre: m.nombre(c.iniciadoPor.usuarioId) }, fecha: c.iniciadoPor.fecha } : null,
    cerradoPor: c.cerradoPor ? { usuario: { id: c.cerradoPor.usuarioId, nombre: m.nombre(c.cerradoPor.usuarioId) }, fecha: c.cerradoPor.fecha } : null,
    renglones: c.renglones.map((r) => {
      const p = m.producto(r.productoId);
      const final = r.conteo2 ?? r.conteo1;
      const dif = final != null && !ocultarSistema ? redondear(final - r.existenciaSistema, 4) : null;
      return {
        productoId: p.id,
        sku: p.sku,
        descripcion: p.descripcion,
        unidad: p.unidad,
        existenciaSistema: ocultarSistema ? null : r.existenciaSistema,
        conteo1: ocultarPrimero ? null : r.conteo1,
        contador1: r.contador1 ? m.nombre(r.contador1) : null,
        conteo2: r.conteo2,
        contador2: r.contador2 ? m.nombre(r.contador2) : null,
        requiereSegundo: r.requiereSegundo,
        diferencia: dif,
        diferenciaValor: dif != null ? redondear(dif * p.costoPromedio) : null,
      };
    }),
    ajustesGenerados: c.ajustesGenerados.map((id) => ({ id, folio: m.db.t.documentos.find((d) => d.id === id)?.folio ?? id })),
    ira: c.ira,
    version: c.version,
    accionesPermitidas: permitidas,
    bloqueos,
    creadoEn: c.creadoEn,
  };
}

export function listarConteos(m: Motor, ctx: Ctx): Conteo[] {
  const u = m.exigir(ctx, 'conteo.ver');
  const alcance = m.almacenesDe(u.id, ctx.ahora);
  return m.db.t.conteos.filter((c) => alcance.includes(c.almacen)).map((c) => vistaConteo(m, c, u.id, ctx.ahora));
}

export function obtenerConteo(m: Motor, ctx: Ctx, id: string): ConteoDB {
  const u = m.exigir(ctx, 'conteo.ver');
  const c = m.db.t.conteos.find((x) => x.id === id);
  if (!c || !m.almacenesDe(u.id, ctx.ahora).includes(c.almacen)) throw new ErrorApi(404, 'NO_ENCONTRADO', 'El conteo no existe o no tienes acceso.');
  return c;
}

export function programarConteo(m: Motor, ctx: Ctx, d: { almacen: AlmacenClave; tipo: 'CICLICO' | 'GENERAL'; clase: ClaseAbc | null; productos?: string[] }): ConteoDB {
  const u = m.exigir(ctx, 'conteo.programar', d.almacen);
  let productos = m.db.t.productos.filter((p) => p.activo);
  if (d.tipo === 'CICLICO') {
    if (d.productos?.length) productos = productos.filter((p) => d.productos!.includes(p.id));
    else if (d.clase) productos = productos.filter((p) => p.claseAbc === d.clase);
    else throw new ErrorApi(422, 'VALIDACION', 'Elige una clase ABC o productos.', [{ campo: 'clase', mensaje: 'Requerido.' }]);
  }
  productos = productos.filter((p) => (m.db.t.existencias[llaveExistencia(d.almacen, p.id)]?.fisica ?? 0) > 0);
  if (!productos.length) throw new ErrorApi(422, 'VALIDACION', 'No hay productos con existencia para contar con ese criterio.');
  const ocupado = productos.find((p) => m.db.t.conteos.some((c) => c.almacen === d.almacen && ['PROGRAMADO', 'EN_CONTEO', 'SEGUNDO_CONTEO'].includes(c.estado) && c.renglones.some((r) => r.productoId === p.id)));
  if (ocupado) throw new ErrorApi(409, 'REGLA_NEGOCIO', `${ocupado.sku} ya está en otro conteo abierto de ${d.almacen}.`);
  const c: ConteoDB = {
    id: nuevoId('cnt'),
    folio: siguienteFolio(m.db.t, 'CNT', d.almacen),
    almacen: d.almacen,
    tipo: d.tipo,
    clase: d.tipo === 'CICLICO' ? d.clase : null,
    estado: 'PROGRAMADO',
    programadoPor: { usuarioId: u.id, fecha: ctx.ahora.toISOString() },
    iniciadoPor: null,
    cerradoPor: null,
    renglones: productos.map((p) => ({ productoId: p.id, existenciaSistema: 0, conteo1: null, contador1: null, conteo2: null, contador2: null, requiereSegundo: false })),
    ajustesGenerados: [],
    ira: null,
    version: 1,
    creadoEn: ctx.ahora.toISOString(),
  };
  m.db.t.conteos.unshift(c);
  m.evento(ctx, { accion: 'CNT_PROGRAMAR', entidad: 'conteo', idEntidad: c.id, folio: c.folio, almacen: c.almacen, valorNuevo: { tipo: c.tipo, clase: c.clase, productos: productos.length } });
  return c;
}

export function accionConteo(
  m: Motor,
  ctx: Ctx,
  c: ConteoDB,
  accion: Conteo['accionesPermitidas'][number],
  cuerpo: { version: number; renglones?: { productoId: string; cantidad: number }[]; motivo?: string },
): void {
  const u = m.exigirSesion(ctx);
  if (cuerpo.version !== c.version) throw new ErrorApi(409, 'VERSION_CONFLICTO', 'El conteo cambió mientras lo revisabas. Se recargó la versión actual.');
  const vista = vistaConteo(m, c, u.id, ctx.ahora);
  if (!vista.accionesPermitidas.includes(accion)) {
    const b = vista.bloqueos.find((x) => x.accion === accion);
    if (b) throw new ErrorApi(403, 'SOD_VIOLATION', b.mensaje);
    throw new ErrorApi(403, 'SIN_PERMISO', 'No puedes realizar esa acción en este conteo.');
  }
  const antes = c.estado;
  const ahoraIso = ctx.ahora.toISOString();
  if (accion === 'iniciar') {
    // Se congela la existencia del sistema al iniciar (RF-CNT-02)
    c.renglones.forEach((r) => {
      r.existenciaSistema = m.db.t.existencias[llaveExistencia(c.almacen, r.productoId)]?.fisica ?? 0;
    });
    c.estado = 'EN_CONTEO';
    c.iniciadoPor = { usuarioId: u.id, fecha: ahoraIso };
  } else if (accion === 'cancelar') {
    if ((cuerpo.motivo ?? '').trim().length < 15) throw new ErrorApi(422, 'VALIDACION', 'Escribe el motivo (mínimo 15 caracteres).', [{ campo: 'motivo', mensaje: 'Mínimo 15.' }]);
    c.estado = 'CANCELADO';
  } else if (accion === 'capturar_primero' || accion === 'capturar_segundo') {
    const segundo = accion === 'capturar_segundo';
    const errores: { campo: string; mensaje: string }[] = [];
    const objetivo = c.renglones.filter((r) => (segundo ? r.requiereSegundo : true));
    for (const r of objetivo) {
      const cap = (cuerpo.renglones ?? []).find((x) => x.productoId === r.productoId);
      if (!cap || !(Number(cap.cantidad) >= 0) || !Number.isFinite(Number(cap.cantidad))) {
        errores.push({ campo: r.productoId, mensaje: 'Captura la cantidad contada (0 si no hay).' });
        continue;
      }
      if (segundo) {
        if (r.contador1 === u.id) throw new ErrorApi(403, 'SOD_VIOLATION', 'El segundo conteo debe hacerlo otra persona.');
        r.conteo2 = Number(cap.cantidad);
        r.contador2 = u.id;
      } else {
        r.conteo1 = Number(cap.cantidad);
        r.contador1 = u.id;
      }
    }
    if (errores.length) throw new ErrorApi(422, 'VALIDACION', 'Faltan cantidades por capturar.', errores);
    if (!segundo) {
      const pct = m.parametro('tolerancia_conteo_pct');
      const mxn = m.parametro('tolerancia_conteo_mxn');
      c.renglones.forEach((r) => {
        const p = m.producto(r.productoId);
        const dif = Math.abs((r.conteo1 ?? 0) - r.existenciaSistema);
        const difPct = r.existenciaSistema > 0 ? (dif / r.existenciaSistema) * 100 : dif > 0 ? 100 : 0;
        r.requiereSegundo = difPct > pct || dif * p.costoPromedio > mxn;
      });
      if (c.renglones.some((r) => r.requiereSegundo)) c.estado = 'SEGUNDO_CONTEO';
    }
  } else if (accion === 'cerrar') {
    const ajustes: { productoId: string; dif: number }[] = [];
    let correctos = 0;
    c.renglones.forEach((r) => {
      const final = r.requiereSegundo ? (r.conteo2 ?? r.conteo1 ?? 0) : (r.conteo1 ?? 0);
      const dif = redondear(final - r.existenciaSistema, 4);
      if (dif === 0) correctos += 1;
      else ajustes.push({ productoId: r.productoId, dif });
    });
    c.ira = redondear((correctos / c.renglones.length) * 100, 1);
    c.estado = 'CERRADO';
    c.cerradoPor = { usuarioId: u.id, fecha: ahoraIso };
    if (ajustes.length) {
      // RF-CNT-05: las diferencias generan un ajuste PENDIENTE de aprobación, nunca automático
      const contadores = [...new Set(c.renglones.flatMap((r) => [r.contador1, r.contador2]).filter((x): x is string => !!x))];
      const doc: DocumentoDB = {
        id: nuevoId('doc'),
        tipo: 'AJU',
        folio: siguienteFolio(m.db.t, 'AJU', c.almacen),
        estado: 'PENDIENTE',
        version: 1,
        almacenOrigen: c.almacen,
        almacenDestino: null,
        motivo: 'DIFERENCIA_CONTEO',
        justificacion: `Diferencias del conteo físico ${c.folio} (IRA ${c.ira} %).`,
        centroCosto: null,
        ordenCompraId: null,
        proveedorId: null,
        transporte: null,
        fechaRequerida: null,
        fechaMovimiento: ahoraIso,
        extemporanea: false,
        renglones: ajustes.map((a) => ({
          id: nuevoId('ren'),
          productoId: a.productoId,
          cantidad: a.dif,
          cantidadEsperada: null,
          cantidadSurtida: null,
          cantidadEnviada: null,
          cantidadRecibida: null,
          costoUnitario: m.producto(a.productoId).costoPromedio,
          series: [],
          seriesRecibidas: [],
          ocRenglon: null,
        })),
        nivelAprobacion: 'SUP',
        creadoPor: { usuarioId: u.id, fecha: ahoraIso },
        enviadoAprobacionPor: { usuarioId: u.id, fecha: ahoraIso },
        aprobador1: null,
        aprobador2: null,
        surtidoPor: null,
        enviadoPor: null,
        recibidoPor: null,
        entregadoA: null,
        rechazadoPor: null,
        canceladoPor: null,
        motivoRechazo: null,
        motivoCancelacion: null,
        incidencia: null,
        adjuntos: [],
        creadoEn: ahoraIso,
        actualizadoEn: ahoraIso,
        contadores,
        referencia: c.folio,
        alertaTransitoEmitida: false,
      };
      doc.nivelAprobacion = m.montoDocumento(doc) > m.parametro('umbral_ajuste_n2') ? 'SUP+GER' : 'SUP';
      m.db.t.documentos.unshift(doc);
      c.ajustesGenerados.push(doc.id);
      m.evento(ctx, { accion: 'AJU_CREAR', entidad: 'documento', idEntidad: doc.id, folio: doc.folio, almacen: c.almacen, valorNuevo: { origen: c.folio, renglones: ajustes, estado: 'PENDIENTE' } });
    }
  }
  c.version += 1;
  m.evento(ctx, {
    accion: `CNT_${accion.toUpperCase()}`,
    entidad: 'conteo',
    idEntidad: c.id,
    folio: c.folio,
    almacen: c.almacen,
    valorAnterior: { estado: antes },
    valorNuevo: { estado: c.estado, ira: c.ira },
  });
}
