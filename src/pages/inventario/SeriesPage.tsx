import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { ScanLine } from 'lucide-react';
import { api } from '@/api/cliente';
import { Boton, Cabecera, Campo, Cargando, ErrorCarga, Folio, Vacio } from '@/components/ui';
import { ALMACEN_NOMBRE, fmtFechaHora } from '@/domain/formato';
import { rutaPorFolio } from '@/domain/rutas';
import { useConsulta } from '@/hooks/useConsulta';

export function SeriesPage() {
  const [params, setParams] = useSearchParams();
  const numero = params.get('n') ?? '';
  const [texto, setTexto] = useState(numero);
  const r = useConsulta(() => api.inventario.serie(numero), [numero], { activo: !!numero });

  const buscar = (e: FormEvent) => {
    e.preventDefault();
    const limpio = texto.trim().toUpperCase().slice(0, 40);
    if (limpio) setParams({ n: limpio });
  };

  const ubicacion = r.datos?.ubicacion;
  const textoUbicacion =
    ubicacion === 'TRANSITO' ? 'En tránsito entre almacenes' : ubicacion === 'ENTREGADO' ? 'Entregado al solicitante' : ubicacion === 'BAJA' ? 'Dado de baja (merma o ajuste)' : ubicacion ? `En ${ALMACEN_NOMBRE[ubicacion]}` : '';

  return (
    <>
      <Cabecera titulo="Rastrear número de serie" migas={[{ texto: 'Existencias', a: '/existencias' }]} descripcion="Dónde está hoy una pieza y todo su recorrido, documento por documento." />
      <section className="panel">
        <form className="filtros" onSubmit={buscar} role="search">
          <Campo etiqueta="Número de serie" className="campo--busqueda" ayuda="Puedes escanearlo con el lector de código de barras.">
            {(p) => <input {...p} className="entrada codigo" autoComplete="off" spellCheck={false} maxLength={40} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="SSD-NV1T-00012" />}
          </Campo>
          <Boton type="submit" variante="primario" icono={<ScanLine aria-hidden />}>
            Rastrear
          </Boton>
        </form>
        {!numero ? (
          <Vacio titulo="Escribe o escanea una serie">Por ejemplo SSD-NV1T-00012, CPU-R7-7700-00003 o LAP-14-R5-00001.</Vacio>
        ) : r.error ? (
          <ErrorCarga error={r.error} />
        ) : r.cargando || !r.datos ? (
          <Cargando />
        ) : (
          <div className="panel__cuerpo dos-columnas">
            <div>
              <h2 className="panel__titulo" style={{ marginBottom: 12 }}>
                Recorrido
              </h2>
              <ol className="linea-tiempo">
                {r.datos.recorrido.map((p, i) => (
                  <li key={`${p.folio}-${i}`}>
                    <span className="linea-tiempo__accion">
                      {p.desde} → {p.hacia}
                    </span>{' '}
                    <Folio folio={p.folio} a={rutaPorFolio(p.folio, p.documentoId)} />
                    <span className="linea-tiempo__meta">
                      {fmtFechaHora(p.fecha)} por {p.usuario}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <dl className="lista-datos panel" style={{ padding: 20 }}>
              <dt>Serie</dt>
              <dd className="codigo">{r.datos.numero}</dd>
              <dt>Producto</dt>
              <dd>
                {r.datos.producto.sku}
                <br />
                <span className="suave">{r.datos.producto.descripcion}</span>
              </dd>
              <dt>Ubicación actual</dt>
              <dd>
                <strong>{textoUbicacion}</strong>
              </dd>
            </dl>
          </div>
        )}
      </section>
    </>
  );
}
