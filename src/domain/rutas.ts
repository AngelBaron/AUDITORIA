import { TIPO_DOC } from './estados';
import type { TipoDocumento } from '@/api/types';

/** Ruta interna de un documento a partir de su folio (ENT-, SAL-, TRF-, AJU-). */
export function rutaPorFolio(folio: string, id: string): string | undefined {
  const tipo = folio.slice(0, 3) as TipoDocumento;
  return TIPO_DOC[tipo] ? `${TIPO_DOC[tipo].ruta}/${encodeURIComponent(id)}` : undefined;
}
