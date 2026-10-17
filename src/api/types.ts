/**
 * Contrato de datos entre el frontend y la API de SICIL (/api/v1).
 * El backend real debe responder con estas mismas formas; el mock las implementa
 * para que conectar el backend sea solo cambiar VITE_API_MODE=real.
 */

export type RolClave = 'ALM' | 'SUP' | 'GER' | 'SOL' | 'CMP' | 'CON' | 'AUD' | 'ADM' | 'SEG';
export type AlmacenClave = 'CEN' | 'NTE' | 'CTR' | 'SUR';
export type UbicacionSerie = AlmacenClave | 'TRANSITO' | 'ENTREGADO' | 'BAJA';

export type Permiso =
  | 'existencias.ver'
  | 'catalogo.ver'
  | 'catalogo.editar'
  | 'oc.ver'
  | 'oc.crear'
  | 'recepcion.ver'
  | 'recepcion.crear'
  | 'recepcion.aprobar'
  | 'salida.ver'
  | 'salida.solicitar'
  | 'salida.aprobar'
  | 'salida.surtir'
  | 'transferencia.ver'
  | 'transferencia.crear'
  | 'transferencia.aprobar'
  | 'transferencia.operar'
  | 'incidencia.resolver'
  | 'ajuste.ver'
  | 'ajuste.crear'
  | 'ajuste.aprobar'
  | 'conteo.ver'
  | 'conteo.capturar'
  | 'conteo.programar'
  | 'conteo.cerrar'
  | 'periodo.cerrar'
  | 'periodo.aprobar'
  | 'reportes.ver'
  | 'valuacion.ver'
  | 'bitacora.ver'
  | 'hallazgos.ver'
  | 'hallazgos.gestionar'
  | 'usuarios.ver'
  | 'usuarios.gestionar'
  | 'usuarios.aprobar'
  | 'parametros.ver'
  | 'parametros.proponer'
  | 'parametros.aprobar';

export interface Ref {
  id: string;
  nombre: string;
}

export interface Paginado<T> {
  datos: T[];
  pagina: number;
  porPagina: number;
  total: number;
}

/* ───────────── Autenticación ───────────── */

export interface AsignacionRol {
  id: string;
  rol: RolClave;
  almacenes: AlmacenClave[] | 'TODOS';
}

export interface UsuarioSesion {
  id: string;
  nombre: string;
  correo: string;
  numEmpleado: string;
  puesto: string;
  centroCosto: string | null;
  roles: AsignacionRol[];
  permisos: Permiso[];
  /** Almacenes donde el usuario puede operar o consultar */
  almacenes: AlmacenClave[];
  mfaActivo: boolean;
  debeCambiarPassword: boolean;
  ultimoAccesoExitoso: string | null;
  intentosFallidosDesdeUltimo: number;
  sesionExpiraEn: string;
}

export type RespuestaLogin =
  | { estado: 'MFA_REQUERIDO'; desafioId: string }
  | { estado: 'OK'; usuario: UsuarioSesion };

export interface SesionActiva {
  id: string;
  ip: string;
  dispositivo: string;
  creada: string;
  ultimaActividad: string;
  actual: boolean;
}

/* ───────────── Catálogos ───────────── */

export interface Almacen {
  clave: AlmacenClave;
  nombre: string;
  ciudad: string;
  responsable: string;
}

export type UnidadMedida = 'PZA' | 'CAJA' | 'M' | 'KIT';
export type ClaseAbc = 'A' | 'B' | 'C';

export interface Producto {
  id: string;
  sku: string;
  descripcion: string;
  categoria: string;
  unidad: UnidadMedida;
  costoEstandar: number;
  costoPromedio: number;
  stockMinimo: number;
  stockMaximo: number;
  puntoReorden: number;
  claseAbc: ClaseAbc;
  serializado: boolean;
  sensible: boolean;
  activo: boolean;
  version: number;
}

