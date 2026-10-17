/**
 * Funciones tipadas para cada endpoint de /api/v1.
 * Este archivo ES el contrato que el backend debe implementar (ver README, sección "Contrato de la API").
 */
import { solicitar } from './http';
import type {
  AccionDocumento,
  Almacen,
  AlmacenClave,
  AsignacionDetalle,
  CambioCosto,
  CentroCosto,
  ClaseAbc,
  Conteo,
  CuerpoAccion,
  Documento,
  DocumentoNuevo,
  DocumentoResumen,
  ElementoBandeja,
  EstadoHallazgo,
  EventoBitacora,
  EventoTimeline,
  Existencia,
  FilaConciliacion,
  FilaDiscrepancia,
  FilaFueraHorario,
  FilaMerma,
  FilaPermisos,
  FilaTopUsuario,
  FilaValuacion,
  FiltrosBitacora,
  Hallazgo,
  Motivo,
  Movimiento,
  OrdenCompra,
  Paginado,
  Parametro,
  Periodo,
  Producto,
  Proveedor,
  RastreoSerie,
  RespuestaLogin,
  RolClave,
  SesionActiva,
  Tablero,
  UnidadMedida,
  UsuarioAdmin,
  UsuarioNuevo,
  UsuarioSesion,
  VerificacionCadena,
} from './types';

const conPassword = (password?: string) => (password ? { reautenticacion: { password } } : {});

