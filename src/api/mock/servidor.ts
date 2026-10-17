/**
 * Servidor HTTP simulado. Recibe peticiones con la misma forma que el backend real
 * (método, ruta, query, cuerpo, encabezados) y responde con códigos HTTP reales.
 *
 * Emula además lo que en producción hace el navegador + backend:
 *  - Cookies HttpOnly: el "tarro" de cookies vive aquí, el código de la app no puede leerlo (RS-SES-02)
 *  - Token anti-CSRF en peticiones que cambian estado (RS-WEB-02)
 *  - Llave de idempotencia (RS-TRX-07) e identificador de correlación (RA-LOG campo id_correlacion)
 */
import type { AccionDocumento, AlmacenClave, Conteo, CuerpoAccion, DocumentoNuevo, EstadoHallazgo, FiltrosBitacora, UsuarioNuevo } from '@/api/types';
import { sha256Hex } from '@/domain/seguridad';
import { canonico, verificarCadena } from './bitacora';
import { ErrorApi, type Ctx, type Motor } from './motor';
import { cambiarPassword, cerrarSesion, listarSesiones, login, renovar, revocarSesion, validarAcceso, verificarMfa, vistaSesion } from './autenticacion';
import * as adm from './administracion';
import * as inv from './inventario';
import * as rep from './reportes';
import { crearMotorSembrado } from './sembrar';
import { ALMACENES, CENTROS_COSTO, MOTIVOS } from './semilla';

export interface PeticionMock {
  metodo: string;
  ruta: string;
  query: URLSearchParams;
  cuerpo: unknown;
  encabezados: Record<string, string>;
  userAgent?: string;
}

export interface RespuestaMock {
  status: number;
  cuerpo: unknown;
  encabezados: Record<string, string>;
}

interface Tarro {
  sesionId: string | null;
  refresh: string | null;
  csrf: string | null;
}

type Manejador = (c: ContextoRuta) => Promise<unknown> | unknown;

interface ContextoRuta {
  m: Motor;
  ctx: Ctx;
  params: Record<string, string>;
  query: URLSearchParams;
  cuerpo: Record<string, unknown>;
  tarro: Tarro;
  status: (s: number) => void;
}

const ACCIONES_DOC: AccionDocumento[] = [
  'enviar_aprobacion',
  'aprobar',
  'rechazar',
  'cancelar',
  'surtir',
  'confirmar_entrega',
  'enviar',
  'recibir',
  'resolver_incidencia',
  'confirmar_recepcion',
];

export interface OpcionesServidor {
  latencia?: [number, number];
  reloj?: () => Date;
  motor?: Motor;
}

export class ServidorMock {
  private motorListo: Promise<Motor>;
  private tarro: Tarro = { sesionId: null, refresh: null, csrf: null };
  private rutas: { metodo: string; patron: RegExp; claves: string[]; publica: boolean; h: Manejador }[] = [];
  private reloj: () => Date;
  private latencia: [number, number];

  constructor(opciones: OpcionesServidor = {}) {
    this.reloj = opciones.reloj ?? (() => new Date());
    this.latencia = opciones.latencia ?? [120, 320];
    this.motorListo = opciones.motor ? Promise.resolve(opciones.motor) : crearMotorSembrado(this.reloj());
    this.registrarRutas();
  }

  /** Solo para pruebas: acceso directo al motor (equivale a tener acceso a la base de datos). */
  motor(): Promise<Motor> {
    return this.motorListo;
  }

  /** Solo para pruebas: copia del tarro (equivale a inspeccionar las cookies en el navegador). */
  tarroParaPruebas(): Tarro {
    return { ...this.tarro };
  }

  private ruta(metodo: string, plantilla: string, h: Manejador, publica = false) {
    const claves: string[] = [];
    // Las plantillas de ruta son literales del código (no entrada del usuario)
    // eslint-disable-next-line security/detect-non-literal-regexp
    const patron = new RegExp(
      `^${plantilla.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
        claves.push(k);
        return '([^/]+)';
      })}$`,
    );
    this.rutas.push({ metodo, patron, claves, publica, h });
  }

