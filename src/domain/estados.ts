import type { AccionDocumento, EstadoConteo, EstadoDocumento, EstadoHallazgo, EstadoUsuario, TipoDocumento } from '@/api/types';

export type Tono = 'ok' | 'alerta' | 'error' | 'ruta' | 'senal' | 'neutro';

export const ESTADO_DOC: Record<EstadoDocumento, { texto: string; tono: Tono }> = {
  BORRADOR: { texto: 'Borrador', tono: 'neutro' },
  PENDIENTE: { texto: 'Pendiente de aprobación', tono: 'alerta' },
  PENDIENTE_N2: { texto: 'Pendiente de gerencia', tono: 'alerta' },
  APROBADA: { texto: 'Aprobada', tono: 'ruta' },
  SURTIDA: { texto: 'Surtida', tono: 'ruta' },
  ENTREGADA: { texto: 'Entregada', tono: 'ok' },
  EN_TRANSITO: { texto: 'En tránsito', tono: 'ruta' },
  CON_DISCREPANCIA: { texto: 'Con discrepancia', tono: 'error' },
  CERRADA: { texto: 'Cerrada', tono: 'ok' },
  CONFIRMADA: { texto: 'Confirmada', tono: 'ok' },
  APLICADO: { texto: 'Aplicado', tono: 'ok' },
  RECHAZADA: { texto: 'Rechazada', tono: 'error' },
  CANCELADA: { texto: 'Cancelada', tono: 'neutro' },
  VENCIDA: { texto: 'Vencida', tono: 'neutro' },
};

export const ESTADO_CONTEO: Record<EstadoConteo, { texto: string; tono: Tono }> = {
  PROGRAMADO: { texto: 'Programado', tono: 'neutro' },
  EN_CONTEO: { texto: 'En conteo', tono: 'ruta' },
  SEGUNDO_CONTEO: { texto: 'Segundo conteo', tono: 'alerta' },
  CERRADO: { texto: 'Cerrado', tono: 'ok' },
  CANCELADO: { texto: 'Cancelado', tono: 'neutro' },
};

export const ESTADO_HALLAZGO: Record<EstadoHallazgo, { texto: string; tono: Tono }> = {
  ABIERTO: { texto: 'Abierto', tono: 'error' },
  EN_REVISION: { texto: 'En revisión', tono: 'alerta' },
  JUSTIFICADO: { texto: 'Justificado', tono: 'ok' },
  ESCALADO: { texto: 'Escalado', tono: 'ruta' },
};

export const ESTADO_USUARIO: Record<EstadoUsuario, { texto: string; tono: Tono }> = {
  PENDIENTE: { texto: 'Pendiente de aprobación', tono: 'alerta' },
  ACTIVO: { texto: 'Activo', tono: 'ok' },
  BLOQUEADO: { texto: 'Bloqueado', tono: 'error' },
  BAJA: { texto: 'Baja', tono: 'neutro' },
};

export const TIPO_DOC: Record<TipoDocumento, { singular: string; plural: string; ruta: string }> = {
  ENT: { singular: 'Recepción', plural: 'Recepciones', ruta: '/recepciones' },
  SAL: { singular: 'Salida', plural: 'Salidas', ruta: '/salidas' },
  TRF: { singular: 'Transferencia', plural: 'Transferencias', ruta: '/transferencias' },
  AJU: { singular: 'Ajuste', plural: 'Ajustes', ruta: '/ajustes' },
};

export const ACCION_DOC: Record<
  AccionDocumento,
  { texto: string; hecho: string; peligro?: boolean; requiereMotivo?: boolean; confirmacion: string }
> = {
  enviar_aprobacion: {
    texto: 'Enviar a aprobación',
    hecho: 'Enviado a aprobación',
    confirmacion: 'El documento pasará a la bandeja del aprobador y ya no podrás editarlo.',
  },
  aprobar: {
    texto: 'Aprobar',
    hecho: 'Aprobado',
    confirmacion: 'Tu aprobación queda registrada con tu usuario, fecha, hora e IP.',
  },
  rechazar: {
    texto: 'Rechazar',
    hecho: 'Rechazado',
    peligro: true,
    requiereMotivo: true,
    confirmacion: 'El documento regresa al solicitante con el motivo que escribas.',
  },
  cancelar: {
    texto: 'Cancelar documento',
    hecho: 'Documento cancelado',
    peligro: true,
    requiereMotivo: true,
    confirmacion: 'El folio se conserva como cancelado y se libera cualquier reserva. No se puede deshacer.',
  },
  surtir: {
    texto: 'Surtir',
    hecho: 'Surtido',
    confirmacion: 'El material sale físicamente del almacén y queda pendiente la confirmación del receptor.',
  },
  confirmar_entrega: {
    texto: 'Confirmar que lo recibí',
    hecho: 'Entrega confirmada',
    confirmacion: 'Confirmas con tu contraseña que recibiste el material surtido.',
  },
  enviar: {
    texto: 'Enviar transferencia',
    hecho: 'Transferencia enviada',
    confirmacion: 'La mercancía sale del origen y queda en el almacén virtual TRÁNSITO. Ya no se puede cancelar.',
  },
  recibir: {
    texto: 'Registrar recepción',
    hecho: 'Recepción registrada',
    confirmacion: 'Lo que captures se compara contra lo enviado. Cualquier diferencia abre una incidencia.',
  },
  resolver_incidencia: {
    texto: 'Resolver incidencia',
    hecho: 'Incidencia resuelta',
    requiereMotivo: true,
    confirmacion: 'La resolución mueve la diferencia según el tipo elegido y cierra la transferencia.',
  },
  confirmar_recepcion: {
    texto: 'Confirmar recepción',
    hecho: 'Recepción confirmada',
    confirmacion: 'Si no hay diferencias contra la orden de compra, la mercancía entra al inventario.',
  },
};

/** Orden de pasos para la ruta de cada tipo de documento (se muestra en el detalle) */
export const PASOS: Record<TipoDocumento, EstadoDocumento[]> = {
  ENT: ['BORRADOR', 'PENDIENTE', 'CONFIRMADA'],
  SAL: ['BORRADOR', 'PENDIENTE', 'APROBADA', 'SURTIDA', 'ENTREGADA'],
  TRF: ['BORRADOR', 'PENDIENTE', 'APROBADA', 'EN_TRANSITO', 'CERRADA'],
  AJU: ['BORRADOR', 'PENDIENTE', 'PENDIENTE_N2', 'APLICADO'],
};

export const ESTADOS_FINALES: readonly EstadoDocumento[] = [
  'ENTREGADA',
  'CERRADA',
  'CONFIRMADA',
  'APLICADO',
  'RECHAZADA',
  'CANCELADA',
  'VENCIDA',
];
