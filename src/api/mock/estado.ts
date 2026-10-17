/**
 * Estado en memoria del backend simulado. Imita las tablas del modelo de datos (ERS sección 17).
 * Vive solo en memoria: al recargar la página se reinicia (no se usa localStorage).
 */
import type {
  AlmacenClave,
  Adjunto,
  ClaseAbc,
  EstadoConteo,
  EstadoDocumento,
  EstadoHallazgo,
  EstadoUsuario,
  EventoBitacora,
  Incidencia,
  Movimiento,
  Producto,
  RolClave,
  Severidad,
  TipoDocumento,
  UbicacionSerie,
  UnidadMedida,
} from '@/api/types';

export interface UsuarioDB {
  id: string;
  correo: string;
  nombre: string;
  numEmpleado: string;
  puesto: string;
  centroCosto: string | null;
  password: string; // en el backend real: hash Argon2id. Aquí nunca sale del mock.
  historialPasswords: string[];
  estado: EstadoUsuario;
  intentosFallidos: number;
  bloqueadoHasta: number | null;
  mfaActivo: boolean;
  debeCambiarPassword: boolean;
  passwordTemporalExpira: number | null;
  ultimoAcceso: string | null;
  /** acceso exitoso anterior al actual: es el que se muestra al usuario (RS-SES-08) */
  ultimoAccesoAnterior: string | null;
  /** intentos fallidos acumulados desde el último acceso exitoso (se muestran al usuario, RS-SES-08) */
  fallidosDesdeUltimoAcceso: number;
  fallidosPendientes: number;
  ipHabitual: string;
  creadoPor: string;
  creadoEn: string;
}

export interface AsignacionDB {
  id: string;
  usuarioId: string;
  rol: RolClave;
  almacenes: AlmacenClave[] | 'TODOS';
  estado: 'PENDIENTE' | 'VIGENTE' | 'RECHAZADA' | 'RETIRADA';
  solicitadoPor: string;
  aprobadoPor: string | null;
  fechaSolicitud: string;
  ultimaRecertificacion: string | null;
  excepcionSod: { justificacion: string; vence: string } | null;
}

export interface SesionDB {
  id: string;
  usuarioId: string;
  ip: string;
  userAgent: string;
  creada: string;
  ultimaActividad: number;
  accesoExpira: number;
  renovacionExpira: number;
  refresh: string;
  refreshUsados: string[];
  revocada: boolean;
}

export interface DesafioMfaDB {
  id: string;
  usuarioId: string;
  expira: number;
  intentos: number;
  ip: string;
  userAgent: string;
}

export interface RenglonDB {
  id: string;
  productoId: string;
  cantidad: number;
  cantidadEsperada: number | null;
  cantidadSurtida: number | null;
  cantidadEnviada: number | null;
  cantidadRecibida: number | null;
  costoUnitario: number;
  series: string[];
  seriesRecibidas: string[];
  ocRenglon: number | null;
}

export interface PartDB {
  usuarioId: string;
  fecha: string;
}

export interface DocumentoDB {
  id: string;
  tipo: TipoDocumento;
  folio: string;
  estado: EstadoDocumento;
  version: number;
  almacenOrigen: AlmacenClave | null;
  almacenDestino: AlmacenClave | null;
  motivo: string | null;
  justificacion: string;
  centroCosto: string | null;
  ordenCompraId: string | null;
  proveedorId: string | null;
  transporte: { transportista: string; unidad: string; sellos: string } | null;
  fechaRequerida: string | null;
  fechaMovimiento: string;
  extemporanea: boolean;
  renglones: RenglonDB[];
  nivelAprobacion: 'SUP' | 'GER' | 'SUP+GER';
  creadoPor: PartDB;
  enviadoAprobacionPor: PartDB | null;
  aprobador1: PartDB | null;
  aprobador2: PartDB | null;
  surtidoPor: PartDB | null;
  enviadoPor: PartDB | null;
  recibidoPor: PartDB | null;
  entregadoA: PartDB | null;
  rechazadoPor: PartDB | null;
  canceladoPor: PartDB | null;
  motivoRechazo: string | null;
  motivoCancelacion: string | null;
  incidencia: (Omit<Incidencia, 'resueltoPor'> & { resueltoPor: PartDB | null; sobrantesSeries: string[] }) | null;
  adjuntos: Adjunto[];
  creadoEn: string;
  actualizadoEn: string;
  /** usuarios que contaron (RS-SOD-08) cuando el ajuste viene de un conteo */
  contadores: string[];
  referencia: string | null;
  alertaTransitoEmitida: boolean;
}

