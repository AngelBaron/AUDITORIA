/**
 * Motor de reglas del backend simulado.
 *
 * Implementa del lado "servidor" los controles que el auditor revisará, para que el frontend
 * se ejercite contra respuestas reales (403, 404, 409, 422…) y para servir como especificación
 * ejecutable del backend:
 *  - RBAC con alcance por almacén (RS-RBAC, RS-ACC)
 *  - Segregación de funciones por usuario (RS-SOD-01 a 14)
 *  - Máquina de estados (RS-TRX-09) y bloqueo optimista por versión (RS-TRX-06)
 *  - Transacción todo-o-nada con rollback (RS-TRX-01) e idempotencia (RS-TRX-07)
 *  - Bitácora encadenada escrita en la misma transacción (RA-LOG-03) y de intentos fallidos (RA-LOG-04)
 */
import type {
  AccionDocumento,
  AlmacenClave,
  BloqueoAccion,
  CuerpoAccion,
  Documento,
  DocumentoNuevo,
  DocumentoResumen,
  EstadoDocumento,
  Permiso,
  RenglonDocumento,
  RolClave,
  Severidad,
  TipoDocumento,
  TipoMovimiento,
} from '@/api/types';
import { ROL_PERMISOS, ROLES_GLOBALES } from '@/domain/permisos';
import { redondear } from '@/domain/formato';
import { igualSeguro } from '@/domain/seguridad';
import { sellarEventos, type EventoPendiente } from './bitacora';
import {
  crearBaseVacia,
  llaveExistencia,
  nuevoId,
  siguienteFolio,
  type DocumentoDB,
  type HallazgoDB,
  type PartDB,
  type RenglonDB,
  type SesionDB,
  type UsuarioDB,
} from './estado';
import { MOTIVOS } from './semilla';

export class ErrorApi extends Error {
  constructor(
    public status: number,
    public codigo: string,
    message: string,
    public detalles?: { campo: string; mensaje: string }[],
  ) {
    super(message);
  }
}

export interface Ctx {
  usuario: UsuarioDB | null;
  sesion: SesionDB | null;
  ip: string;
  userAgent: string;
  correlacion: string;
  ahora: Date;
}

export interface Operacion {
  accion: string;
  entidad: string;
  idEntidad?: string | null;
  folio?: string | null;
  almacen?: AlmacenClave | 'TRANSITO' | null;
}

export const TODOS_ALMACENES: AlmacenClave[] = ['CEN', 'NTE', 'CTR', 'SUR'];

const MOTIVO_NOMBRE: Record<string, string> = Object.fromEntries(MOTIVOS.map((m) => [m.clave, m.nombre]));

const SEVERIDAD_RECHAZO: Record<string, Severidad> = {
  SOD_VIOLATION: 'ALTA',
  SIN_PERMISO: 'ALTA',
  FUERA_DE_ALCANCE: 'ALTA',
  NO_ENCONTRADO: 'MEDIA',
  REAUTENTICACION_INVALIDA: 'ALTA',
};

export class Motor {
  db = crearBaseVacia();
  private cola: Promise<unknown> = Promise.resolve();
  private pendientes: EventoPendiente[] = [];
  /** Permite probar el rollback: si se define, se lanza un error después de la operación indicada. */
  fallaSimulada: { despuesDe: 'baja_origen' } | null = null;
  proveedores: { id: string; nombre: string; rfc: string }[] = [];

  /* ───────────── Concurrencia y transacciones ───────────── */

  /** Serializa las escrituras (equivalente a SELECT … FOR UPDATE en orden fijo). */
  exclusivo<T>(fn: () => Promise<T>): Promise<T> {
    const r = this.cola.then(fn, fn);
    this.cola = r.catch(() => undefined);
    return r;
  }

  async transaccion<T>(ctx: Ctx, op: Operacion, fn: () => T | Promise<T>): Promise<T> {
    return this.exclusivo(async () => {
      const respaldo = structuredClone(this.db.t);
      this.pendientes = [];
      try {
        const resultado = await fn();
        const sellados = await sellarEventos(this.db.bitacora, this.pendientes);
        this.db.bitacora.push(...sellados);
        return resultado;
      } catch (e) {
        // ROLLBACK: se restaura el estado completo; los eventos de éxito no se escriben.
        this.db.t = respaldo;
        this.pendientes = [];
        if (e instanceof ErrorApi) {
          await this.registrarRechazo(ctx, op, e);
        } else {
          this.evento(ctx, { ...op, resultado: 'ERROR', motivoRechazo: 'ERROR_INTERNO', severidad: 'ALTA' });
          await this.confirmarPendientes();
        }
        throw e;
      } finally {
        this.pendientes = [];
      }
    });
  }

  /** Registra eventos fuera de una transacción de negocio (consultas sensibles, accesos denegados). */
  async registrarSuelto(ctx: Ctx, datos: Operacion & Partial<EventoPendiente>): Promise<void> {
    await this.exclusivo(async () => {
      this.pendientes = [];
      this.evento(ctx, datos);
      await this.confirmarPendientes();
    });
  }

  private async confirmarPendientes(): Promise<void> {
    const sellados = await sellarEventos(this.db.bitacora, this.pendientes);
    this.db.bitacora.push(...sellados);
    this.pendientes = [];
  }

  /** RA-LOG-04: el intento fallido se guarda en una transacción independiente. */
  private async registrarRechazo(ctx: Ctx, op: Operacion, e: ErrorApi): Promise<void> {
    this.evento(ctx, {
      ...op,
      resultado: 'RECHAZADO',
      motivoRechazo: e.codigo,
      severidad: SEVERIDAD_RECHAZO[e.codigo] ?? 'MEDIA',
      valorNuevo: { mensaje: e.message },
    });
    if (e.codigo === 'SOD_VIOLATION' && ctx.usuario) {
      const uid = ctx.usuario.id;
      const ahora = ctx.ahora.getTime();
      const lista = (this.db.t.violacionesSod[uid] ?? []).filter((t) => ahora - t < 24 * 3600 * 1000);
      lista.push(ahora);
      this.db.t.violacionesSod[uid] = lista;
      if (lista.length === 3) {
        this.crearHallazgo(ctx, {
          categoria: 'SEGURIDAD',
          regla: 'RA-ALR-02',
          titulo: 'Violaciones repetidas de segregación de funciones',
          detalle: `${ctx.usuario.nombre} intentó 3 operaciones prohibidas por segregación de funciones en 24 h.`,
          severidad: 'ALTA',
          referencia: null,
          destinatarios: ['SEG', 'GER'],
        });
      }
    }
    await this.confirmarPendientes();
  }

  evento(ctx: Ctx, d: Operacion & Partial<EventoPendiente>): void {
    const u = ctx.usuario;
    this.pendientes.push({
      fechaHoraUtc: ctx.ahora.toISOString(),
      usuarioId: u?.id ?? null,
      usuarioNombre: d.usuarioNombre ?? u?.nombre ?? 'Anónimo',
      rolesActivos: u ? this.rolesDe(u.id, ctx.ahora) : [],
      ipOrigen: ctx.ip,
      userAgent: ctx.userAgent,
      idSesionHash: ctx.sesion ? ctx.sesion.id.slice(-12) : null,
      idCorrelacion: ctx.correlacion,
      accion: d.accion,
      entidad: d.entidad,
      idEntidad: d.idEntidad ?? null,
      folio: d.folio ?? null,
      almacen: d.almacen ?? null,
      valorAnterior: d.valorAnterior ?? null,
      valorNuevo: d.valorNuevo ?? null,
      resultado: d.resultado ?? 'EXITO',
      motivoRechazo: d.motivoRechazo ?? null,
      severidad: d.severidad ?? 'INFO',
    });
  }

  /* ───────────── Identidad, roles y alcance ───────────── */

  usuario(id: string): UsuarioDB | undefined {
    return this.db.t.usuarios.find((u) => u.id === id);
  }

  nombre(id: string | null | undefined): string {
    if (!id) return '—';
    return this.usuario(id)?.nombre ?? 'Usuario eliminado';
  }

  asignacionesVigentes(uid: string, ahora: Date) {
    const hoy = ahora.toISOString().slice(0, 10);
    return this.db.t.asignaciones.filter(
      (a) => a.usuarioId === uid && a.estado === 'VIGENTE' && (!a.excepcionSod || a.excepcionSod.vence >= hoy),
    );
  }

  rolesDe(uid: string, ahora: Date): RolClave[] {
    return [...new Set(this.asignacionesVigentes(uid, ahora).map((a) => a.rol))];
  }

  permisosDe(uid: string, ahora: Date): Permiso[] {
    const set = new Set<Permiso>();
    this.asignacionesVigentes(uid, ahora).forEach((a) => ROL_PERMISOS[a.rol].forEach((p) => set.add(p)));
    return [...set].sort();
  }

  almacenesDe(uid: string, ahora: Date): AlmacenClave[] {
    const set = new Set<AlmacenClave>();
    for (const a of this.asignacionesVigentes(uid, ahora)) {
      if (a.almacenes === 'TODOS' || ROLES_GLOBALES.includes(a.rol)) TODOS_ALMACENES.forEach((x) => set.add(x));
      else a.almacenes.forEach((x) => set.add(x));
    }
    return TODOS_ALMACENES.filter((a) => set.has(a));
  }

