/** Formatos de presentación (RNF-REG-01): MXN, dd/mm/aaaa, hora de Ciudad de México. */

const ZONA = 'America/Mexico_City';

const moneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
const monedaCorta = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const numero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 4 });
const fecha = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric' });
const fechaHora = new Intl.DateTimeFormat('es-MX', {
  timeZone: ZONA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const fechaHoraSeg = new Intl.DateTimeFormat('es-MX', {
  timeZone: ZONA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const relativo = new Intl.RelativeTimeFormat('es-MX', { numeric: 'auto' });

export const fmtMoneda = (n: number | null | undefined): string => (n == null ? '—' : moneda.format(n));
export const fmtMonedaCorta = (n: number | null | undefined): string => (n == null ? '—' : monedaCorta.format(n));
export const fmtNumero = (n: number | null | undefined): string => (n == null ? '—' : numero.format(n));
export const fmtFecha = (iso: string | null | undefined): string => (iso ? fecha.format(new Date(iso)) : '—');
export const fmtFechaHora = (iso: string | null | undefined): string => (iso ? fechaHora.format(new Date(iso)) : '—');
export const fmtFechaHoraSeg = (iso: string | null | undefined): string => (iso ? fechaHoraSeg.format(new Date(iso)) : '—');
export const fmtPorcentaje = (n: number | null | undefined, decimales = 1): string =>
  n == null ? '—' : `${n.toFixed(decimales)} %`;

export function fmtRelativo(iso: string | null | undefined, ahora: Date = new Date()): string {
  if (!iso) return '—';
  const diffSeg = Math.round((new Date(iso).getTime() - ahora.getTime()) / 1000);
  const abs = Math.abs(diffSeg);
  if (abs < 60) return relativo.format(diffSeg, 'second');
  if (abs < 3600) return relativo.format(Math.round(diffSeg / 60), 'minute');
  if (abs < 86400) return relativo.format(Math.round(diffSeg / 3600), 'hour');
  return relativo.format(Math.round(diffSeg / 86400), 'day');
}

/** Redondeo a centavos sin errores de punto flotante en la presentación */
export const redondear = (n: number, decimales = 2): number => {
  const f = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * f) / f;
};

export function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export const ALMACEN_NOMBRE: Record<string, string> = {
  CEN: 'Planta Central',
  NTE: 'Regional Norte',
  CTR: 'Regional Centro',
  SUR: 'Regional Sur',
  TRANSITO: 'En tránsito',
  TODOS: 'Todos los almacenes',
};