export interface OrdenCompraDB {
  id: string;
  folio: string;
  proveedorId: string;
  almacenDestino: AlmacenClave;
  estado: 'ABIERTA' | 'PARCIAL' | 'CERRADA' | 'CANCELADA';
  renglones: { productoId: string; cantidad: number; recibida: number; costoUnitario: number }[];
  creadoPor: PartDB;
}

export interface ConteoDB {
  id: string;
  folio: string;
  almacen: AlmacenClave;
  tipo: 'CICLICO' | 'GENERAL';
  clase: ClaseAbc | null;
  estado: EstadoConteo;
  programadoPor: PartDB;
  iniciadoPor: PartDB | null;
  cerradoPor: PartDB | null;
  renglones: {
    productoId: string;
    existenciaSistema: number;
    conteo1: number | null;
    contador1: string | null;
    conteo2: number | null;
    contador2: string | null;
    requiereSegundo: boolean;
  }[];
  ajustesGenerados: string[];
  ira: number | null;
  version: number;
  creadoEn: string;
}

export interface HallazgoDB {
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
  /** quién debe verlo además de AUD */
  destinatarios: RolClave[];
}

export interface SerieDB {
  productoId: string;
  ubicacion: UbicacionSerie;
  recorrido: { fecha: string; folio: string; documentoId: string; desde: string; hacia: string; usuario: string }[];
}

export interface ParametroDB {
  clave: string;
  nombre: string;
  descripcion: string;
  valor: number;
  unidad: 'MXN' | '%' | 'días' | 'horas' | 'minutos';
  modificadoPor: string | null;
  modificadoEn: string | null;
  solicitud: { id: string; valorPropuesto: number; motivo: string; solicitadoPor: string; fecha: string } | null;
}

export interface PeriodoDB {
  clave: string;
  estado: 'ABIERTO' | 'CERRADO' | 'REAPERTURA_SOLICITADA';
  cerradoPor: PartDB | null;
  solicitudReapertura: { usuarioId: string; motivo: string; fecha: string } | null;
}

export interface ProductoDB extends Producto {
  historialCosto: { fecha: string; anterior: number; nuevo: number; motivo: string; usuarioId: string }[];
  unidad: UnidadMedida;
}

/** Todo lo que participa en una transacción (se clona para poder hacer rollback). */
export interface Tablas {
  usuarios: UsuarioDB[];
  asignaciones: AsignacionDB[];
  sesiones: SesionDB[];
  desafios: DesafioMfaDB[];
  productos: ProductoDB[];
  existencias: Record<string, { fisica: number; reservada: number }>;
  series: Record<string, SerieDB>;
  documentos: DocumentoDB[];
  movimientos: Movimiento[];
  ordenesCompra: OrdenCompraDB[];
  conteos: ConteoDB[];
  hallazgos: HallazgoDB[];
  parametros: ParametroDB[];
  periodos: PeriodoDB[];
  folios: Record<string, number>;
  idempotencia: Record<string, { usuarioId: string; status: number; cuerpo: unknown; huella: string }>;
  intentosLoginPorIp: Record<string, number[]>;
  violacionesSod: Record<string, number[]>;
  secuencia: number;
}

export interface BaseDatos {
  t: Tablas;
  /** La bitácora vive fuera de la transacción de negocio solo en el sentido de que se
   *  confirma junto con ella; ver bitacora.ts. Es append-only. */
  bitacora: EventoBitacora[];
}

export const llaveExistencia = (almacen: AlmacenClave | 'TRANSITO', productoId: string) => `${almacen}|${productoId}`;

export function crearBaseVacia(): BaseDatos {
  return {
    t: {
      usuarios: [],
      asignaciones: [],
      sesiones: [],
      desafios: [],
      productos: [],
      existencias: {},
      series: {},
      documentos: [],
      movimientos: [],
      ordenesCompra: [],
      conteos: [],
      hallazgos: [],
      parametros: [],
      periodos: [],
      folios: {},
      idempotencia: {},
      intentosLoginPorIp: {},
      violacionesSod: {},
      secuencia: 1,
    },
    bitacora: [],
  };
}

export function nuevoId(prefijo: string): string {
  return `${prefijo}-${crypto.randomUUID()}`;
}

export function siguienteFolio(t: Tablas, tipo: string, almacen: string): string {
  const llave = `${tipo}-${almacen}`;
  const n = (t.folios[llave] ?? 0) + 1;
  t.folios[llave] = n;
  return `${tipo}-${almacen}-${String(n).padStart(6, '0')}`;
}