  /** ¿Tiene el permiso dentro de ese almacén? (permiso y alcance deben venir del MISMO rol) */
  tienePermisoEn(uid: string, permiso: Permiso, almacen: AlmacenClave | null, ahora: Date, rol?: RolClave): boolean {
    return this.asignacionesVigentes(uid, ahora).some(
      (a) =>
        (!rol || a.rol === rol) &&
        ROL_PERMISOS[a.rol].includes(permiso) &&
        (almacen === null || a.almacenes === 'TODOS' || ROLES_GLOBALES.includes(a.rol) || a.almacenes.includes(almacen)),
    );
  }

  exigirSesion(ctx: Ctx): UsuarioDB {
    if (!ctx.usuario) throw new ErrorApi(401, 'NO_AUTENTICADO', 'Inicia sesión para continuar.');
    return ctx.usuario;
  }

  exigir(ctx: Ctx, permiso: Permiso, almacen: AlmacenClave | null = null): UsuarioDB {
    const u = this.exigirSesion(ctx);
    if (!this.tienePermisoEn(u.id, permiso, null, ctx.ahora)) {
      throw new ErrorApi(403, 'SIN_PERMISO', 'Tu rol no tiene permiso para esta operación.');
    }
    if (almacen && !this.tienePermisoEn(u.id, permiso, almacen, ctx.ahora)) {
      throw new ErrorApi(403, 'FUERA_DE_ALCANCE', `No tienes permiso para operar en el almacén ${almacen}.`);
    }
    return u;
  }

  parametro(clave: string): number {
    const p = this.db.t.parametros.find((x) => x.clave === clave);
    if (!p) throw new Error(`Parámetro desconocido: ${clave}`);
    return p.valor;
  }

  validarPasswordReautenticacion(ctx: Ctx, password: string | undefined): void {
    const u = this.exigirSesion(ctx);
    if (!password) throw new ErrorApi(401, 'REAUTENTICACION_REQUERIDA', 'Confirma tu contraseña para continuar.');
    if (!igualSeguro(password, u.password)) throw new ErrorApi(401, 'REAUTENTICACION_INVALIDA', 'La contraseña no es correcta.');
  }

  /* ───────────── Hallazgos ───────────── */

  crearHallazgo(ctx: Ctx, h: Omit<HallazgoDB, 'id' | 'estado' | 'fecha' | 'historial'>): HallazgoDB {
    const nuevo: HallazgoDB = {
      ...h,
      id: nuevoId('hal'),
      estado: 'ABIERTO',
      fecha: ctx.ahora.toISOString(),
      historial: [{ fecha: ctx.ahora.toISOString(), usuario: 'Sistema', estado: 'ABIERTO', comentario: 'Detectado automáticamente.' }],
    };
    this.db.t.hallazgos.unshift(nuevo);
    this.evento(ctx, {
      accion: 'HALLAZGO_DETECTADO',
      entidad: 'hallazgo',
      idEntidad: nuevo.id,
      valorNuevo: { regla: h.regla, titulo: h.titulo },
      severidad: h.severidad,
      usuarioNombre: 'Sistema',
    });
    return nuevo;
  }

  /* ───────────── Existencias y movimientos ───────────── */

  existencia(almacen: AlmacenClave | 'TRANSITO', productoId: string) {
    const k = llaveExistencia(almacen, productoId);
    if (!this.db.t.existencias[k]) this.db.t.existencias[k] = { fisica: 0, reservada: 0 };
    return this.db.t.existencias[k];
  }

  producto(id: string) {
    const p = this.db.t.productos.find((x) => x.id === id);
    if (!p) throw new ErrorApi(422, 'PRODUCTO_INVALIDO', 'El producto no existe.');
    return p;
  }

  conteoActivo(almacen: AlmacenClave, productoId: string): string | null {
    const c = this.db.t.conteos.find(
      (x) =>
        x.almacen === almacen &&
        (x.estado === 'EN_CONTEO' || x.estado === 'SEGUNDO_CONTEO') &&
        x.renglones.some((r) => r.productoId === productoId),
    );
    return c?.folio ?? null;
  }

  /** Aplica un movimiento con todas sus validaciones (CHECK fisica >= 0, reservada <= fisica). */
  mover(
    ctx: Ctx,
    doc: DocumentoDB,
    almacen: AlmacenClave | 'TRANSITO',
    productoId: string,
    delta: number,
    tipo: TipoMovimiento,
    costoUnitario: number,
    series: string[] = [],
  ): void {
    if (delta === 0) return;
    if (almacen !== 'TRANSITO') {
      const bloqueo = this.conteoActivo(almacen, productoId);
      if (bloqueo) {
        throw new ErrorApi(409, 'BLOQUEADO_POR_CONTEO', `El producto está en conteo físico (${bloqueo}) en ${almacen}; no acepta movimientos hasta cerrarlo.`);
      }
    }
    const ex = this.existencia(almacen, productoId);
    const nueva = redondear(ex.fisica + delta, 4);
    if (nueva < 0) {
      const p = this.producto(productoId);
      throw new ErrorApi(409, 'EXISTENCIA_INSUFICIENTE', `No hay existencia suficiente de ${p.sku} en ${almacen}.`);
    }
    if (ex.reservada > nueva) {
      const p = this.producto(productoId);
      throw new ErrorApi(409, 'EXISTENCIA_RESERVADA', `La existencia de ${p.sku} en ${almacen} está reservada para otros documentos.`);
    }
    ex.fisica = nueva;
    const p = this.producto(productoId);
    this.db.t.movimientos.push({
      id: this.db.t.secuencia++,
      fecha: ctx.ahora.toISOString(),
      documentoId: doc.id,
      folio: doc.folio,
      tipo,
      almacen,
      productoId,
      entrada: delta > 0 ? delta : 0,
      salida: delta < 0 ? -delta : 0,
      saldo: nueva,
      costoUnitario: redondear(costoUnitario),
      costoPromedio: p.costoPromedio,
      usuario: ctx.usuario?.nombre ?? 'Sistema',
      series,
    });
    for (const s of series) {
      const serie = this.db.t.series[s];
      const hacia = delta > 0 ? almacen : tipo === 'MERMA' ? 'BAJA' : tipo === 'SALIDA' ? 'ENTREGADO' : null;
      if (serie && hacia) {
        serie.recorrido.push({
          fecha: ctx.ahora.toISOString(),
          folio: doc.folio,
          documentoId: doc.id,
          desde: serie.ubicacion,
          hacia,
          usuario: ctx.usuario?.nombre ?? 'Sistema',
        });
        serie.ubicacion = hacia;
      } else if (!serie && delta > 0) {
        this.db.t.series[s] = {
          productoId,
          ubicacion: almacen,
          recorrido: [{ fecha: ctx.ahora.toISOString(), folio: doc.folio, documentoId: doc.id, desde: 'PROVEEDOR', hacia: almacen, usuario: ctx.usuario?.nombre ?? 'Sistema' }],
        };
      }
    }
  }

  reservar(almacen: AlmacenClave, productoId: string, cantidad: number): void {
    const ex = this.existencia(almacen, productoId);
    const disponible = ex.fisica - ex.reservada;
    if (cantidad > disponible + 1e-9) {
      const p = this.producto(productoId);
      throw new ErrorApi(409, 'EXISTENCIA_INSUFICIENTE', `Solo hay ${disponible} ${p.unidad} disponibles de ${p.sku} en ${almacen}.`);
    }
    ex.reservada = redondear(ex.reservada + cantidad, 4);
  }

  liberar(almacen: AlmacenClave, productoId: string, cantidad: number): void {
    const ex = this.existencia(almacen, productoId);
    ex.reservada = Math.max(0, redondear(ex.reservada - cantidad, 4));
  }

  /* ───────────── Documentos: visibilidad ───────────── */

  private permisoVer(tipo: TipoDocumento): Permiso {
    return ({ ENT: 'recepcion.ver', SAL: 'salida.ver', TRF: 'transferencia.ver', AJU: 'ajuste.ver' } as const)[tipo];
  }

  puedeVerDocumento(uid: string, doc: DocumentoDB, ahora: Date): boolean {
    if (doc.creadoPor.usuarioId === uid) return true;
    const roles = this.rolesDe(uid, ahora);
    // SOL solo ve sus propias solicitudes
    if (roles.length === 1 && roles[0] === 'SOL') return false;
    const permiso = this.permisoVer(doc.tipo);
    return [doc.almacenOrigen, doc.almacenDestino]
      .filter((a): a is AlmacenClave => !!a)
      .some((a) => this.tienePermisoEn(uid, permiso, a, ahora));
  }

  async obtenerDocumentoVisible(ctx: Ctx, id: string): Promise<DocumentoDB> {
    const u = this.exigirSesion(ctx);
    const doc = this.db.t.documentos.find((d) => d.id === id);
    if (!doc || !this.puedeVerDocumento(u.id, doc, ctx.ahora)) {
      if (doc) {
        // RS-ACC-02: se responde 404 para no revelar existencia, pero se registra el intento (IDOR)
        await this.registrarSuelto(ctx, {
          accion: 'ACCESO_DENEGADO',
          entidad: 'documento',
          idEntidad: id,
          folio: doc.folio,
          resultado: 'RECHAZADO',
          motivoRechazo: 'FUERA_DE_ALCANCE',
          severidad: 'ALTA',
        });
      }
      throw new ErrorApi(404, 'NO_ENCONTRADO', 'El documento no existe o no tienes acceso a él.');
    }
    return doc;
  }