  async manejar(p: PeticionMock): Promise<RespuestaMock> {
    const [min, max] = this.latencia;
    if (max > 0) await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
    const m = await this.motorListo;
    const correlacion = `req-${crypto.randomUUID().slice(0, 12)}`;
    const encabezados: Record<string, string> = { 'x-correlation-id': correlacion, 'cache-control': 'no-store' };
    const metodo = p.metodo.toUpperCase();
    const ruta = this.rutas.find((r) => r.metodo === metodo && r.patron.test(p.ruta));
    const ctx: Ctx = {
      usuario: null,
      sesion: null,
      ip: '10.20.0.200',
      userAgent: (p.userAgent ?? 'desconocido').slice(0, 200),
      correlacion,
      ahora: this.reloj(),
    };
    const error = (status: number, codigo: string, mensaje: string, detalles?: unknown): RespuestaMock => ({
      status,
      cuerpo: { codigo, mensaje, idCorrelacion: correlacion, ...(detalles ? { detalles } : {}) },
      encabezados,
    });

    if (!ruta) {
      const otroMetodo = this.rutas.some((r) => r.patron.test(p.ruta));
      return otroMetodo ? error(405, 'METODO_NO_PERMITIDO', 'Método no permitido.') : error(404, 'RUTA_INEXISTENTE', 'El recurso no existe.');
    }

    try {
      // RS-WEB-02: toda petición que cambia estado exige el token anti-CSRF
      if (metodo !== 'GET' && p.ruta !== '/auth/csrf') {
        const enviado = p.encabezados['x-csrf-token'];
        if (!enviado || !this.tarro.csrf || enviado !== this.tarro.csrf) {
          await m.registrarSuelto(ctx, { accion: 'CSRF_RECHAZADO', entidad: 'peticion', resultado: 'RECHAZADO', motivoRechazo: 'CSRF_INVALIDO', severidad: 'ALTA', valorNuevo: { ruta: p.ruta } });
          return error(403, 'CSRF_INVALIDO', 'La petición no trae un token de seguridad válido. Recarga la página.');
        }
      }

      if (!ruta.publica) {
        const { usuario, sesion } = validarAcceso(m, this.tarro.sesionId, ctx.ahora);
        ctx.usuario = usuario;
        ctx.sesion = sesion;
        ctx.ip = usuario.ipHabitual;
        if (usuario.debeCambiarPassword && !p.ruta.startsWith('/auth/')) {
          return error(403, 'CAMBIO_PASSWORD_REQUERIDO', 'Debes cambiar tu contraseña temporal antes de continuar.');
        }
        await m.transaccion(ctx, { accion: 'PROCESOS_PROGRAMADOS', entidad: 'sistema' }, () => m.procesosProgramados(ctx));
      }

      const valores = ruta.patron.exec(p.ruta)!.slice(1);
      const params = Object.fromEntries(ruta.claves.map((k, i) => [k, decodeURIComponent(valores[i] ?? '')]));
      const cuerpo = (p.cuerpo && typeof p.cuerpo === 'object' ? p.cuerpo : {}) as Record<string, unknown>;

      // RS-TRX-07: idempotencia en operaciones que crean o mueven inventario
      const llave = p.encabezados['idempotency-key'];
      let huella = '';
      if (metodo === 'POST' && llave && ctx.usuario) {
        if (!/^[0-9a-f-]{36}$/i.test(llave)) return error(400, 'IDEMPOTENCIA_INVALIDA', 'Llave de idempotencia inválida.');
        huella = await sha256Hex(`${p.ruta}|${canonico(cuerpo)}`);
        const previa = m.db.t.idempotencia[`${ctx.usuario.id}|${llave}`];
        if (previa) {
          if (previa.huella !== huella) return error(422, 'IDEMPOTENCIA_CONFLICTO', 'La misma llave se usó con datos distintos.');
          encabezados['idempotent-replay'] = 'true';
          return { status: previa.status, cuerpo: previa.cuerpo, encabezados };
        }
      }

      let status = metodo === 'POST' ? 201 : 200;
      const resultado = await ruta.h({ m, ctx, params, query: p.query, cuerpo, tarro: this.tarro, status: (s) => (status = s) });
      if (llave && huella && ctx.usuario) {
        m.db.t.idempotencia[`${ctx.usuario.id}|${llave}`] = { usuarioId: ctx.usuario.id, status, cuerpo: resultado, huella };
      }
      return { status: resultado === undefined ? 204 : status, cuerpo: resultado ?? null, encabezados };
    } catch (e) {
      if (e instanceof ErrorApi) return error(e.status, e.codigo, e.message, e.detalles);
      console.error('[mock] error interno', e);
      // RS-WEB-04: sin detalles técnicos al cliente; solo el código de correlación
      return error(500, 'ERROR_INTERNO', 'Ocurrió un error inesperado. Comparte el código de referencia con soporte.');
    }
  }