export interface CambioCosto {
  fecha: string;
  anterior: number;
  nuevo: number;
  motivo: string;
  usuario: string;
}

export interface Motivo {
  clave: string;
  nombre: string;
  aplicaA: TipoDocumento[];
  requiereJustificacionExtendida: boolean;
}

export interface CentroCosto {
  clave: string;
  nombre: string;
}

export interface Proveedor {
  id: string;
  nombre: string;
  rfc: string;
}

/* ───────────── Inventario ───────────── */

export interface Existencia {
  almacen: AlmacenClave;
  producto: Pick<Producto, 'id' | 'sku' | 'descripcion' | 'unidad' | 'categoria' | 'serializado' | 'sensible' | 'claseAbc' | 'puntoReorden'>;
  fisica: number;
  reservada: number;
  disponible: number;
  enTransitoEntrante: number;
  costoPromedio: number;
  valor: number;
  bajoReorden: boolean;
  bloqueadaPorConteo: boolean;
}

export type TipoMovimiento =
  | 'ENTRADA'
  | 'SALIDA'
  | 'TRANSF_SALIDA'
  | 'TRANSF_ENTRADA'
  | 'TRANSITO_ENTRADA'
  | 'TRANSITO_SALIDA'
  | 'AJUSTE_POS'
  | 'AJUSTE_NEG'
  | 'MERMA';

export interface Movimiento {
  id: number;
  fecha: string;
  documentoId: string;
  folio: string;
  tipo: TipoMovimiento;
  almacen: AlmacenClave | 'TRANSITO';
  productoId: string;
  entrada: number;
  salida: number;
  saldo: number;
  costoUnitario: number;
  costoPromedio: number;
  usuario: string;
  series: string[];
}

export interface RastreoSerie {
  numero: string;
  producto: Pick<Producto, 'id' | 'sku' | 'descripcion'>;
  ubicacion: UbicacionSerie;
  recorrido: { fecha: string; folio: string; documentoId: string; desde: string; hacia: string; usuario: string }[];
}

/* ───────────── Documentos ───────────── */

export type TipoDocumento = 'ENT' | 'SAL' | 'TRF' | 'AJU';

export type EstadoDocumento =
  | 'BORRADOR'
  | 'PENDIENTE'
  | 'PENDIENTE_N2'
  | 'APROBADA'
  | 'SURTIDA'
  | 'ENTREGADA'
  | 'EN_TRANSITO'
  | 'CON_DISCREPANCIA'
  | 'CERRADA'
  | 'CONFIRMADA'
  | 'APLICADO'
  | 'RECHAZADA'
  | 'CANCELADA'
  | 'VENCIDA';

export type AccionDocumento =
  | 'enviar_aprobacion'
  | 'aprobar'
  | 'rechazar'
  | 'cancelar'
  | 'surtir'
  | 'confirmar_entrega'
  | 'enviar'
  | 'recibir'
  | 'resolver_incidencia'
  | 'confirmar_recepcion';

export interface Participacion {
  usuario: Ref;
  fecha: string;
}

export interface RenglonDocumento {
  id: string;
  productoId: string;
  sku: string;
  descripcion: string;
  unidad: UnidadMedida;
  serializado: boolean;
  /** Cantidad pedida / capturada. En ajustes puede ser negativa. */
  cantidad: number;
  /** Solo en recepciones con OC. null cuando la captura es ciega para el usuario. */
  cantidadEsperada: number | null;
  cantidadSurtida: number | null;
  /** null cuando el usuario actual debe recibir a ciegas */
  cantidadEnviada: number | null;
  cantidadRecibida: number | null;
  diferencia: number | null;
  costoUnitario: number;
  importe: number;
  series: string[];
  seriesRecibidas: string[];
}

export interface Adjunto {
  id: string;
  nombre: string;
  tipoMime: string;
  tamano: number;
  sha256: string;
  subidoPor: string;
  fecha: string;
}