  /* ───────────── Documentos: acciones permitidas y SoD ───────────── */

  evaluarAcciones(doc: DocumentoDB, uid: string, ahora: Date): { permitidas: AccionDocumento[]; bloqueos: BloqueoAccion[] } {
    const permitidas: AccionDocumento[] = [];
    const bloqueos: BloqueoAccion[] = [];
    const esCreador = doc.creadoPor.usuarioId === uid;
    const o = doc.almacenOrigen;
    const d = doc.almacenDestino;

    const considerar = (accion: AccionDocumento, autorizado: boolean, sod: { cond: boolean; codigo: string; mensaje: string }[]) => {
      if (!autorizado) return;
      const falla = sod.find((s) => s.cond);
      if (falla) bloqueos.push({ accion, codigo: falla.codigo, mensaje: falla.mensaje });
      else permitidas.push(accion);
    };

    const quien = (p: PartDB | null) => p?.usuarioId ?? null;
    const nivelGer = doc.nivelAprobacion === 'GER';

    switch (doc.tipo) {
      case 'ENT': {
        const oc = doc.ordenCompraId ? this.db.t.ordenesCompra.find((x) => x.id === doc.ordenCompraId) : null;
        const ocCreador = oc?.creadoPor.usuarioId ?? null;
        if (doc.estado === 'BORRADOR') {
          considerar('confirmar_recepcion', this.tienePermisoEn(uid, 'recepcion.crear', d, ahora), [
            { cond: ocCreador === uid, codigo: 'RS-SOD-09', mensaje: 'Registraste la orden de compra; no puedes recibir esa mercancía.' },
          ]);
          considerar('cancelar', esCreador, []);
        }
        if (doc.estado === 'PENDIENTE') {
          const puedeAprobar = this.tienePermisoEn(uid, 'recepcion.aprobar', d, ahora);
          considerar('aprobar', puedeAprobar, [
            { cond: esCreador, codigo: 'RS-SOD-01', mensaje: 'Capturaste esta recepción; otra persona debe autorizarla.' },
            { cond: ocCreador === uid, codigo: 'RS-SOD-09', mensaje: 'Registraste la orden de compra; no puedes autorizar su recepción.' },
          ]);
          considerar('rechazar', puedeAprobar, [
            { cond: esCreador, codigo: 'RS-SOD-01', mensaje: 'Capturaste esta recepción; otra persona debe revisarla.' },
          ]);
        }
        break;
      }
      case 'SAL': {
        if (doc.estado === 'BORRADOR') {
          considerar('enviar_aprobacion', esCreador, []);
          considerar('cancelar', esCreador, []);
        }
        if (doc.estado === 'PENDIENTE') {
          const rolReq: RolClave | undefined = nivelGer ? 'GER' : undefined;
          const puedeAprobar = this.tienePermisoEn(uid, 'salida.aprobar', o, ahora, rolReq);
          considerar('aprobar', puedeAprobar, [
            { cond: esCreador, codigo: 'RS-SOD-01', mensaje: 'Creaste esta solicitud; no puedes aprobarla.' },
          ]);
          considerar('rechazar', puedeAprobar, [
            { cond: esCreador, codigo: 'RS-SOD-01', mensaje: 'Creaste esta solicitud; usa "Cancelar documento".' },
          ]);
          if (!puedeAprobar && nivelGer && this.tienePermisoEn(uid, 'salida.aprobar', o, ahora)) {
            bloqueos.push({ accion: 'aprobar', codigo: 'NIVEL_GER', mensaje: 'El importe supera el umbral: la aprobación corresponde a Gerencia.' });
          }
          considerar('cancelar', esCreador, []);
        }
        if (doc.estado === 'APROBADA') {
          considerar('surtir', this.tienePermisoEn(uid, 'salida.surtir', o, ahora), [
            { cond: quien(doc.aprobador1) === uid || quien(doc.aprobador2) === uid, codigo: 'RS-SOD-02', mensaje: 'Aprobaste esta salida; otra persona debe surtirla.' },
            { cond: esCreador, codigo: 'RS-SOD-03', mensaje: 'Solicitaste este material; otra persona debe surtirlo.' },
          ]);
          considerar('cancelar', esCreador || this.tienePermisoEn(uid, 'salida.aprobar', o, ahora), []);
        }
        if (doc.estado === 'SURTIDA') {
          considerar('confirmar_entrega', esCreador, [
            { cond: quien(doc.surtidoPor) === uid, codigo: 'RS-SOD-03', mensaje: 'Surtiste esta salida; no puedes confirmar su recepción.' },
          ]);
        }
        break;
      }
      case 'TRF': {
        if (doc.estado === 'BORRADOR') {
          considerar('enviar_aprobacion', esCreador, []);
          considerar('cancelar', esCreador, []);
        }
        if (doc.estado === 'PENDIENTE') {
          const rolReq: RolClave | undefined = nivelGer ? 'GER' : undefined;
          const puedeAprobar = this.tienePermisoEn(uid, 'transferencia.aprobar', o, ahora, rolReq);
          considerar('aprobar', puedeAprobar, [
            { cond: esCreador, codigo: 'RS-SOD-04', mensaje: 'Creaste esta transferencia; no puedes aprobarla.' },
          ]);
          considerar('rechazar', puedeAprobar, [
            { cond: esCreador, codigo: 'RS-SOD-04', mensaje: 'Creaste esta transferencia; usa "Cancelar documento".' },
          ]);
          if (!puedeAprobar && nivelGer && this.tienePermisoEn(uid, 'transferencia.aprobar', o, ahora)) {
            bloqueos.push({ accion: 'aprobar', codigo: 'NIVEL_GER', mensaje: 'El importe supera el umbral: la aprobación corresponde a Gerencia.' });
          }
          considerar('cancelar', esCreador, []);
        }
        if (doc.estado === 'APROBADA') {
          considerar('enviar', this.tienePermisoEn(uid, 'transferencia.operar', o, ahora), [
            { cond: quien(doc.aprobador1) === uid, codigo: 'RS-SOD-02', mensaje: 'Aprobaste esta transferencia; otra persona debe enviarla.' },
          ]);
          considerar('cancelar', esCreador || this.tienePermisoEn(uid, 'transferencia.aprobar', o, ahora), []);
        }
        if (doc.estado === 'EN_TRANSITO') {
          considerar('recibir', this.tienePermisoEn(uid, 'transferencia.operar', d, ahora), [
            { cond: quien(doc.enviadoPor) === uid, codigo: 'RS-SOD-05', mensaje: 'Enviaste esta transferencia; otra persona debe recibirla en destino.' },
          ]);
        }
        if (doc.estado === 'CON_DISCREPANCIA') {
          considerar('resolver_incidencia', this.tienePermisoEn(uid, 'incidencia.resolver', null, ahora), [
            { cond: quien(doc.enviadoPor) === uid || quien(doc.recibidoPor) === uid, codigo: 'RS-SOD-13', mensaje: 'Participaste en el envío o la recepción; no puedes resolver la incidencia.' },
          ]);
        }
        break;
      }
      case 'AJU': {
        if (doc.estado === 'BORRADOR') {
          considerar('enviar_aprobacion', esCreador, []);
          considerar('cancelar', esCreador, []);
        }
        const contador = doc.contadores.includes(uid);
        if (doc.estado === 'PENDIENTE') {
          const puede = this.tienePermisoEn(uid, 'ajuste.aprobar', o, ahora);
          const sod = [
            { cond: esCreador, codigo: 'RS-SOD-06', mensaje: 'Capturaste este ajuste; no puedes aprobarlo.' },
            { cond: contador, codigo: 'RS-SOD-08', mensaje: 'Participaste en el conteo que originó este ajuste; no puedes aprobarlo.' },
          ];
          considerar('aprobar', puede, sod);
          considerar('rechazar', puede, sod);
          considerar('cancelar', esCreador, []);
        }
        if (doc.estado === 'PENDIENTE_N2') {
          const puede = this.tienePermisoEn(uid, 'ajuste.aprobar', o, ahora, 'GER');
          const sod = [
            { cond: esCreador, codigo: 'RS-SOD-06', mensaje: 'Capturaste este ajuste; no puedes aprobarlo.' },
            { cond: quien(doc.aprobador1) === uid, codigo: 'RS-SOD-07', mensaje: 'Ya diste la primera aprobación; la segunda debe ser de otra persona.' },
            { cond: contador, codigo: 'RS-SOD-08', mensaje: 'Participaste en el conteo que originó este ajuste; no puedes aprobarlo.' },
          ];
          considerar('aprobar', puede, sod);
          considerar('rechazar', puede, sod);
        }
        break;
      }
    }
    return { permitidas, bloqueos };
  }

  /* ───────────── Documentos: presentación (con captura ciega) ───────────── */

  private part(p: PartDB | null) {
    return p ? { usuario: { id: p.usuarioId, nombre: this.nombre(p.usuarioId) }, fecha: p.fecha } : null;
  }

  montoDocumento(doc: DocumentoDB): number {
    return redondear(doc.renglones.reduce((s, r) => s + Math.abs(r.cantidad) * r.costoUnitario, 0));
  }