  private registrarRutas() {
    const txn = (accion: string, entidad: string, fn: (c: ContextoRuta) => unknown) => (c: ContextoRuta) =>
      c.m.transaccion(c.ctx, { accion, entidad, idEntidad: c.params.id ?? null }, () => fn(c));
    const reauth = (c: ContextoRuta) => (c.cuerpo.reautenticacion as { password?: string } | undefined)?.password;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');

    /* ── Autenticación ── */
    this.ruta(
      'GET',
      '/auth/csrf',
      ({ tarro }) => {
        tarro.csrf ??= crypto.randomUUID();
        return { token: tarro.csrf };
      },
      true,
    );
    this.ruta(
      'POST',
      '/auth/login',
      async ({ m, ctx, cuerpo, tarro }) => {
        const r = await login(m, ctx, str(cuerpo.usuario), str(cuerpo.password));
        if (r.sesion) {
          tarro.sesionId = r.sesion.id;
          tarro.refresh = r.sesion.refresh;
          tarro.csrf = crypto.randomUUID(); // se rota el token CSRF al autenticarse
        }
        return r.respuesta;
      },
      true,
    );
    this.ruta(
      'POST',
      '/auth/mfa',
      async ({ m, ctx, cuerpo, tarro }) => {
        const r = await verificarMfa(m, ctx, str(cuerpo.desafioId), str(cuerpo.codigo));
        tarro.sesionId = r.sesion.id;
        tarro.refresh = r.sesion.refresh;
        tarro.csrf = crypto.randomUUID();
        return { estado: 'OK', usuario: r.usuario };
      },
      true,
    );
    this.ruta(
      'POST',
      '/auth/refresh',
      async ({ m, ctx, tarro }) => {
        try {
          const r = await renovar(m, ctx, tarro.sesionId, tarro.refresh);
          tarro.refresh = r.sesion.refresh;
          return { usuario: r.usuario };
        } catch (e) {
          tarro.sesionId = null;
          tarro.refresh = null;
          throw e;
        }
      },
      true,
    );
    this.ruta('POST', '/auth/logout', async ({ m, ctx, tarro }) => {
      await cerrarSesion(m, ctx);
      tarro.sesionId = null;
      tarro.refresh = null;
      tarro.csrf = null;
      return undefined;
    });
    this.ruta('GET', '/auth/me', ({ m, ctx }) => vistaSesion(m, ctx.usuario!, ctx.sesion!, ctx.ahora));
    this.ruta('POST', '/auth/password', async ({ m, ctx, cuerpo }) => {
      await cambiarPassword(m, ctx, str(cuerpo.actual), str(cuerpo.nueva));
      return vistaSesion(m, m.usuario(ctx.usuario!.id)!, ctx.sesion!, ctx.ahora);
    });
    this.ruta('GET', '/auth/sesiones', ({ m, ctx }) => listarSesiones(m, ctx));
    this.ruta('DELETE', '/auth/sesiones/:id', ({ m, ctx, params }) => revocarSesion(m, ctx, params.id!));

    /* ── Catálogos ── */
    this.ruta('GET', '/almacenes', ({ m, ctx }) => {
      const alcance = m.almacenesDe(ctx.usuario!.id, ctx.ahora);
      return ALMACENES.filter((a) => alcance.includes(a.clave));
    });
    this.ruta('GET', '/motivos', () => MOTIVOS);
    this.ruta('GET', '/centros-costo', () => CENTROS_COSTO);
    this.ruta('GET', '/proveedores', ({ m }) => m.proveedores);
    this.ruta('GET', '/productos', ({ m, ctx, query }) => inv.listarProductos(m, ctx, query.get('q') ?? '', query.get('inactivos') === '1'));
    this.ruta('GET', '/productos/:id/costos', ({ m, ctx, params }) => inv.historialCosto(m, ctx, params.id!));
    this.ruta('POST', '/productos', txn('PRODUCTO_CREAR', 'producto', ({ m, ctx, cuerpo }) => inv.crearProducto(m, ctx, cuerpo as never)));
    this.ruta('PUT', '/productos/:id', txn('PRODUCTO_EDITAR', 'producto', ({ m, ctx, params, cuerpo }) => inv.actualizarProducto(m, ctx, params.id!, cuerpo as never)));
    this.ruta('GET', '/ordenes-compra', ({ m, ctx, query }) => inv.listarOc(m, ctx, query.get('abiertas') === '1', rep.exigirAlmacenValido(query.get('almacen'))));
    this.ruta('POST', '/ordenes-compra', txn('OC_CREAR', 'orden_compra', ({ m, ctx, cuerpo }) => inv.crearOc(m, ctx, cuerpo as never)));

    /* ── Existencias ── */
    this.ruta('GET', '/existencias', ({ m, ctx, query }) =>
      inv.existencias(m, ctx, rep.exigirAlmacenValido(query.get('almacen')), query.get('q') ?? '', query.get('bajoReorden') === '1'),
    );
    this.ruta('GET', '/kardex', ({ m, ctx, query }) => {
      const a = query.get('almacen');
      return inv.kardex(m, ctx, query.get('producto') ?? '', a === 'TRANSITO' ? 'TRANSITO' : (rep.exigirAlmacenValido(a) as AlmacenClave));
    });
    this.ruta('GET', '/series/:numero', ({ m, ctx, params }) => inv.rastrearSerie(m, ctx, params.numero!));
    this.ruta('GET', '/series-disponibles', ({ m, ctx, query }) =>
      inv.seriesDisponibles(m, ctx, query.get('producto') ?? '', rep.exigirAlmacenValido(query.get('almacen')) as AlmacenClave),
    );

    /* ── Documentos ── */
    this.ruta('GET', '/documentos', ({ m, ctx, query }) =>
      rep.listarDocumentos(m, ctx, {
        tipo: query.get('tipo') ?? undefined,
        estado: query.get('estado') ?? undefined,
        almacen: query.get('almacen') ?? undefined,
        q: query.get('q') ?? undefined,
        pagina: Number(query.get('pagina') ?? 1),
        mios: query.get('mios') === '1',
      }),
    );
    this.ruta('GET', '/documentos/:id', async ({ m, ctx, params }) => {
      const d = await m.obtenerDocumentoVisible(ctx, params.id!);
      return m.vistaDocumento(d, ctx.usuario!.id, ctx.ahora);
    });
    this.ruta('GET', '/documentos/:id/eventos', async ({ m, ctx, params }) => {
      await m.obtenerDocumentoVisible(ctx, params.id!);
      return rep.timelineDocumento(m, params.id!);
    });
    this.ruta('POST', '/documentos', async ({ m, ctx, cuerpo }) => {
      const datos = cuerpo as unknown as DocumentoNuevo;
      const doc = await m.transaccion(ctx, { accion: `${String(datos.tipo ?? 'DOC')}_CREAR`, entidad: 'documento' }, () => m.crearDocumento(ctx, datos));
      return m.vistaDocumento(doc, ctx.usuario!.id, ctx.ahora);
    });
    this.ruta('POST', '/documentos/:id/acciones/:accion', async ({ m, ctx, params, cuerpo, status }) => {
      const accion = params.accion as AccionDocumento;
      if (!ACCIONES_DOC.includes(accion)) throw new ErrorApi(400, 'ACCION_INVALIDA', 'Acción desconocida.');
      const doc = await m.obtenerDocumentoVisible(ctx, params.id!);
      await m.transaccion(ctx, { accion: `${doc.tipo}_${accion.toUpperCase()}`, entidad: 'documento', idEntidad: doc.id, folio: doc.folio, almacen: doc.almacenOrigen ?? doc.almacenDestino }, () =>
        m.ejecutarAccion(ctx, doc, accion, cuerpo as unknown as CuerpoAccion),
      );
      status(200);
      const actualizado = m.db.t.documentos.find((d) => d.id === doc.id)!;
      return m.vistaDocumento(actualizado, ctx.usuario!.id, ctx.ahora);
    });

    /* ── Conteos ── */
    this.ruta('GET', '/conteos', ({ m, ctx }) => inv.listarConteos(m, ctx));
    this.ruta('GET', '/conteos/:id', ({ m, ctx, params }) => inv.vistaConteo(m, inv.obtenerConteo(m, ctx, params.id!), ctx.usuario!.id, ctx.ahora));
    this.ruta('POST', '/conteos', async ({ m, ctx, cuerpo }) => {
      const c = await m.transaccion(ctx, { accion: 'CNT_PROGRAMAR', entidad: 'conteo' }, () => inv.programarConteo(m, ctx, cuerpo as never));
      return inv.vistaConteo(m, c, ctx.usuario!.id, ctx.ahora);
    });
    this.ruta('POST', '/conteos/:id/acciones/:accion', async ({ m, ctx, params, cuerpo, status }) => {
      const c = inv.obtenerConteo(m, ctx, params.id!);
      const accion = params.accion as Conteo['accionesPermitidas'][number];
      if (!['iniciar', 'capturar_primero', 'capturar_segundo', 'cerrar', 'cancelar'].includes(accion)) throw new ErrorApi(400, 'ACCION_INVALIDA', 'Acción desconocida.');
      await m.transaccion(ctx, { accion: `CNT_${accion.toUpperCase()}`, entidad: 'conteo', idEntidad: c.id, folio: c.folio, almacen: c.almacen }, () =>
        inv.accionConteo(m, ctx, m.db.t.conteos.find((x) => x.id === c.id)!, accion, cuerpo as never),
      );
      status(200);
      return inv.vistaConteo(m, m.db.t.conteos.find((x) => x.id === c.id)!, ctx.usuario!.id, ctx.ahora);
    });

    /* ── Bandeja y tablero ── */
    this.ruta('GET', '/bandeja', ({ m, ctx }) => rep.bandeja(m, ctx));
    this.ruta('GET', '/tablero', ({ m, ctx }) => rep.tablero(m, ctx));

    /* ── Bitácora ── */
    this.ruta('GET', '/bitacora', async ({ m, ctx, query }) => {
      const f = Object.fromEntries(query.entries()) as unknown as FiltrosBitacora;
      const r = rep.consultarBitacora(m, ctx, { ...f, pagina: Number(query.get('pagina') ?? 1) });
      await m.registrarSuelto(ctx, { accion: 'BITACORA_CONSULTAR', entidad: 'bitacora', valorNuevo: { filtros: f, resultados: r.total } });
      return r;
    });
    this.ruta('GET', '/bitacora/verificacion', async ({ m, ctx }) => {
      m.exigir(ctx, 'bitacora.ver');
      const r = await verificarCadena(m.db.bitacora);
      await m.registrarSuelto(ctx, { accion: 'BITACORA_VERIFICAR', entidad: 'bitacora', valorNuevo: { ...r }, severidad: r.integra ? 'INFO' : 'CRITICA' });
      return r;
    });
    this.ruta('POST', '/bitacora/exportaciones', async ({ m, ctx, cuerpo }) => {
      const f = (cuerpo.filtros ?? {}) as FiltrosBitacora;
      const todos = [];
      for (let pag = 1; pag <= 100; pag++) {
        const r = rep.consultarBitacora(m, ctx, { ...f, pagina: pag });
        todos.push(...r.datos);
        if (pag * r.porPagina >= r.total) break;
      }
      await this.registrarExportacion(m, ctx, 'bitacora', todos.length);
      return { eventos: todos.slice(0, 5000) };
    });

    /* ── Hallazgos ── */
    this.ruta('GET', '/hallazgos', ({ m, ctx }) => adm.listarHallazgos(m, ctx));
    this.ruta(
      'POST',
      '/hallazgos/:id/estado',
      txn('HALLAZGO_ACTUALIZAR', 'hallazgo', ({ m, ctx, params, cuerpo }) => adm.actualizarHallazgo(m, ctx, params.id!, cuerpo.estado as EstadoHallazgo, str(cuerpo.comentario))),
    );

    /* ── Reportes ── */
    this.ruta('GET', '/reportes/valuacion', ({ m, ctx }) => rep.reporteValuacion(m, ctx));
    this.ruta('GET', '/reportes/mermas', ({ m, ctx }) => rep.reporteMermas(m, ctx));
    this.ruta('GET', '/reportes/discrepancias', ({ m, ctx }) => rep.reporteDiscrepancias(m, ctx));
    this.ruta('GET', '/reportes/conciliacion', ({ m, ctx }) => rep.conciliacion(m, ctx));
    this.ruta('GET', '/reportes/fuera-horario', ({ m, ctx }) => rep.reporteFueraHorario(m, ctx));
    this.ruta('GET', '/reportes/top-usuarios', ({ m, ctx }) => rep.reporteTopUsuarios(m, ctx));
    this.ruta('GET', '/reportes/folios', ({ m, ctx }) => rep.foliosFaltantes(m, ctx));
    this.ruta('POST', '/reportes/exportaciones', async ({ m, ctx, cuerpo }) => {
      m.exigir(ctx, 'reportes.ver');
      await this.registrarExportacion(m, ctx, str(cuerpo.reporte).slice(0, 40), Number(cuerpo.filas) || 0, str(cuerpo.formato).slice(0, 6), str(cuerpo.sha256).slice(0, 64));
      return { registrado: true, idCorrelacion: ctx.correlacion };
    });

    /* ── Periodos ── */
    this.ruta('GET', '/periodos', ({ m, ctx }) => adm.listarPeriodos(m, ctx));
    this.ruta('POST', '/periodos/:clave/cierre', txn('PERIODO_CERRAR', 'periodo', ({ m, ctx, params }) => adm.cerrarPeriodo(m, ctx, params.clave!)));
    this.ruta('POST', '/periodos/:clave/reapertura', txn('PERIODO_SOLICITAR_REAPERTURA', 'periodo', ({ m, ctx, params, cuerpo }) => adm.solicitarReapertura(m, ctx, params.clave!, str(cuerpo.motivo))));
    this.ruta(
      'POST',
      '/periodos/:clave/reapertura/resolucion',
      txn('PERIODO_RESOLVER_REAPERTURA', 'periodo', (c) => adm.resolverReapertura(c.m, c.ctx, c.params.clave!, c.cuerpo.aprobar === true, reauth(c))),
    );

    /* ── Usuarios y accesos ── */
    this.ruta('GET', '/usuarios', ({ m, ctx }) => adm.listarUsuarios(m, ctx));
    this.ruta('POST', '/usuarios', txn('USUARIO_CREAR', 'usuario', (c) => adm.crearUsuario(c.m, c.ctx, c.cuerpo.datos as UsuarioNuevo, reauth(c))));
    this.ruta(
      'POST',
      '/usuarios/:id/asignaciones',
      txn('ROL_SOLICITAR', 'asignacion', (c) => adm.solicitarAsignacion(c.m, c.ctx, c.params.id!, c.cuerpo as never, reauth(c))),
    );
    this.ruta(
      'POST',
      '/usuarios/:id/estado',
      txn('USUARIO_ESTADO', 'usuario', (c) => adm.cambiarEstadoUsuario(c.m, c.ctx, c.params.id!, c.cuerpo.accion as 'baja' | 'desbloquear' | 'bloquear', str(c.cuerpo.motivo))),
    );
    this.ruta('GET', '/asignaciones/pendientes', ({ m, ctx }) => adm.pendientesAcceso(m, ctx));
    this.ruta(
      'POST',
      '/asignaciones/:id/resolucion',
      txn('ROL_RESOLVER', 'asignacion', (c) => adm.resolverAsignacion(c.m, c.ctx, c.params.id!, c.cuerpo.aprobar === true, str(c.cuerpo.motivo), reauth(c))),
    );
    this.ruta('POST', '/asignaciones/:id/retiro', txn('ROL_RETIRAR', 'asignacion', (c) => adm.retirarAsignacion(c.m, c.ctx, c.params.id!, str(c.cuerpo.motivo))));
    this.ruta(
      'POST',
      '/asignaciones/:id/recertificacion',
      txn('ROL_RECERTIFICAR', 'asignacion', (c) => adm.recertificar(c.m, c.ctx, c.params.id!, c.cuerpo.confirmar === true, str(c.cuerpo.motivo))),
    );
    this.ruta('GET', '/permisos/matriz', ({ m, ctx }) => adm.matrizPermisos(m, ctx));

    /* ── Parámetros ── */
    this.ruta('GET', '/parametros', ({ m, ctx }) => adm.listarParametros(m, ctx));
    this.ruta(
      'POST',
      '/parametros/:clave/propuesta',
      txn('PARAMETRO_PROPONER', 'parametro', (c) => adm.proponerParametro(c.m, c.ctx, c.params.clave!, Number(c.cuerpo.valor), str(c.cuerpo.motivo), reauth(c))),
    );
    this.ruta(
      'POST',
      '/parametros/:clave/resolucion',
      txn('PARAMETRO_RESOLVER', 'parametro', (c) => adm.resolverParametro(c.m, c.ctx, c.params.clave!, c.cuerpo.aprobar === true, reauth(c))),
    );
  }