export type TipoResolucion = 'FALTANTE_IMPUTABLE' | 'DANIO_TRANSITO' | 'ERROR_CAPTURA';

export interface Incidencia {
  id: string;
  estado: 'ABIERTA' | 'RESUELTA';
  renglones: { sku: string; descripcion: string; enviada: number; recibida: number; diferencia: number }[];
  tipoResolucion: TipoResolucion | null;
  resolucion: string | null;
  resueltoPor: Participacion | null;
}

export interface BloqueoAccion {
  accion: AccionDocumento;
  codigo: string;
  mensaje: string;
}

export interface Documento {
  id: string;
  tipo: TipoDocumento;
  folio: string;
  estado: EstadoDocumento;
  version: number;
  almacenOrigen: AlmacenClave | null;
  almacenDestino: AlmacenClave | null;
  motivo: { clave: string; nombre: string } | null;
  justificacion: string;
  centroCosto: string | null;
  ordenCompra: string | null;
  proveedor: string | null;
  transporte: { transportista: string; unidad: string; sellos: string } | null;
  fechaRequerida: string | null;
  extemporanea: boolean;
  renglones: RenglonDocumento[];
  montoTotal: number;
  nivelAprobacion: 'SUP' | 'GER' | 'SUP+GER';
  creadoPor: Participacion;
  enviadoAprobacionPor: Participacion | null;
  aprobador1: Participacion | null;
  aprobador2: Participacion | null;
  surtidoPor: Participacion | null;
  enviadoPor: Participacion | null;
  recibidoPor: Participacion | null;
  entregadoA: Participacion | null;
  rechazadoPor: Participacion | null;
  canceladoPor: Participacion | null;
  motivoRechazo: string | null;
  motivoCancelacion: string | null;
  incidencia: Incidencia | null;
  adjuntos: Adjunto[];
  creadoEn: string;
  actualizadoEn: string;
  venceEn: string | null;
  /** Acciones que el usuario actual puede ejecutar ahora (calculadas por el servidor) */
  accionesPermitidas: AccionDocumento[];
  /** Acciones bloqueadas y por qué (segregación de funciones, alcance, estado) */
  bloqueos: BloqueoAccion[];
  /** Origen del documento, p. ej. el conteo que generó un ajuste */
  referencia: string | null;
}

export type DocumentoResumen = Pick<
  Documento,
  | 'id'
  | 'tipo'
  | 'folio'
  | 'estado'
  | 'almacenOrigen'
  | 'almacenDestino'
  | 'motivo'
  | 'montoTotal'
  | 'creadoPor'
  | 'creadoEn'
  | 'actualizadoEn'
  | 'accionesPermitidas'
  | 'nivelAprobacion'
  | 'centroCosto'
> & { renglonesCount: number };

export interface RenglonNuevo {
  productoId: string;
  cantidad: number;
  costoUnitario?: number;
  series?: string[];
}

export interface DocumentoNuevo {
  tipo: TipoDocumento;
  almacenOrigen?: AlmacenClave | null;
  almacenDestino?: AlmacenClave | null;
  motivo?: string | null;
  justificacion: string;
  centroCosto?: string | null;
  ordenCompraId?: string | null;
  proveedorId?: string | null;
  fechaRequerida?: string | null;
  fechaMovimiento?: string | null;
  renglones: RenglonNuevo[];
  adjuntos?: AdjuntoNuevo[];
  enviarAprobacion: boolean;
}

export interface AdjuntoNuevo {
  nombre: string;
  tipoMime: string;
  tamano: number;
  sha256: string;
  contenidoBase64: string;
}

export interface CuerpoAccion {
  version: number;
  motivo?: string;
  reautenticacion?: { password: string };
  transporte?: { transportista: string; unidad: string; sellos: string };
  renglones?: { renglonId: string; cantidad: number; series?: string[] }[];
  tipoResolucion?: TipoResolucion;
}

