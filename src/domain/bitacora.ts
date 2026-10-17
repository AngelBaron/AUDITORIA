/** Traduce los códigos de acción de la bitácora a frases para el historial de un documento. */
const ACCIONES: Record<string, string> = {
  CREAR: 'Creó el documento',
  ENVIAR_APROBACION: 'Envió a aprobación',
  APROBAR: 'Aprobó',
  RECHAZAR: 'Rechazó',
  CANCELAR: 'Canceló',
  SURTIR: 'Surtió el material',
  CONFIRMAR_ENTREGA: 'Confirmó la entrega',
  ENVIAR: 'Envió a tránsito',
  RECIBIR: 'Registró la recepción',
  RESOLVER_INCIDENCIA: 'Resolvió la incidencia',
  CONFIRMAR_RECEPCION: 'Confirmó la captura',
  APROBACION_VENCIDA: 'Venció el plazo de aprobación',
  VENCER: 'Venció sin surtirse',
};

const INTENTOS: Record<string, string> = {
  APROBAR: 'Intentó aprobar',
  RECHAZAR: 'Intentó rechazar',
  SURTIR: 'Intentó surtir',
  ENVIAR: 'Intentó enviar',
  RECIBIR: 'Intentó recibir',
  RESOLVER_INCIDENCIA: 'Intentó resolver la incidencia',
  CANCELAR: 'Intentó cancelar',
};

export function textoAccion(codigo: string, exito: boolean): string {
  if (codigo === 'ACCESO_DENEGADO') return 'Intento de consulta sin acceso';
  const sufijo = codigo.replace(/^(ENT|SAL|TRF|AJU)_/, '');
  if (!exito) return INTENTOS[sufijo] ?? `Intento rechazado: ${sufijo.toLowerCase().replace(/_/g, ' ')}`;
  return ACCIONES[sufijo] ?? sufijo.charAt(0) + sufijo.slice(1).toLowerCase().replace(/_/g, ' ');
}
