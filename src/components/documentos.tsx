import { ArrowRight } from 'lucide-react';
import type { DocumentoResumen, TipoDocumento } from '@/api/types';
import { ESTADO_DOC, TIPO_DOC } from '@/domain/estados';
import { fmtFechaHora, fmtMoneda } from '@/domain/formato';
import { Estado, Folio } from './ui';

export function Almacenes({ origen, destino }: { origen: string | null; destino: string | null }) {
  if (origen && destino) {
    return (
      <span className="fila" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <span className="etiqueta">{origen}</span>
        <ArrowRight size={14} aria-label="hacia" />
        <span className="etiqueta">{destino}</span>
      </span>
    );
  }
  return <span className="etiqueta">{origen ?? destino ?? '—'}</span>;
}

export function TablaDocumentos({ documentos, mostrarTipo = false, compacta = false, vacio }: { documentos: DocumentoResumen[]; mostrarTipo?: boolean; compacta?: boolean; vacio?: React.ReactNode }) {
  if (!documentos.length) return <>{vacio}</>;
  return (
    <div className="tabla-contenedor">
      <table className="tabla">
        <thead>
          <tr>
            <th scope="col">Folio</th>
            {mostrarTipo && <th scope="col">Tipo</th>}
            <th scope="col">Estado</th>
            <th scope="col">Almacén</th>
            {!compacta && <th scope="col">Motivo</th>}
            {!compacta && <th scope="col">Creó</th>}
            <th scope="col" className="num">
              Importe
            </th>
            {!compacta && <th scope="col">Actualizado</th>}
          </tr>
        </thead>
        <tbody>
          {documentos.map((d) => {
            const e = ESTADO_DOC[d.estado];
            const accionMia = d.accionesPermitidas.some((a) => a !== 'cancelar' && a !== 'rechazar');
            return (
              <tr key={d.id}>
                <td>
                  <Folio folio={d.folio} a={`${TIPO_DOC[d.tipo].ruta}/${d.id}`} />
                </td>
                {mostrarTipo && <td>{TIPO_DOC[d.tipo].singular}</td>}
                <td>
                  <div className="fila" style={{ gap: 6 }}>
                    <Estado tono={e.tono}>{e.texto}</Estado>
                    {accionMia && <Estado tono="senal">Te toca</Estado>}
                  </div>
                </td>
                <td>
                  <Almacenes origen={d.almacenOrigen} destino={d.almacenDestino} />
                </td>
                {!compacta && (
                  <td>
                    {d.motivo?.nombre ?? '—'}
                    {d.nivelAprobacion !== 'SUP' && <span className="tabla__secundario">Aprobación: {d.nivelAprobacion === 'GER' ? 'Gerencia' : 'Supervisor y Gerencia'}</span>}
                  </td>
                )}
                {!compacta && <td>{d.creadoPor.usuario.nombre}</td>}
                <td className="num">
                  {d.estado === 'EN_TRANSITO' && d.montoTotal === 0 ? <span className="suave">Oculto</span> : fmtMoneda(d.montoTotal)}
                  {compacta && <span className="tabla__secundario">{fmtFechaHora(d.actualizadoEn)}</span>}
                </td>
                {!compacta && <td>{fmtFechaHora(d.actualizadoEn)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const TEXTO_NUEVO: Record<TipoDocumento, string> = {
  ENT: 'Registrar recepción',
  SAL: 'Solicitar material',
  TRF: 'Nueva transferencia',
  AJU: 'Capturar ajuste',
};