  vistaDocumento(doc: DocumentoDB, uid: string, ahora: Date): Documento {
    const { permitidas, bloqueos } = this.evaluarAcciones(doc, uid, ahora);
    const aprobador =
      (doc.almacenDestino && this.tienePermisoEn(uid, 'recepcion.aprobar', doc.almacenDestino, ahora)) ||
      this.rolesDe(uid, ahora).some((r) => r === 'AUD' || r === 'GER' || r === 'CON' || r === 'CMP');
    // Recepción ciega: el almacenista no ve lo esperado de la OC mientras captura (RF-ENT-02)
    const ocultarEsperada = doc.tipo === 'ENT' && doc.estado === 'BORRADOR' && !aprobador;
    // Recepción ciega de transferencia: quien recibe en destino no ve lo enviado (RF-TRF-04)
    const operaDestino = doc.almacenDestino ? this.tienePermisoEn(uid, 'transferencia.operar', doc.almacenDestino, ahora) : false;
    const operaOrigen = doc.almacenOrigen ? this.tienePermisoEn(uid, 'transferencia.operar', doc.almacenOrigen, ahora) : false;
    const ocultarEnviada = doc.tipo === 'TRF' && doc.estado === 'EN_TRANSITO' && operaDestino && !operaOrigen && doc.enviadoPor?.usuarioId !== uid;

    const renglones: RenglonDocumento[] = doc.renglones.map((r) => {
      const p = this.producto(r.productoId);
      const recibidaVisible = r.cantidadRecibida;
      const enviada = ocultarEnviada ? null : r.cantidadEnviada;
      return {
        id: r.id,
        productoId: r.productoId,
        sku: p.sku,
        descripcion: p.descripcion,
        unidad: p.unidad,
        serializado: p.serializado,
        cantidad: ocultarEnviada ? 0 : r.cantidad,
        cantidadEsperada: ocultarEsperada ? null : r.cantidadEsperada,
        cantidadSurtida: r.cantidadSurtida,
        cantidadEnviada: enviada,
        cantidadRecibida: recibidaVisible,
        diferencia:
          r.cantidadEnviada != null && r.cantidadRecibida != null && !ocultarEnviada ? redondear(r.cantidadEnviada - r.cantidadRecibida, 4) : null,
        costoUnitario: r.costoUnitario,
        importe: ocultarEnviada ? 0 : redondear(Math.abs(r.cantidad) * r.costoUnitario),
        series: ocultarEnviada ? [] : r.series,
        seriesRecibidas: r.seriesRecibidas,
      };
    });

    const vencimiento = (() => {
      if (doc.estado === 'PENDIENTE' || doc.estado === 'PENDIENTE_N2') {
        const base = new Date(doc.enviadoAprobacionPor?.fecha ?? doc.creadoEn).getTime();
        return new Date(base + this.parametro('horas_vencimiento_aprobacion') * 3600 * 1000).toISOString();
      }
      if (doc.tipo === 'SAL' && doc.estado === 'APROBADA' && doc.aprobador1) {
        const base = new Date((doc.aprobador2 ?? doc.aprobador1).fecha).getTime();
        return new Date(base + this.parametro('horas_vencimiento_salida') * 3600 * 1000).toISOString();
      }
      return null;
    })();

    return {
      id: doc.id,
      tipo: doc.tipo,
      folio: doc.folio,
      estado: doc.estado,
      version: doc.version,
      almacenOrigen: doc.almacenOrigen,
      almacenDestino: doc.almacenDestino,
      motivo: doc.motivo ? { clave: doc.motivo, nombre: MOTIVO_NOMBRE[doc.motivo] ?? doc.motivo } : null,
      justificacion: doc.justificacion,
      centroCosto: doc.centroCosto,
      ordenCompra: doc.ordenCompraId ? (this.db.t.ordenesCompra.find((x) => x.id === doc.ordenCompraId)?.folio ?? null) : null,
      proveedor: doc.proveedorId ? (this.proveedores.find((p) => p.id === doc.proveedorId)?.nombre ?? null) : null,
      transporte: doc.transporte,
      fechaRequerida: doc.fechaRequerida,
      extemporanea: doc.extemporanea,
      renglones,
      montoTotal: ocultarEnviada ? 0 : this.montoDocumento(doc),
      nivelAprobacion: doc.nivelAprobacion,
      creadoPor: this.part(doc.creadoPor)!,
      enviadoAprobacionPor: this.part(doc.enviadoAprobacionPor),
      aprobador1: this.part(doc.aprobador1),
      aprobador2: this.part(doc.aprobador2),
      surtidoPor: this.part(doc.surtidoPor),
      enviadoPor: this.part(doc.enviadoPor),
      recibidoPor: this.part(doc.recibidoPor),
      entregadoA: this.part(doc.entregadoA),
      rechazadoPor: this.part(doc.rechazadoPor),
      canceladoPor: this.part(doc.canceladoPor),
      motivoRechazo: doc.motivoRechazo,
      motivoCancelacion: doc.motivoCancelacion,
      incidencia: doc.incidencia
        ? {
            id: doc.incidencia.id,
            estado: doc.incidencia.estado,
            renglones: doc.incidencia.renglones,
            tipoResolucion: doc.incidencia.tipoResolucion,
            resolucion: doc.incidencia.resolucion,
            resueltoPor: this.part(doc.incidencia.resueltoPor),
          }
        : null,
      adjuntos: doc.adjuntos,
      creadoEn: doc.creadoEn,
      actualizadoEn: doc.actualizadoEn,
      venceEn: vencimiento,
      accionesPermitidas: permitidas,
      bloqueos,
      referencia: doc.referencia,
    };
  }

  resumenDocumento(doc: DocumentoDB, uid: string, ahora: Date): DocumentoResumen {
    const v = this.vistaDocumento(doc, uid, ahora);
    return {
      id: v.id,
      tipo: v.tipo,
      folio: v.folio,
      estado: v.estado,
      almacenOrigen: v.almacenOrigen,
      almacenDestino: v.almacenDestino,
      motivo: v.motivo,
      montoTotal: v.montoTotal,
      creadoPor: v.creadoPor,
      creadoEn: v.creadoEn,
      actualizadoEn: v.actualizadoEn,
      accionesPermitidas: v.accionesPermitidas,
      nivelAprobacion: v.nivelAprobacion,
      centroCosto: v.centroCosto,
      renglonesCount: v.renglones.length,
    };
  }

  /* ───────────── Documentos: creación ───────────── */

  private calcularNivel(tipo: TipoDocumento, monto: number): DocumentoDB['nivelAprobacion'] {
    if (tipo === 'SAL') return monto > this.parametro('umbral_salida_ger') ? 'GER' : 'SUP';
    if (tipo === 'TRF') return monto > this.parametro('umbral_transferencia_ger') ? 'GER' : 'SUP';
    if (tipo === 'AJU') return monto > this.parametro('umbral_ajuste_n2') ? 'SUP+GER' : 'SUP';
    return 'SUP';
  }

  periodoCerrado(fechaIso: string): boolean {
    const clave = fechaIso.slice(0, 7);
    return this.db.t.periodos.some((p) => p.clave === clave && p.estado !== 'ABIERTO');
  }