export interface EventoTimeline {
  id: number;
  fecha: string;
  accion: string;
  usuario: string;
  resultado: ResultadoEvento;
  detalle: string | null;
  ip: string;
}

/* ───────────── Órdenes de compra ───────────── */

export interface OrdenCompra {
  id: string;
  folio: string;
  proveedor: Proveedor;
  almacenDestino: AlmacenClave;
  estado: 'ABIERTA' | 'PARCIAL' | 'CERRADA' | 'CANCELADA';
  renglones: { productoId: string; sku: string; descripcion: string; cantidad: number; recibida: number; costoUnitario: number }[];
  creadoPor: Participacion;
  total: number;
}

/* ───────────── Conteos ───────────── */

export type EstadoConteo = 'PROGRAMADO' | 'EN_CONTEO' | 'SEGUNDO_CONTEO' | 'CERRADO' | 'CANCELADO';

export interface RenglonConteo {
  productoId: string;
  sku: string;
  descripcion: string;
  unidad: UnidadMedida;
  /** null mientras el usuario actual sea contador (conteo ciego) */
  existenciaSistema: number | null;
  conteo1: number | null;
  contador1: string | null;
  conteo2: number | null;
  contador2: string | null;
  requiereSegundo: boolean;
  diferencia: number | null;
  diferenciaValor: number | null;
}

export interface Conteo {
  id: string;
  folio: string;
  almacen: AlmacenClave;
  tipo: 'CICLICO' | 'GENERAL';
  clase: ClaseAbc | null;
  estado: EstadoConteo;
  programadoPor: Participacion;
  iniciadoPor: Participacion | null;
  cerradoPor: Participacion | null;
  renglones: RenglonConteo[];
  ajustesGenerados: { id: string; folio: string }[];
  ira: number | null;
  version: number;
  accionesPermitidas: ('iniciar' | 'capturar_primero' | 'capturar_segundo' | 'cerrar' | 'cancelar')[];
  bloqueos: { accion: string; mensaje: string }[];
  creadoEn: string;
}

/* ───────────── Bandeja ───────────── */

export interface ElementoBandeja {
  id: string;
  tipo: 'DOCUMENTO' | 'CONTEO' | 'ASIGNACION' | 'PARAMETRO' | 'HALLAZGO' | 'PERIODO' | 'ALTA_USUARIO';
  titulo: string;
  detalle: string;
  folio: string | null;
  ruta: string;
  accion: string;
  fecha: string;
  urgente: boolean;
}

/* ───────────── Bitácora ───────────── */

export type ResultadoEvento = 'EXITO' | 'RECHAZADO' | 'ERROR';
export type Severidad = 'INFO' | 'MEDIA' | 'ALTA' | 'CRITICA';

export interface EventoBitacora {
  id: number;
  uuid: string;
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
  hashAnterior: string;
  hashActual: string;
}

export interface FiltrosBitacora {
  desde?: string;
  hasta?: string;
  usuario?: string;
  accion?: string;
  folio?: string;
  almacen?: string;
  resultado?: string;
  severidad?: string;
  ip?: string;
  pagina?: number;
}

export interface VerificacionCadena {
  integra: boolean;
  eventosVerificados: number;
  primerEslabonRoto: number | null;
  verificadoEn: string;
}

/* ───────────── Hallazgos y alertas ───────────── */

export type EstadoHallazgo = 'ABIERTO' | 'EN_REVISION' | 'JUSTIFICADO' | 'ESCALADO';

export interface Hallazgo {
  id: string;
  categoria: 'SEGURIDAD' | 'FRAUDE' | 'INTEGRIDAD';
  regla: string;
  titulo: string;
  detalle: string;
  severidad: Severidad;
  estado: EstadoHallazgo;
  referencia: string | null;
  fecha: string;
  historial: { fecha: string; usuario: string; estado: EstadoHallazgo; comentario: string }[];
}

/* ───────────── Reportes ───────────── */