export const api = {
  auth: {
    login: (usuario: string, password: string) => solicitar<RespuestaLogin>('POST', '/auth/login', { cuerpo: { usuario, password }, sinRenovar: true }),
    mfa: (desafioId: string, codigo: string) => solicitar<RespuestaLogin>('POST', '/auth/mfa', { cuerpo: { desafioId, codigo }, sinRenovar: true }),
    yo: () => solicitar<UsuarioSesion>('GET', '/auth/me'),
    salir: () => solicitar<void>('POST', '/auth/logout', { sinRenovar: true }),
    cambiarPassword: (actual: string, nueva: string) => solicitar<UsuarioSesion>('POST', '/auth/password', { cuerpo: { actual, nueva } }),
    sesiones: () => solicitar<SesionActiva[]>('GET', '/auth/sesiones'),
    cerrarSesion: (id: string) => solicitar<void>('DELETE', `/auth/sesiones/${encodeURIComponent(id)}`),
  },

  catalogos: {
    almacenes: () => solicitar<Almacen[]>('GET', '/almacenes'),
    motivos: () => solicitar<Motivo[]>('GET', '/motivos'),
    centrosCosto: () => solicitar<CentroCosto[]>('GET', '/centros-costo'),
    proveedores: () => solicitar<Proveedor[]>('GET', '/proveedores'),
  },

  productos: {
    listar: (q = '', inactivos = false) => solicitar<Producto[]>('GET', '/productos', { query: { q, inactivos: inactivos ? 1 : undefined } }),
    historialCosto: (id: string) => solicitar<CambioCosto[]>('GET', `/productos/${encodeURIComponent(id)}/costos`),
    crear: (datos: DatosProducto) => solicitar<Producto>('POST', '/productos', { cuerpo: datos }),
    actualizar: (id: string, datos: DatosProducto & { version: number; motivoCambioCosto?: string; activo?: boolean }) =>
      solicitar<Producto>('PUT', `/productos/${encodeURIComponent(id)}`, { cuerpo: datos }),
  },

  ordenesCompra: {
    listar: (soloAbiertas = false, almacen?: AlmacenClave) => solicitar<OrdenCompra[]>('GET', '/ordenes-compra', { query: { abiertas: soloAbiertas ? 1 : undefined, almacen } }),
    crear: (datos: { proveedorId: string; almacenDestino: AlmacenClave; renglones: { productoId: string; cantidad: number; costoUnitario: number }[] }, idempotencia: string) =>
      solicitar<OrdenCompra>('POST', '/ordenes-compra', { cuerpo: datos, idempotencia }),
  },

  inventario: {
    existencias: (f: { almacen?: AlmacenClave | ''; q?: string; bajoReorden?: boolean }) =>
      solicitar<Existencia[]>('GET', '/existencias', { query: { almacen: f.almacen, q: f.q, bajoReorden: f.bajoReorden ? 1 : undefined } }),
    kardex: (producto: string, almacen: AlmacenClave | 'TRANSITO') => solicitar<Movimiento[]>('GET', '/kardex', { query: { producto, almacen } }),
    serie: (numero: string) => solicitar<RastreoSerie>('GET', `/series/${encodeURIComponent(numero)}`),
    seriesDisponibles: (producto: string, almacen: AlmacenClave) => solicitar<string[]>('GET', '/series-disponibles', { query: { producto, almacen } }),
  },

  documentos: {
    listar: (f: { tipo?: string; estado?: string; almacen?: string; q?: string; pagina?: number; mios?: boolean }) =>
      solicitar<Paginado<DocumentoResumen>>('GET', '/documentos', { query: { ...f, mios: f.mios ? 1 : undefined } }),
    obtener: (id: string) => solicitar<Documento>('GET', `/documentos/${encodeURIComponent(id)}`),
    eventos: (id: string) => solicitar<EventoTimeline[]>('GET', `/documentos/${encodeURIComponent(id)}/eventos`),
    crear: (datos: DocumentoNuevo, idempotencia: string) => solicitar<Documento>('POST', '/documentos', { cuerpo: datos, idempotencia }),
    accion: (id: string, accion: AccionDocumento, cuerpo: CuerpoAccion, idempotencia: string) =>
      solicitar<Documento>('POST', `/documentos/${encodeURIComponent(id)}/acciones/${accion}`, { cuerpo, idempotencia }),
  },

  conteos: {
    listar: () => solicitar<Conteo[]>('GET', '/conteos'),
    obtener: (id: string) => solicitar<Conteo>('GET', `/conteos/${encodeURIComponent(id)}`),
    programar: (datos: { almacen: AlmacenClave; tipo: 'CICLICO' | 'GENERAL'; clase: ClaseAbc | null }, idempotencia: string) =>
      solicitar<Conteo>('POST', '/conteos', { cuerpo: datos, idempotencia }),
    accion: (
      id: string,
      accion: Conteo['accionesPermitidas'][number],
      cuerpo: { version: number; renglones?: { productoId: string; cantidad: number }[]; motivo?: string },
      idempotencia: string,
    ) => solicitar<Conteo>('POST', `/conteos/${encodeURIComponent(id)}/acciones/${accion}`, { cuerpo, idempotencia }),
  },

  tablero: () => solicitar<Tablero>('GET', '/tablero'),
  bandeja: () => solicitar<ElementoBandeja[]>('GET', '/bandeja'),

  bitacora: {
    consultar: (f: FiltrosBitacora) => solicitar<Paginado<EventoBitacora>>('GET', '/bitacora', { query: { ...f } }),
    verificar: () => solicitar<VerificacionCadena>('GET', '/bitacora/verificacion'),
    exportar: (filtros: FiltrosBitacora) => solicitar<{ eventos: EventoBitacora[] }>('POST', '/bitacora/exportaciones', { cuerpo: { filtros } }),
  },

  hallazgos: {
    listar: () => solicitar<Hallazgo[]>('GET', '/hallazgos'),
    actualizar: (id: string, estado: EstadoHallazgo, comentario: string) =>
      solicitar<void>('POST', `/hallazgos/${encodeURIComponent(id)}/estado`, { cuerpo: { estado, comentario } }),
  },

  reportes: {
    valuacion: () => solicitar<FilaValuacion[]>('GET', '/reportes/valuacion'),
    mermas: () => solicitar<FilaMerma[]>('GET', '/reportes/mermas'),
    discrepancias: () => solicitar<FilaDiscrepancia[]>('GET', '/reportes/discrepancias'),
    conciliacion: () => solicitar<FilaConciliacion[]>('GET', '/reportes/conciliacion'),
    fueraHorario: () => solicitar<FilaFueraHorario[]>('GET', '/reportes/fuera-horario'),
    topUsuarios: () => solicitar<FilaTopUsuario[]>('GET', '/reportes/top-usuarios'),
    folios: () => solicitar<{ serie: string; faltantes: string[]; emitidos: number }[]>('GET', '/reportes/folios'),
    registrarExportacion: (reporte: string, formato: 'CSV' | 'PDF', filas: number, sha256: string) =>
      solicitar<{ registrado: boolean; idCorrelacion: string }>('POST', '/reportes/exportaciones', { cuerpo: { reporte, formato, filas, sha256 } }),
  },

  periodos: {
    listar: () => solicitar<Periodo[]>('GET', '/periodos'),
    cerrar: (clave: string) => solicitar<void>('POST', `/periodos/${encodeURIComponent(clave)}/cierre`),
    solicitarReapertura: (clave: string, motivo: string) => solicitar<void>('POST', `/periodos/${encodeURIComponent(clave)}/reapertura`, { cuerpo: { motivo } }),
    resolverReapertura: (clave: string, aprobar: boolean, password: string) =>
      solicitar<void>('POST', `/periodos/${encodeURIComponent(clave)}/reapertura/resolucion`, { cuerpo: { aprobar, ...conPassword(password) } }),
  },

  usuarios: {
    listar: () => solicitar<UsuarioAdmin[]>('GET', '/usuarios'),
    crear: (datos: UsuarioNuevo, password: string) => solicitar<{ id: string; passwordTemporal: string }>('POST', '/usuarios', { cuerpo: { datos, ...conPassword(password) } }),
    solicitarRol: (
      usuarioId: string,
      datos: { rol: RolClave; almacenes: AlmacenClave[] | 'TODOS'; excepcionSod?: { justificacion: string; vence: string } | null },
      password: string,
    ) => solicitar<void>('POST', `/usuarios/${encodeURIComponent(usuarioId)}/asignaciones`, { cuerpo: { ...datos, ...conPassword(password) } }),
    cambiarEstado: (usuarioId: string, accion: 'baja' | 'desbloquear' | 'bloquear', motivo: string) =>
      solicitar<void>('POST', `/usuarios/${encodeURIComponent(usuarioId)}/estado`, { cuerpo: { accion, motivo } }),
    pendientes: () => solicitar<AsignacionDetalle[]>('GET', '/asignaciones/pendientes'),
    resolverAsignacion: (id: string, aprobar: boolean, motivo: string, password: string) =>
      solicitar<void>('POST', `/asignaciones/${encodeURIComponent(id)}/resolucion`, { cuerpo: { aprobar, motivo, ...conPassword(password) } }),
    retirarAsignacion: (id: string, motivo: string) => solicitar<void>('POST', `/asignaciones/${encodeURIComponent(id)}/retiro`, { cuerpo: { motivo } }),
    recertificar: (id: string, confirmar: boolean, motivo?: string) =>
      solicitar<void>('POST', `/asignaciones/${encodeURIComponent(id)}/recertificacion`, { cuerpo: { confirmar, motivo } }),
    matriz: () => solicitar<FilaPermisos[]>('GET', '/permisos/matriz'),
  },

  parametros: {
    listar: () => solicitar<Parametro[]>('GET', '/parametros'),
    proponer: (clave: string, valor: number, motivo: string, password: string) =>
      solicitar<void>('POST', `/parametros/${encodeURIComponent(clave)}/propuesta`, { cuerpo: { valor, motivo, ...conPassword(password) } }),
    resolver: (clave: string, aprobar: boolean, password: string) =>
      solicitar<void>('POST', `/parametros/${encodeURIComponent(clave)}/resolucion`, { cuerpo: { aprobar, ...conPassword(password) } }),
  },
};

export interface DatosProducto {
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
}