  crearDocumento(ctx: Ctx, datos: DocumentoNuevo): DocumentoDB {
    const u = this.exigirSesion(ctx);
    const errores: { campo: string; mensaje: string }[] = [];
    const tipo = datos.tipo;
    const ahoraIso = ctx.ahora.toISOString();

    // Permiso y alcance según tipo
    let origen: AlmacenClave | null = null;
    let destino: AlmacenClave | null = null;
    if (tipo === 'ENT') {
      destino = datos.almacenDestino ?? null;
      if (!destino) errores.push({ campo: 'almacenDestino', mensaje: 'Indica el almacén que recibe.' });
      else this.exigir(ctx, 'recepcion.crear', destino);
    } else if (tipo === 'SAL') {
      origen = datos.almacenOrigen ?? null;
      if (!origen) errores.push({ campo: 'almacenOrigen', mensaje: 'Indica el almacén que surte.' });
      else this.exigir(ctx, 'salida.solicitar', origen);
      if (!datos.centroCosto) errores.push({ campo: 'centroCosto', mensaje: 'Indica el centro de costo.' });
    } else if (tipo === 'TRF') {
      origen = datos.almacenOrigen ?? null;
      destino = datos.almacenDestino ?? null;
      if (!origen) errores.push({ campo: 'almacenOrigen', mensaje: 'Indica el almacén de origen.' });
      if (!destino) errores.push({ campo: 'almacenDestino', mensaje: 'Indica el almacén de destino.' });
      if (origen && destino && origen === destino) errores.push({ campo: 'almacenDestino', mensaje: 'El destino debe ser distinto del origen.' });
      if (origen) this.exigir(ctx, 'transferencia.crear', origen);
    } else if (tipo === 'AJU') {
      origen = datos.almacenOrigen ?? null;
      if (!origen) errores.push({ campo: 'almacenOrigen', mensaje: 'Indica el almacén.' });
      else this.exigir(ctx, 'ajuste.crear', origen);
      if (!datos.adjuntos?.length) errores.push({ campo: 'adjuntos', mensaje: 'Adjunta la evidencia del ajuste (foto o acta).' });
    }

    // Motivo y justificación
    const motivoDef = datos.motivo ? MOTIVOS.find((m) => m.clave === datos.motivo) : null;
    if (tipo !== 'ENT') {
      if (!motivoDef || !(motivoDef.aplicaA as readonly string[]).includes(tipo)) errores.push({ campo: 'motivo', mensaje: 'Elige un motivo del catálogo.' });
    }
    const justificacion = (datos.justificacion ?? '').trim();
    const minJust = motivoDef?.requiereJustificacionExtendida ? 30 : tipo === 'AJU' ? 15 : 0;
    if (justificacion.length < minJust) errores.push({ campo: 'justificacion', mensaje: `Escribe al menos ${minJust} caracteres de justificación.` });
    if (justificacion.length > 500) errores.push({ campo: 'justificacion', mensaje: 'Máximo 500 caracteres.' });

    // Fecha de movimiento (RS-VAL-03, RN-10)
    const fechaMovimiento = datos.fechaMovimiento ? new Date(datos.fechaMovimiento).toISOString() : ahoraIso;
    if (new Date(fechaMovimiento).getTime() > ctx.ahora.getTime() + 60_000) {
      errores.push({ campo: 'fechaMovimiento', mensaje: 'La fecha del movimiento no puede ser futura.' });
    }
    if (this.periodoCerrado(fechaMovimiento)) {
      errores.push({ campo: 'fechaMovimiento', mensaje: `El periodo ${fechaMovimiento.slice(0, 7)} está cerrado.` });
    }
    const extemporanea = ctx.ahora.getTime() - new Date(fechaMovimiento).getTime() > 24 * 3600 * 1000;

    // Orden de compra
    let oc = null as ReturnType<typeof this.db.t.ordenesCompra.find> | null;
    if (tipo === 'ENT') {
      if (datos.ordenCompraId) {
        oc = this.db.t.ordenesCompra.find((x) => x.id === datos.ordenCompraId) ?? null;
        if (!oc || (oc.estado !== 'ABIERTA' && oc.estado !== 'PARCIAL')) errores.push({ campo: 'ordenCompraId', mensaje: 'La orden de compra no está abierta.' });
        else if (oc.almacenDestino !== destino) errores.push({ campo: 'ordenCompraId', mensaje: 'La orden de compra es para otro almacén.' });
      } else {
        if (!datos.proveedorId) errores.push({ campo: 'proveedorId', mensaje: 'Sin orden de compra, indica el proveedor.' });
        if (justificacion.length < 30) errores.push({ campo: 'justificacion', mensaje: 'Una entrada sin orden de compra exige justificación de al menos 30 caracteres.' });
      }
    }

    // Renglones
    if (!datos.renglones?.length) errores.push({ campo: 'renglones', mensaje: 'Agrega al menos un producto.' });
    if ((datos.renglones?.length ?? 0) > 100) errores.push({ campo: 'renglones', mensaje: 'Máximo 100 renglones por documento.' });
    const vistos = new Set<string>();
    const renglones: RenglonDB[] = [];
    (datos.renglones ?? []).forEach((r, i) => {
      const campo = `renglones.${i}`;
      const p = this.db.t.productos.find((x) => x.id === r.productoId);
      if (!p || !p.activo) {
        errores.push({ campo, mensaje: 'Producto inválido o inactivo.' });
        return;
      }
      if (vistos.has(p.id)) errores.push({ campo, mensaje: `${p.sku} aparece dos veces; combina las cantidades.` });
      vistos.add(p.id);
      const cant = Number(r.cantidad);
      const valida =
        Number.isFinite(cant) &&
        Math.abs(cant) <= 1_000_000 &&
        Math.round(cant * 10_000) === cant * 10_000 &&
        (tipo === 'AJU' ? cant !== 0 : cant > 0);
      if (!valida) errores.push({ campo, mensaje: tipo === 'AJU' ? 'Cantidad distinta de cero, máximo 4 decimales.' : 'Cantidad mayor a cero, máximo 4 decimales.' });
      if (p.serializado && !Number.isInteger(cant)) errores.push({ campo, mensaje: `${p.sku} se controla por pieza: usa cantidades enteras.` });

      let series: string[] = [];
      if (p.serializado && (tipo === 'ENT' || (tipo === 'AJU' && cant > 0))) {
        series = (r.series ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);
        if (series.length !== Math.abs(cant)) errores.push({ campo, mensaje: `Captura ${Math.abs(cant)} números de serie para ${p.sku}.` });
        const dup = series.find((s, j) => series.indexOf(s) !== j || this.db.t.series[s]);
        if (dup) errores.push({ campo, mensaje: `La serie ${dup} ya existe o está repetida.` });
        if (series.some((s) => !/^[A-Z0-9-]{4,40}$/.test(s))) errores.push({ campo, mensaje: 'Las series solo llevan letras, números y guiones (4 a 40).' });
      }
      if (p.serializado && tipo === 'AJU' && cant < 0) {
        series = (r.series ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);
        if (series.length !== Math.abs(cant)) errores.push({ campo, mensaje: `Indica las ${Math.abs(cant)} series que se dan de baja.` });
        const ajena = series.find((s) => this.db.t.series[s]?.ubicacion !== origen || this.db.t.series[s]?.productoId !== p.id);
        if (ajena) errores.push({ campo, mensaje: `La serie ${ajena} no está en ${origen}.` });
      }

      let costo = p.costoPromedio;
      let esperada: number | null = null;
      let ocRenglon: number | null = null;
      if (tipo === 'ENT') {
        if (oc) {
          const idx = oc.renglones.findIndex((x) => x.productoId === p.id);
          if (idx >= 0) {
            const ocr = oc.renglones[idx]!;
            costo = ocr.costoUnitario;
            esperada = redondear(ocr.cantidad - ocr.recibida, 4);
            ocRenglon = idx;
          }
        } else if (r.costoUnitario != null) {
          costo = Number(r.costoUnitario);
          if (!(costo >= 0) || costo > 10_000_000) errores.push({ campo, mensaje: 'Costo unitario inválido.' });
        }
      }
      renglones.push({
        id: nuevoId('ren'),
        productoId: p.id,
        cantidad: cant,
        cantidadEsperada: esperada,
        cantidadSurtida: null,
        cantidadEnviada: null,
        cantidadRecibida: tipo === 'ENT' ? cant : null,
        costoUnitario: redondear(costo, 4),
        series,
        seriesRecibidas: tipo === 'ENT' ? series : [],
        ocRenglon,
      });
    });

    if (errores.length) throw new ErrorApi(422, 'VALIDACION', 'Revisa los datos marcados.', errores);

    const almFolio = (tipo === 'ENT' ? destino : origen)!;
    const doc: DocumentoDB = {
      id: nuevoId('doc'),
      tipo,
      folio: siguienteFolio(this.db.t, tipo, almFolio),
      estado: 'BORRADOR',
      version: 1,
      almacenOrigen: origen,
      almacenDestino: destino,
      motivo: datos.motivo ?? null,
      justificacion,
      centroCosto: tipo === 'SAL' ? (datos.centroCosto ?? null) : null,
      ordenCompraId: oc?.id ?? null,
      proveedorId: oc ? oc.proveedorId : (datos.proveedorId ?? null),
      transporte: null,
      fechaRequerida: datos.fechaRequerida ?? null,
      fechaMovimiento,
      extemporanea,
      renglones,
      nivelAprobacion: 'SUP',
      creadoPor: { usuarioId: u.id, fecha: ahoraIso },
      enviadoAprobacionPor: null,
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
      adjuntos: (datos.adjuntos ?? []).map((a) => ({
        id: nuevoId('adj'),
        nombre: a.nombre.replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, '_').slice(0, 120),
        tipoMime: a.tipoMime,
        tamano: a.tamano,
        sha256: a.sha256,
        subidoPor: u.nombre,
        fecha: ahoraIso,
      })),
      creadoEn: ahoraIso,
      actualizadoEn: ahoraIso,
      contadores: [],
      referencia: null,
      alertaTransitoEmitida: false,
    };
    doc.nivelAprobacion = this.calcularNivel(tipo, this.montoDocumento(doc));
    this.db.t.documentos.unshift(doc);
    this.evento(ctx, {
      accion: `${tipo}_CREAR`,
      entidad: 'documento',
      idEntidad: doc.id,
      folio: doc.folio,
      almacen: origen ?? destino,
      valorNuevo: {
        estado: doc.estado,
        renglones: doc.renglones.map((r) => ({ productoId: r.productoId, cantidad: r.cantidad })),
        monto: this.montoDocumento(doc),
        extemporanea,
      },
    });

