import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { History, ScanLine, Search } from 'lucide-react';
import { api } from '@/api/cliente';
import type { AlmacenClave } from '@/api/types';
import { useUsuario } from '@/auth/AuthContext';
import { BotonExportarCsv } from '@/components/Exportar';
import { Cabecera, Campo, Cargando, ErrorCarga, Estado, Vacio } from '@/components/ui';
import { ALMACEN_NOMBRE, fmtMoneda, fmtNumero } from '@/domain/formato';
import { useConsulta } from '@/hooks/useConsulta';

export function ExistenciasPage() {
  const usuario = useUsuario();
  const [almacen, setAlmacen] = useState<AlmacenClave | ''>(usuario.almacenes.length === 1 ? usuario.almacenes[0]! : '');
  const [q, setQ] = useState('');
  const [bajoReorden, setBajoReorden] = useState(false);
  const qDiferida = useDeferredValue(q);
  const { datos, error, cargando, recargar } = useConsulta(() => api.inventario.existencias({ almacen, q: qDiferida, bajoReorden }), [almacen, qDiferida, bajoReorden]);
  const filas = datos ?? [];
  const total = filas.reduce((s, f) => s + f.valor, 0);

  return (
    <>
      <Cabecera
        titulo="Existencias"
        descripcion="Disponible = física menos lo apartado por salidas o transferencias aprobadas. En camino son transferencias enviadas hacia ese almacén."
        acciones={
          <>
            <Link to="/existencias/series" className="btn btn--secundario">
              <ScanLine size={16} aria-hidden /> Rastrear número de serie
            </Link>
            <BotonExportarCsv
              reporte="existencias"
              nombreArchivo="existencias"
              encabezados={['Almacén', 'SKU', 'Descripción', 'Unidad', 'Física', 'Reservada', 'Disponible', 'En camino', 'Costo promedio', 'Valor']}
              filas={filas.map((f) => [f.almacen, f.producto.sku, f.producto.descripcion, f.producto.unidad, f.fisica, f.reservada, f.disponible, f.enTransitoEntrante, f.costoPromedio, f.valor])}
            />
          </>
        }
      />
      <section className="panel">
        <div className="filtros" role="search">
          <Campo etiqueta="Almacén">
            {(p) => (
              <select {...p} className="entrada" value={almacen} onChange={(e) => setAlmacen(e.target.value as AlmacenClave | '')}>
                {usuario.almacenes.length > 1 && <option value="">Todos mis almacenes</option>}
                {usuario.almacenes.map((a) => (
                  <option key={a} value={a}>
                    {a} · {ALMACEN_NOMBRE[a]}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo etiqueta="Buscar producto" className="campo--busqueda">
            {(p) => (
              <div className="busqueda">
                <Search aria-hidden />
                <input {...p} className="entrada" type="search" placeholder="SKU o descripción" maxLength={60} value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            )}
          </Campo>
          <label className="casilla" style={{ paddingBottom: 10 }}>
            <input type="checkbox" checked={bajoReorden} onChange={(e) => setBajoReorden(e.target.checked)} />
            Solo bajo punto de reorden
          </label>
        </div>
        {error && <ErrorCarga error={error} reintentar={recargar} />}
        {cargando && !datos ? (
          <Cargando />
        ) : filas.length === 0 ? (
          <Vacio titulo="Sin resultados">Prueba con otro almacén o con otra búsqueda.</Vacio>
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col">Almacén</th>
                  <th scope="col" className="num">Física</th>
                  <th scope="col" className="num">Reservada</th>
                  <th scope="col" className="num">Disponible</th>
                  <th scope="col" className="num">En camino</th>
                  <th scope="col" className="num">Valor</th>
                  <th scope="col">Avisos</th>
                  <th scope="col" className="acciones">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={`${f.almacen}-${f.producto.id}`} className={f.bajoReorden ? 'fila-destacada' : undefined}>
                    <td>
                      <span className="codigo">{f.producto.sku}</span>
                      <span className="tabla__secundario">{f.producto.descripcion}</span>
                    </td>
                    <td>
                      <span className="etiqueta">{f.almacen}</span>
                    </td>
                    <td className="num">
                      {fmtNumero(f.fisica)} <span className="suave">{f.producto.unidad}</span>
                    </td>
                    <td className="num">{fmtNumero(f.reservada)}</td>
                    <td className="num">
                      <strong>{fmtNumero(f.disponible)}</strong>
                    </td>
                    <td className="num">{f.enTransitoEntrante ? fmtNumero(f.enTransitoEntrante) : '—'}</td>
                    <td className="num">{fmtMoneda(f.valor)}</td>
                    <td>
                      <div className="fila" style={{ gap: 4 }}>
                        {f.bajoReorden && <Estado tono="alerta">Bajo reorden</Estado>}
                        {f.bloqueadaPorConteo && <Estado tono="ruta">En conteo</Estado>}
                        {f.producto.sensible && <Estado tono="neutro">Sensible</Estado>}
                        {f.producto.serializado && <span className="etiqueta">Por serie</span>}
                      </div>
                    </td>
                    <td className="acciones">
                      <Link className="btn btn--fantasma btn--sm" to={`/existencias/kardex?producto=${encodeURIComponent(f.producto.id)}&almacen=${f.almacen}`}>
                        <History size={15} aria-hidden /> Kardex
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>Total ({filas.length} renglones)</td>
                  <td className="num">{fmtMoneda(total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
