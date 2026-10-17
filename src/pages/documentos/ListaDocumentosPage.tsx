import { useDeferredValue, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { api } from '@/api/cliente';
import type { EstadoDocumento, Permiso, TipoDocumento } from '@/api/types';
import { useUsuario } from '@/auth/AuthContext';
import { TablaDocumentos, TEXTO_NUEVO } from '@/components/documentos';
import { Cabecera, Campo, Cargando, ErrorCarga, Paginacion, Vacio } from '@/components/ui';
import { ESTADO_DOC, PASOS, TIPO_DOC } from '@/domain/estados';
import { ALMACEN_NOMBRE } from '@/domain/formato';
import { puede } from '@/domain/permisos';
import { useConsulta } from '@/hooks/useConsulta';

const PERMISO_CREAR: Record<TipoDocumento, Permiso> = { ENT: 'recepcion.crear', SAL: 'salida.solicitar', TRF: 'transferencia.crear', AJU: 'ajuste.crear' };

const DESCRIPCION: Record<TipoDocumento, string> = {
  ENT: 'Entradas de mercancía contra orden de compra. La captura es ciega: quien recibe no ve la cantidad esperada.',
  SAL: 'Solicitudes de material. Las aprueba una persona distinta a quien las pide, las surte otra y el solicitante confirma la entrega.',
  TRF: 'Movimientos entre almacenes. Al enviarse pasan al almacén virtual TRÁNSITO; cualquier diferencia al recibir abre una incidencia.',
  AJU: 'Correcciones de existencia con motivo y evidencia. Arriba del umbral requieren dos aprobaciones.',
};

const EXTRAS: Record<TipoDocumento, EstadoDocumento[]> = {
  ENT: ['RECHAZADA', 'CANCELADA'],
  SAL: ['RECHAZADA', 'CANCELADA', 'VENCIDA'],
  TRF: ['CON_DISCREPANCIA', 'RECHAZADA', 'CANCELADA'],
  AJU: ['RECHAZADA', 'CANCELADA'],
};

export function ListaDocumentosPage({ tipo }: { tipo: TipoDocumento }) {
  const usuario = useUsuario();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const qDiferida = useDeferredValue(q);
  const estado = params.get('estado') ?? '';
  const almacen = params.get('almacen') ?? '';
  const mios = params.get('mios') === '1';
  const pagina = Math.max(1, Number(params.get('pagina') ?? 1) || 1);

  const { datos, error, cargando, recargar } = useConsulta(
    () => api.documentos.listar({ tipo, estado, almacen, q: qDiferida, pagina, mios }),
    [tipo, estado, almacen, qDiferida, pagina, mios],
  );

  const fijar = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'pagina') n.delete('pagina');
    setParams(n, { replace: true });
  };

  const info = TIPO_DOC[tipo];
  const estados = [...PASOS[tipo], ...EXTRAS[tipo]];

  return (
    <>
      <Cabecera
        titulo={info.plural}
        descripcion={DESCRIPCION[tipo]}
        acciones={
          puede(usuario, PERMISO_CREAR[tipo]) && (
            <Link to={`${info.ruta}/nueva`} className="btn btn--primario">
              <Plus size={16} aria-hidden /> {TEXTO_NUEVO[tipo]}
            </Link>
          )
        }
      />
      <section className="panel">
        <div className="filtros" role="search">
          <Campo etiqueta="Buscar" className="campo--busqueda">
            {(p) => (
              <div className="busqueda">
                <Search aria-hidden />
                <input {...p} type="search" className="entrada" placeholder="Folio o SKU" maxLength={40} value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            )}
          </Campo>
          <Campo etiqueta="Estado">
            {(p) => (
              <select {...p} className="entrada" value={estado} onChange={(e) => fijar('estado', e.target.value)}>
                <option value="">Todos</option>
                {estados.map((e) => (
                  <option key={e} value={e}>
                    {ESTADO_DOC[e].texto}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          {usuario.almacenes.length > 1 && (
            <Campo etiqueta="Almacén">
              {(p) => (
                <select {...p} className="entrada" value={almacen} onChange={(e) => fijar('almacen', e.target.value)}>
                  <option value="">Todos</option>
                  {usuario.almacenes.map((a) => (
                    <option key={a} value={a}>
                      {ALMACEN_NOMBRE[a]}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
          )}
          <label className="casilla" style={{ paddingBottom: 10 }}>
            <input type="checkbox" checked={mios} onChange={(e) => fijar('mios', e.target.checked ? '1' : '')} />
            Solo los que yo creé
          </label>
        </div>
        {error && <ErrorCarga error={error} reintentar={recargar} />}
        {cargando && !datos ? (
          <Cargando />
        ) : (
          <>
            <TablaDocumentos
              documentos={datos?.datos ?? []}
              vacio={
                <Vacio titulo={`No hay ${info.plural.toLowerCase()} con estos filtros`}>
                  {puede(usuario, PERMISO_CREAR[tipo]) ? `Usa "${TEXTO_NUEVO[tipo]}" para capturar el primero.` : 'Cambia los filtros para ver otros documentos.'}
                </Vacio>
              }
            />
            {datos && datos.total > datos.porPagina && <Paginacion pagina={datos.pagina} porPagina={datos.porPagina} total={datos.total} cambiar={(p) => fijar('pagina', String(p))} />}
          </>
        )}
      </section>
    </>
  );
}