    if (tipo === 'SAL') this.revisarFraccionamiento(ctx, doc);
    if (datos.enviarAprobacion && tipo !== 'ENT') this.transicion(ctx, doc, 'enviar_aprobacion', { version: doc.version });
    return doc;
  }

  /* ───────────── Documentos: acciones ───────────── */

  ejecutarAccion(ctx: Ctx, doc: DocumentoDB, accion: AccionDocumento, cuerpo: CuerpoAccion): DocumentoDB {
    const u = this.exigirSesion(ctx);
    if (cuerpo.version !== doc.version) {
      throw new ErrorApi(409, 'VERSION_CONFLICTO', 'Otra persona modificó este documento mientras lo revisabas. Se recargó la versión actual.');
    }
    const { permitidas, bloqueos } = this.evaluarAcciones(doc, u.id, ctx.ahora);
    if (!permitidas.includes(accion)) {
      const b = bloqueos.find((x) => x.accion === accion);
      if (b && b.codigo.startsWith('RS-SOD')) throw new ErrorApi(403, 'SOD_VIOLATION', `${b.mensaje} (${b.codigo})`);
      if (b) throw new ErrorApi(403, 'SIN_PERMISO', b.mensaje);
      if (!this.accionValidaEnEstado(doc, accion)) {
        throw new ErrorApi(409, 'ESTADO_INVALIDO', `No se puede "${accion}" un documento en estado ${doc.estado}.`);
      }
      throw new ErrorApi(403, 'SIN_PERMISO', 'No tienes permiso para esta acción en este documento.');
    }
    // Re-autenticación para aprobaciones de nivel gerencial (RS-SES-07)
    const nivelAlto = doc.nivelAprobacion === 'GER' || (doc.tipo === 'AJU' && doc.estado === 'PENDIENTE_N2');
    if (accion === 'aprobar' && nivelAlto) this.validarPasswordReautenticacion(ctx, cuerpo.reautenticacion?.password);
    if (accion === 'confirmar_entrega') this.validarPasswordReautenticacion(ctx, cuerpo.reautenticacion?.password);
    this.transicion(ctx, doc, accion, cuerpo);
    return doc;
  }

  private accionValidaEnEstado(doc: DocumentoDB, accion: AccionDocumento): boolean {
    const mapa: Partial<Record<EstadoDocumento, AccionDocumento[]>> = {
      BORRADOR: ['enviar_aprobacion', 'cancelar', 'confirmar_recepcion'],
      PENDIENTE: ['aprobar', 'rechazar', 'cancelar'],
      PENDIENTE_N2: ['aprobar', 'rechazar'],
      APROBADA: ['surtir', 'enviar', 'cancelar'],
      SURTIDA: ['confirmar_entrega'],
      EN_TRANSITO: ['recibir'],
      CON_DISCREPANCIA: ['resolver_incidencia'],
    };
    return mapa[doc.estado]?.includes(accion) ?? false;
  }

  private requerirMotivo(cuerpo: CuerpoAccion, min = 15): string {
    const m = (cuerpo.motivo ?? '').trim();
    if (m.length < min) throw new ErrorApi(422, 'VALIDACION', `Escribe un motivo de al menos ${min} caracteres.`, [{ campo: 'motivo', mensaje: `Mínimo ${min} caracteres.` }]);
    return m.slice(0, 500);
  }

  /** Aplica la transición de estado; se asume que permisos y SoD ya se validaron. */
  transicion(ctx: Ctx, doc: DocumentoDB, accion: AccionDocumento, cuerpo: CuerpoAccion): void {
    const u = this.exigirSesion(ctx);
    const ahoraIso = ctx.ahora.toISOString();
    const yo: PartDB = { usuarioId: u.id, fecha: ahoraIso };
    const antes = doc.estado;
    const detalle: Record<string, unknown> = {};

    switch (accion) {
      case 'enviar_aprobacion': {
        doc.estado = 'PENDIENTE';
        doc.enviadoAprobacionPor = yo;
        break;
      }
      case 'cancelar': {
        detalle.motivo = doc.motivoCancelacion = this.requerirMotivo(cuerpo);
        if (doc.estado === 'APROBADA' && (doc.tipo === 'SAL' || doc.tipo === 'TRF')) {
          doc.renglones.forEach((r) => this.liberar(doc.almacenOrigen!, r.productoId, r.cantidad));
        }
        doc.estado = 'CANCELADA';
        doc.canceladoPor = yo;
        break;
      }
      case 'rechazar': {
        detalle.motivo = doc.motivoRechazo = this.requerirMotivo(cuerpo);
        doc.estado = 'RECHAZADA';
        doc.rechazadoPor = yo;
        break;
      }
      case 'aprobar': {
        this.revisarAprobacionExpres(ctx, doc);
        if (doc.tipo === 'ENT') {
          doc.aprobador1 = yo;
          this.aplicarRecepcion(ctx, doc);
          doc.estado = 'CONFIRMADA';
        } else if (doc.tipo === 'SAL' || doc.tipo === 'TRF') {
          doc.aprobador1 = yo;
          doc.renglones.forEach((r) => this.reservar(doc.almacenOrigen!, r.productoId, r.cantidad));
          doc.estado = 'APROBADA';
        } else if (doc.tipo === 'AJU') {
          if (doc.estado === 'PENDIENTE') {
            doc.aprobador1 = yo;
            if (doc.nivelAprobacion === 'SUP+GER') doc.estado = 'PENDIENTE_N2';
            else this.aplicarAjuste(ctx, doc);
          } else {
            doc.aprobador2 = yo;
            this.aplicarAjuste(ctx, doc);
          }
        }
        break;
      }
      case 'confirmar_recepcion': {
        const oc = doc.ordenCompraId ? this.db.t.ordenesCompra.find((x) => x.id === doc.ordenCompraId) : null;
        const diferencias = doc.renglones.filter((r) => r.cantidadEsperada == null || r.cantidadEsperada !== r.cantidad);
        const requiereAutorizacion = !oc || diferencias.length > 0 || doc.extemporanea;
        doc.enviadoAprobacionPor = yo;
        if (requiereAutorizacion) {
          doc.estado = 'PENDIENTE';
          detalle.razon = !oc ? 'ENTRADA_SIN_OC' : doc.extemporanea ? 'CAPTURA_EXTEMPORANEA' : 'DIFERENCIA_CONTRA_OC';
          detalle.diferencias = diferencias.map((r) => ({ productoId: r.productoId, recibido: r.cantidad, esperado: r.cantidadEsperada }));
        } else {
          this.aplicarRecepcion(ctx, doc);
          doc.estado = 'CONFIRMADA';
        }
        break;
      }
      case 'surtir': {
        const origen = doc.almacenOrigen!;
        const capt = cuerpo.renglones ?? [];
        for (const r of doc.renglones) {
          const p = this.producto(r.productoId);
          const c = capt.find((x) => x.renglonId === r.id);
          const cant = c ? Number(c.cantidad) : r.cantidad;
          if (!(cant >= 0) || cant > r.cantidad) {
            throw new ErrorApi(422, 'VALIDACION', `No puedes surtir más de lo aprobado de ${p.sku}.`, [{ campo: r.id, mensaje: `Máximo ${r.cantidad}.` }]);
          }
          let series: string[] = [];
          if (p.serializado) {
            series = (c?.series ?? []).map((s) => s.toUpperCase());
            if (series.length !== cant) throw new ErrorApi(422, 'VALIDACION', `Escanea ${cant} series de ${p.sku}.`, [{ campo: r.id, mensaje: 'Series incompletas.' }]);
            const mala = series.find((s) => this.db.t.series[s]?.ubicacion !== origen || this.db.t.series[s]?.productoId !== p.id);
            if (mala) throw new ErrorApi(422, 'VALIDACION', `La serie ${mala} no está disponible en ${origen}.`, [{ campo: r.id, mensaje: `Serie ${mala} inválida.` }]);
          }
          this.liberar(origen, r.productoId, r.cantidad);
          this.mover(ctx, doc, origen, r.productoId, -cant, 'SALIDA', r.costoUnitario, series);
          r.cantidadSurtida = cant;
          r.series = series;
        }
        doc.surtidoPor = yo;
        doc.estado = 'SURTIDA';
        detalle.surtido = doc.renglones.map((r) => ({ productoId: r.productoId, cantidad: r.cantidadSurtida, series: r.series }));
        break;
      }
      case 'confirmar_entrega': {
        doc.entregadoA = yo;
        doc.estado = 'ENTREGADA';
        break;
      }
      case 'enviar': {
        const t = cuerpo.transporte;
        const errores: { campo: string; mensaje: string }[] = [];
        if (!t?.transportista?.trim()) errores.push({ campo: 'transportista', mensaje: 'Indica el transportista.' });
        if (!t?.unidad?.trim()) errores.push({ campo: 'unidad', mensaje: 'Indica la unidad o placas.' });
        if (!t?.sellos?.trim()) errores.push({ campo: 'sellos', mensaje: 'Indica los números de sello o guía.' });
        if (errores.length) throw new ErrorApi(422, 'VALIDACION', 'Completa los datos del transporte.', errores);
        const origen = doc.almacenOrigen!;
        for (const r of doc.renglones) {
          const p = this.producto(r.productoId);
          const c = (cuerpo.renglones ?? []).find((x) => x.renglonId === r.id);
          let series: string[] = [];
          if (p.serializado) {
            series = (c?.series ?? []).map((s) => s.toUpperCase());
            if (series.length !== r.cantidad) throw new ErrorApi(422, 'VALIDACION', `Selecciona ${r.cantidad} series de ${p.sku}.`, [{ campo: r.id, mensaje: 'Series incompletas.' }]);
            const mala = series.find((s) => this.db.t.series[s]?.ubicacion !== origen || this.db.t.series[s]?.productoId !== p.id);
            if (mala) throw new ErrorApi(422, 'VALIDACION', `La serie ${mala} no está en ${origen}.`, [{ campo: r.id, mensaje: `Serie ${mala} inválida.` }]);
          }
          this.liberar(origen, r.productoId, r.cantidad);
          this.mover(ctx, doc, origen, r.productoId, -r.cantidad, 'TRANSF_SALIDA', r.costoUnitario, series);
          if (this.fallaSimulada?.despuesDe === 'baja_origen') {
            // Simula la caída de la base de datos a mitad de la transferencia (PA-20)
            throw new Error('Conexión con la base de datos perdida (simulación)');
          }
          this.mover(ctx, doc, 'TRANSITO', r.productoId, r.cantidad, 'TRANSITO_ENTRADA', r.costoUnitario, series);
          r.cantidadEnviada = r.cantidad;
          r.series = series;
        }
        doc.transporte = { transportista: t!.transportista.trim(), unidad: t!.unidad.trim(), sellos: t!.sellos.trim() };
        doc.enviadoPor = yo;
        doc.estado = 'EN_TRANSITO';
        detalle.transporte = doc.transporte;
        break;
      }
      case 'recibir': {
        const destino = doc.almacenDestino!;
        const filasIncidencia: NonNullable<DocumentoDB['incidencia']>['renglones'] = [];
        const sobrantesSeries: string[] = [];
        for (const r of doc.renglones) {
          const p = this.producto(r.productoId);
          const c = (cuerpo.renglones ?? []).find((x) => x.renglonId === r.id);
          if (!c) throw new ErrorApi(422, 'VALIDACION', `Captura lo recibido de ${p.sku} (escribe 0 si no llegó).`, [{ campo: r.id, mensaje: 'Requerido.' }]);
          let recibida = Number(c.cantidad);
          let seriesOk: string[] = [];
          let capturadas: string[] = [];
          if (p.serializado) {
            capturadas = [...new Set((c.series ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean))];
            seriesOk = capturadas.filter((s) => r.series.includes(s));
            sobrantesSeries.push(...capturadas.filter((s) => !r.series.includes(s)));
            recibida = capturadas.length;
          }
          if (!(recibida >= 0) || !Number.isFinite(recibida) || recibida > 1_000_000) {
            throw new ErrorApi(422, 'VALIDACION', 'Cantidad recibida inválida.', [{ campo: r.id, mensaje: 'Inválida.' }]);
          }
          const enviada = r.cantidadEnviada ?? 0;
          const aceptada = p.serializado ? seriesOk.length : Math.min(recibida, enviada);
          this.mover(ctx, doc, 'TRANSITO', r.productoId, -aceptada, 'TRANSITO_SALIDA', r.costoUnitario, seriesOk);
          this.mover(ctx, doc, destino, r.productoId, aceptada, 'TRANSF_ENTRADA', r.costoUnitario, seriesOk);
          r.cantidadRecibida = recibida;
          r.seriesRecibidas = capturadas;
          const dif = redondear(enviada - recibida, 4);
          if (dif !== 0 || (p.serializado && seriesOk.length !== enviada)) {
            filasIncidencia.push({ sku: p.sku, descripcion: p.descripcion, enviada, recibida, diferencia: dif });
          }
        }
        doc.recibidoPor = yo;
        if (filasIncidencia.length) {
          doc.estado = 'CON_DISCREPANCIA';
          doc.incidencia = { id: nuevoId('inc'), estado: 'ABIERTA', renglones: filasIncidencia, tipoResolucion: null, resolucion: null, resueltoPor: null, sobrantesSeries };
          detalle.incidencia = filasIncidencia;
          this.revisarDiscrepanciasRuta(ctx, doc);
        } else {
          doc.estado = 'CERRADA';
        }
        break;
      }
      case 'resolver_incidencia': {
        const motivo = this.requerirMotivo(cuerpo, 20);
        const tipo = cuerpo.tipoResolucion;
        if (!tipo || !['FALTANTE_IMPUTABLE', 'DANIO_TRANSITO', 'ERROR_CAPTURA'].includes(tipo)) {
          throw new ErrorApi(422, 'VALIDACION', 'Elige el tipo de resolución.', [{ campo: 'tipoResolucion', mensaje: 'Requerido.' }]);
        }
        const origen = doc.almacenOrigen!;
        const destino = doc.almacenDestino!;
        for (const r of doc.renglones) {
          const p = this.producto(r.productoId);
          const enviada = r.cantidadEnviada ?? 0;
          const aceptadas = p.serializado ? r.seriesRecibidas.filter((s) => r.series.includes(s)) : [];
          const recibidaAceptada = p.serializado ? aceptadas.length : Math.min(r.cantidadRecibida ?? 0, enviada);
          const faltante = redondear(enviada - recibidaAceptada, 4);
          const seriesFaltantes = p.serializado ? r.series.filter((s) => !aceptadas.includes(s)) : [];
          if (faltante > 0) {
            if (tipo === 'ERROR_CAPTURA') {
              // Nunca salió del origen: regresa
              this.mover(ctx, doc, 'TRANSITO', r.productoId, -faltante, 'TRANSITO_SALIDA', r.costoUnitario, seriesFaltantes);
              this.mover(ctx, doc, origen, r.productoId, faltante, 'TRANSF_ENTRADA', r.costoUnitario, seriesFaltantes);
            } else {
              // Faltante imputable o daño: baja por merma desde TRÁNSITO
              this.mover(ctx, doc, 'TRANSITO', r.productoId, -faltante, 'MERMA', r.costoUnitario, seriesFaltantes);
            }
          }
          const sobrante = p.serializado ? 0 : redondear((r.cantidadRecibida ?? 0) - enviada, 4);
          if (sobrante > 0 && tipo === 'ERROR_CAPTURA') {
            this.mover(ctx, doc, origen, r.productoId, -sobrante, 'TRANSF_SALIDA', r.costoUnitario);
            this.mover(ctx, doc, destino, r.productoId, sobrante, 'TRANSF_ENTRADA', r.costoUnitario);
          }
        }
        doc.incidencia!.estado = 'RESUELTA';
        doc.incidencia!.tipoResolucion = tipo;
        doc.incidencia!.resolucion = motivo;
        doc.incidencia!.resueltoPor = yo;
        doc.estado = 'CERRADA';
        detalle.resolucion = { tipo, motivo };
        break;
      }
    }

    doc.version += 1;
    doc.actualizadoEn = ahoraIso;
    this.evento(ctx, {
      accion: `${doc.tipo}_${accion.toUpperCase()}`,
      entidad: 'documento',
      idEntidad: doc.id,
      folio: doc.folio,
      almacen: doc.almacenOrigen ?? doc.almacenDestino,
      valorAnterior: { estado: antes },
      valorNuevo: { estado: doc.estado, version: doc.version, ...detalle },
      severidad: accion === 'resolver_incidencia' || (accion === 'aprobar' && doc.tipo === 'AJU') ? 'MEDIA' : 'INFO',
    });
  }

  private aplicarRecepcion(ctx: Ctx, doc: DocumentoDB): void {
    const destino = doc.almacenDestino!;
    const oc = doc.ordenCompraId ? this.db.t.ordenesCompra.find((x) => x.id === doc.ordenCompraId) : null;
    for (const r of doc.renglones) {
      const p = this.producto(r.productoId);
      // RN-03: costo promedio ponderado global
      const existenciaTotal = TODOS_ALMACENES.reduce((s, a) => s + this.existencia(a, p.id).fisica, 0) + this.existencia('TRANSITO', p.id).fisica;
      const nuevoPromedio =
        existenciaTotal + r.cantidad > 0 ? (existenciaTotal * p.costoPromedio + r.cantidad * r.costoUnitario) / (existenciaTotal + r.cantidad) : r.costoUnitario;
      p.costoPromedio = redondear(nuevoPromedio, 4);
      this.mover(ctx, doc, destino, r.productoId, r.cantidad, 'ENTRADA', r.costoUnitario, r.series);
      if (oc && r.ocRenglon != null) {
        const ocr = oc.renglones[r.ocRenglon];
        if (ocr) ocr.recibida = redondear(ocr.recibida + r.cantidad, 4);
      }
    }
    if (oc) oc.estado = oc.renglones.every((x) => x.recibida >= x.cantidad) ? 'CERRADA' : 'PARCIAL';
  }

  private aplicarAjuste(ctx: Ctx, doc: DocumentoDB): void {
    const alm = doc.almacenOrigen!;
    for (const r of doc.renglones) {
      const p = this.producto(r.productoId);
      if (r.cantidad < 0) {
        const ex = this.existencia(alm, r.productoId);
        if (ex.fisica - ex.reservada + r.cantidad < 0) {
          throw new ErrorApi(409, 'EXISTENCIA_NEGATIVA', `El ajuste dejaría existencia negativa o tomaría stock reservado de ${p.sku} (RF-AJU-04).`);
        }
        this.mover(ctx, doc, alm, r.productoId, r.cantidad, 'AJUSTE_NEG', r.costoUnitario, []);
        for (const s of r.series) {
          const serie = this.db.t.series[s];
          if (serie) {
            serie.recorrido.push({ fecha: ctx.ahora.toISOString(), folio: doc.folio, documentoId: doc.id, desde: alm, hacia: 'BAJA', usuario: ctx.usuario?.nombre ?? 'Sistema' });
            serie.ubicacion = 'BAJA';
          }
        }
      } else {
        this.mover(ctx, doc, alm, r.productoId, r.cantidad, 'AJUSTE_POS', r.costoUnitario, r.series);
      }
    }
    doc.estado = 'APLICADO';
    const monto = this.montoDocumento(doc);
    if (monto > this.parametro('umbral_ajuste_aud')) {
      this.crearHallazgo(ctx, {
        categoria: 'INTEGRIDAD',
        regla: 'RF-AJU-02',
        titulo: 'Ajuste mayor al umbral de auditoría',
        detalle: `${doc.folio} se aplicó por ${monto.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}.`,
        severidad: 'MEDIA',
        referencia: doc.id,
        destinatarios: ['GER'],
      });
    }
    this.revisarAjustesRecurrentes(ctx, doc);
    this.revisarAjustesAcumulados(ctx, doc);
  }

  /* ───────────── Detección de patrones (ERS 15.2) ───────────── */

  private revisarFraccionamiento(ctx: Ctx, doc: DocumentoDB): void {
    const umbral = this.parametro('umbral_salida_ger');
    const desde = ctx.ahora.getTime() - 24 * 3600 * 1000;
    const recientes = this.db.t.documentos.filter(
      (d) =>
        d.tipo === 'SAL' &&
        d.creadoPor.usuarioId === doc.creadoPor.usuarioId &&
        new Date(d.creadoEn).getTime() >= desde &&
        d.estado !== 'CANCELADA',
    );
    const montos = recientes.map((d) => this.montoDocumento(d));
    const suma = montos.reduce((a, b) => a + b, 0);
    if (recientes.length >= 3 && suma > umbral && montos.every((m) => m <= umbral)) {
      const ya = this.db.t.hallazgos.some((h) => h.regla === 'RA-FRA-01' && h.referencia === doc.creadoPor.usuarioId && ctx.ahora.getTime() - new Date(h.fecha).getTime() < 24 * 3600 * 1000);
      if (!ya) {
        this.crearHallazgo(ctx, {
          categoria: 'FRAUDE',
          regla: 'RA-FRA-01',
          titulo: 'Posible fraccionamiento de salidas',
          detalle: `${this.nombre(doc.creadoPor.usuarioId)} creó ${recientes.length} salidas en 24 h que suman ${suma.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}; cada una queda bajo el umbral de Gerencia (${recientes.map((d) => d.folio).join(', ')}).`,
          severidad: 'ALTA',
          referencia: doc.creadoPor.usuarioId,
          destinatarios: ['GER'],
        });
      }
    }
  }

  private revisarAprobacionExpres(ctx: Ctx, doc: DocumentoDB): void {
    const base = doc.enviadoAprobacionPor?.fecha ?? doc.creadoEn;
    const segundos = (ctx.ahora.getTime() - new Date(base).getTime()) / 1000;
    if (segundos >= 0 && segundos < 10) {
      this.crearHallazgo(ctx, {
        categoria: 'FRAUDE',
        regla: 'RA-FRA-05',
        titulo: 'Aprobación exprés',
        detalle: `${doc.folio} se aprobó ${Math.round(segundos)} s después de enviarse a aprobación.`,
        severidad: 'MEDIA',
        referencia: doc.id,
        destinatarios: ['GER'],
      });
    }
  }

  private revisarDiscrepanciasRuta(ctx: Ctx, doc: DocumentoDB): void {
    const hace30 = ctx.ahora.getTime() - 30 * 86400 * 1000;
    const similares = this.db.t.documentos.filter(
      (d) =>
        d.tipo === 'TRF' &&
        d.incidencia &&
        new Date(d.actualizadoEn).getTime() >= hace30 &&
        ((d.almacenOrigen === doc.almacenOrigen && d.almacenDestino === doc.almacenDestino) ||
          (d.transporte?.transportista && d.transporte.transportista === doc.transporte?.transportista)),
    );
    if (similares.length >= 2) {
      this.crearHallazgo(ctx, {
        categoria: 'FRAUDE',
        regla: 'RA-FRA-04',
        titulo: 'Discrepancias repetidas en la misma ruta o transportista',
        detalle: `${similares.length} transferencias con discrepancia en 30 días (${doc.almacenOrigen} → ${doc.almacenDestino}, ${doc.transporte?.transportista ?? 'sin transportista'}): ${similares.map((d) => d.folio).join(', ')}.`,
        severidad: 'ALTA',
        referencia: doc.id,
        destinatarios: ['GER'],
      });
    }
  }

  private revisarAjustesRecurrentes(ctx: Ctx, doc: DocumentoDB): void {
    const hace30 = ctx.ahora.getTime() - 30 * 86400 * 1000;
    for (const r of doc.renglones.filter((x) => x.cantidad < 0)) {
      const n = this.db.t.documentos.filter(
        (d) =>
          d.tipo === 'AJU' &&
          d.estado === 'APLICADO' &&
          d.almacenOrigen === doc.almacenOrigen &&
          new Date(d.actualizadoEn).getTime() >= hace30 &&
          d.renglones.some((x) => x.productoId === r.productoId && x.cantidad < 0),
      ).length;
      if (n >= 3) {
        const p = this.producto(r.productoId);
        this.crearHallazgo(ctx, {
          categoria: 'FRAUDE',
          regla: 'RA-FRA-02',
          titulo: 'Ajustes negativos recurrentes',
          detalle: `${p.sku} acumula ${n} ajustes negativos en ${doc.almacenOrigen} en 30 días.`,
          severidad: 'ALTA',
          referencia: doc.id,
          destinatarios: ['GER'],
        });
      }
    }
  }

  private revisarAjustesAcumulados(ctx: Ctx, doc: DocumentoDB): void {
    const mes = ctx.ahora.toISOString().slice(0, 7);
    const creador = doc.creadoPor.usuarioId;
    const total = this.db.t.documentos
      .filter((d) => d.tipo === 'AJU' && d.estado === 'APLICADO' && d.creadoPor.usuarioId === creador && d.actualizadoEn.startsWith(mes))
      .reduce((s, d) => s + d.renglones.filter((r) => r.cantidad < 0).reduce((a, r) => a + -r.cantidad * r.costoUnitario, 0), 0);
    const ya = this.db.t.hallazgos.some((h) => h.regla === 'RA-ALR-04' && h.referencia === `${creador}|${mes}`);
    if (total > 10_000 && !ya) {
      this.crearHallazgo(ctx, {
        categoria: 'FRAUDE',
        regla: 'RA-ALR-04',
        titulo: 'Ajustes negativos acumulados por usuario',
        detalle: `${this.nombre(creador)} acumula ${total.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} en ajustes negativos este mes.`,
        severidad: 'ALTA',
        referencia: `${creador}|${mes}`,
        destinatarios: ['GER'],
      });
    }
  }

  /** Procesos programados (vencimientos y alertas por tiempo). Se ejecutan en cada petición. */
  procesosProgramados(ctx: Ctx): void {
    const ahora = ctx.ahora.getTime();
    const hAprob = this.parametro('horas_vencimiento_aprobacion') * 3600 * 1000;
    const hSalida = this.parametro('horas_vencimiento_salida') * 3600 * 1000;
    const dTransito = this.parametro('dias_transito_alerta') * 86400 * 1000;
    const ctxSistema: Ctx = { ...ctx, usuario: null, sesion: null, ip: '127.0.0.1', userAgent: 'sicil-programador' };
    for (const d of this.db.t.documentos) {
      if ((d.estado === 'PENDIENTE' || d.estado === 'PENDIENTE_N2') && d.tipo !== 'ENT') {
        const base = new Date(d.enviadoAprobacionPor?.fecha ?? d.creadoEn).getTime();
        if (ahora - base > hAprob) {
          const antes = d.estado;
          d.estado = 'BORRADOR';
          d.aprobador1 = null;
          d.version += 1;
          d.actualizadoEn = ctx.ahora.toISOString();
          this.evento(ctxSistema, { accion: `${d.tipo}_APROBACION_VENCIDA`, entidad: 'documento', idEntidad: d.id, folio: d.folio, valorAnterior: { estado: antes }, valorNuevo: { estado: 'BORRADOR' }, usuarioNombre: 'Sistema', severidad: 'MEDIA' });
        }
      }
      if (d.tipo === 'SAL' && d.estado === 'APROBADA' && d.aprobador1) {
        const base = new Date((d.aprobador2 ?? d.aprobador1).fecha).getTime();
        if (ahora - base > hSalida) {
          d.renglones.forEach((r) => this.liberar(d.almacenOrigen!, r.productoId, r.cantidad));
          d.estado = 'VENCIDA';
          d.version += 1;
          d.actualizadoEn = ctx.ahora.toISOString();
          this.evento(ctxSistema, { accion: 'SAL_VENCER', entidad: 'documento', idEntidad: d.id, folio: d.folio, valorAnterior: { estado: 'APROBADA' }, valorNuevo: { estado: 'VENCIDA', reservaLiberada: true }, usuarioNombre: 'Sistema' });
        }
      }
      if (d.tipo === 'TRF' && d.estado === 'EN_TRANSITO' && d.enviadoPor && !d.alertaTransitoEmitida) {
        if (ahora - new Date(d.enviadoPor.fecha).getTime() > dTransito) {
          d.alertaTransitoEmitida = true;
          this.crearHallazgo(ctxSistema, {
            categoria: 'INTEGRIDAD',
            regla: 'RF-TRF-07',
            titulo: 'Transferencia demasiado tiempo en tránsito',
            detalle: `${d.folio} (${d.almacenOrigen} → ${d.almacenDestino}) lleva más de ${this.parametro('dias_transito_alerta')} días en tránsito.`,
            severidad: 'MEDIA',
            referencia: d.id,
            destinatarios: ['GER', 'SUP'],
          });
        }
      }
    }
  }
}