  /** RF-REP-07 y RA-ALR-06: toda exportación queda en bitácora; más de 5 por hora generan alerta. */
  private async registrarExportacion(m: Motor, ctx: Ctx, reporte: string, filas: number, formato = 'CSV', sha256 = ''): Promise<void> {
    await m.transaccion(ctx, { accion: 'EXPORTAR', entidad: 'reporte' }, () => {
      m.evento(ctx, { accion: 'REPORTE_EXPORTAR', entidad: 'reporte', idEntidad: reporte, severidad: 'MEDIA', valorNuevo: { reporte, filas, formato, sha256 } });
      const hace1h = ctx.ahora.getTime() - 3600 * 1000;
      const recientes = m.db.bitacora.filter((e) => e.accion === 'REPORTE_EXPORTAR' && e.usuarioId === ctx.usuario?.id && new Date(e.fechaHoraUtc).getTime() >= hace1h).length + 1;
      if (recientes === 6) {
        m.crearHallazgo(ctx, {
          categoria: 'SEGURIDAD',
          regla: 'RA-ALR-06',
          titulo: 'Exportación masiva de información',
          detalle: `${ctx.usuario?.nombre} realizó más de 5 exportaciones en una hora.`,
          severidad: 'ALTA',
          referencia: ctx.usuario?.id ?? null,
          destinatarios: ['SEG'],
        });
      }
    });
  }
}