export interface FilaValuacion {
  almacen: AlmacenClave | 'TRANSITO';
  sku: string;
  descripcion: string;
  existencia: number;
  costoPromedio: number;
  valor: number;
}

export interface FilaMerma {
  folio: string;
  documentoId: string;
  fecha: string;
  almacen: AlmacenClave | 'TRANSITO';
  motivo: string;
  usuario: string;
  aprobadores: string;
  cantidad: number;
  valor: number;
}

export interface FilaDiscrepancia {
  folio: string;
  documentoId: string;
  origen: AlmacenClave;
  destino: AlmacenClave;
  transportista: string;
  diferenciaPiezas: number;
  diferenciaValor: number;
  estado: 'ABIERTA' | 'RESUELTA';
  resolucion: string | null;
}

export interface FilaConciliacion {
  almacen: AlmacenClave | 'TRANSITO';
  sku: string;
  existenciaRegistrada: number;
  sumaMovimientos: number;
  diferencia: number;
}

export interface FilaFueraHorario {
  fecha: string;
  folio: string;
  accion: string;
  usuario: string;
  almacen: string;
}

export interface FilaTopUsuario {
  usuario: string;
  ajustes: number;
  cancelaciones: number;
  rechazos: number;
  valorAjustesNeg: number;
}

export interface Periodo {
  clave: string; // AAAA-MM
  estado: 'ABIERTO' | 'CERRADO' | 'REAPERTURA_SOLICITADA';
  cerradoPor: Participacion | null;
  solicitudReapertura: { usuario: string; motivo: string; fecha: string } | null;
}

/* ───────────── Usuarios y accesos ───────────── */

export type EstadoUsuario = 'PENDIENTE' | 'ACTIVO' | 'BLOQUEADO' | 'BAJA';

export interface UsuarioAdmin {
  id: string;
  nombre: string;
  correo: string;
  numEmpleado: string;
  puesto: string;
  estado: EstadoUsuario;
  mfaActivo: boolean;
  ultimoAcceso: string | null;
  asignaciones: AsignacionDetalle[];
  creadoPor: string;
  diasSinUso: number | null;
}

export interface AsignacionDetalle {
  id: string;
  usuarioId: string;
  usuarioNombre: string;
  rol: RolClave;
  almacenes: AlmacenClave[] | 'TODOS';
  estado: 'PENDIENTE' | 'VIGENTE' | 'RECHAZADA' | 'RETIRADA';
  solicitadoPor: string;
  aprobadoPor: string | null;
  fechaSolicitud: string;
  ultimaRecertificacion: string | null;
  excepcionSod: { justificacion: string; vence: string } | null;
}

export interface UsuarioNuevo {
  nombre: string;
  correo: string;
  numEmpleado: string;
  puesto: string;
  centroCosto: string | null;
  rol: RolClave;
  almacenes: AlmacenClave[] | 'TODOS';
  excepcionSod?: { justificacion: string; vence: string } | null;
}

export interface FilaPermisos {
  usuario: string;
  rol: RolClave;
  almacenes: string;
  permisos: Permiso[];
}

/* ───────────── Parámetros ───────────── */

export interface Parametro {
  clave: string;
  nombre: string;
  descripcion: string;
  valor: number;
  unidad: 'MXN' | '%' | 'días' | 'horas' | 'minutos';
  modificadoPor: string | null;
  modificadoEn: string | null;
  solicitudPendiente: { id: string; valorPropuesto: number; motivo: string; solicitadoPor: string; fecha: string } | null;
}

/* ───────────── Tablero ───────────── */

export interface Tablero {
  pendientesMios: number;
  enTransito: number;
  discrepanciasAbiertas: number;
  valorInventario: number | null;
  mermaMes: number | null;
  ira: number | null;
  bajoReorden: number;
  hallazgosAbiertos: number;
  recientes: DocumentoResumen[];
  mermaPorAlmacen: { almacen: AlmacenClave; valor: number }[] | null;
}
