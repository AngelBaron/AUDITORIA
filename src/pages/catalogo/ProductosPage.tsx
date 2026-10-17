import { useDeferredValue, useEffect, useState } from 'react';
import { History, Pencil, Plus, Search } from 'lucide-react';
import { api, type DatosProducto } from '@/api/cliente';
import { ApiError } from '@/api/http';
import type { ClaseAbc, Producto, UnidadMedida } from '@/api/types';
import { useUsuario } from '@/auth/AuthContext';
import { useAvisos } from '@/components/Avisos';
import { BandaError, Dialogo } from '@/components/Dialogo';
import { Boton, Cabecera, Campo, Cargando, ErrorCarga, Estado, Vacio } from '@/components/ui';
import { fmtFechaHora, fmtMoneda } from '@/domain/formato';
import { puede } from '@/domain/permisos';
import { useConsulta } from '@/hooks/useConsulta';

const VACIO: DatosProducto = { sku: '', descripcion: '', categoria: '', unidad: 'PZA', costoEstandar: 0, stockMinimo: 0, stockMaximo: 0, puntoReorden: 0, claseAbc: 'C', serializado: false, sensible: false };

export function ProductosPage() {
  const usuario = useUsuario();
  const editar = puede(usuario, 'catalogo.editar');
  const [q, setQ] = useState('');
  const [inactivos, setInactivos] = useState(false);
  const qd = useDeferredValue(q);
  const { datos, error, cargando, recargar } = useConsulta(() => api.productos.listar(qd, inactivos), [qd, inactivos]);
  const [formulario, setFormulario] = useState<Producto | 'nuevo' | null>(null);
  const [historial, setHistorial] = useState<Producto | null>(null);

  return (
    <>
      <Cabecera
        titulo="Productos"
        descripcion="Catálogo de componentes e insumos. Los productos no se borran: se desactivan y conservan su historial. Todo cambio de costo exige motivo."
        acciones={
          editar && (
            <Boton variante="primario" icono={<Plus aria-hidden />} onClick={() => setFormulario('nuevo')}>
              Agregar producto
            </Boton>
          )
        }
      />
      <section className="panel">
        <div className="filtros" role="search">
          <Campo etiqueta="Buscar" className="campo--busqueda">
            {(p) => (
              <div className="busqueda">
                <Search aria-hidden />
                <input {...p} type="search" className="entrada" placeholder="SKU, descripción o categoría" maxLength={60} value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            )}
          </Campo>
          <label className="casilla" style={{ paddingBottom: 10 }}>
            <input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} />
            Incluir inactivos
          </label>
        </div>
        {error && <ErrorCarga error={error} reintentar={recargar} />}
        {cargando && !datos ? (
          <Cargando />
        ) : !datos?.length ? (
          <Vacio titulo="Sin productos con esa búsqueda" />
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col">Categoría</th>
                  <th scope="col">Clase</th>
                  <th scope="col">Control</th>
                  <th scope="col" className="num">Costo estándar</th>
                  <th scope="col" className="num">Costo promedio</th>
                  <th scope="col" className="num">Mín / reorden / máx</th>
                  <th scope="col" className="acciones"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {datos.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="codigo">{p.sku}</span>
                      <span className="tabla__secundario">{p.descripcion}</span>
                    </td>
                    <td>{p.categoria}</td>
                    <td>
                      <span className="etiqueta">{p.claseAbc}</span>
                    </td>
                    <td>
                      <div className="fila" style={{ gap: 4 }}>
                        {!p.activo && <Estado tono="neutro">Inactivo</Estado>}
                        {p.serializado && <span className="etiqueta">Por serie</span>}
                        {p.sensible && <Estado tono="alerta">Sensible</Estado>}
                      </div>
                    </td>
                    <td className="num">{fmtMoneda(p.costoEstandar)}</td>
                    <td className="num">{fmtMoneda(p.costoPromedio)}</td>
                    <td className="num">
                      {p.stockMinimo} / {p.puntoReorden} / {p.stockMaximo} {p.unidad}
                    </td>
                    <td className="acciones">
                      <Boton tamano="sm" variante="fantasma" icono={<History aria-hidden />} onClick={() => setHistorial(p)} aria-label={`Historial de costo de ${p.sku}`}>
                        Costos
                      </Boton>
                      {editar && (
                        <Boton tamano="sm" variante="fantasma" icono={<Pencil aria-hidden />} onClick={() => setFormulario(p)} aria-label={`Editar ${p.sku}`}>
                          Editar
                        </Boton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <FormularioProducto producto={formulario} alCerrar={() => setFormulario(null)} alGuardar={() => { setFormulario(null); void recargar(); }} />
      <HistorialCosto producto={historial} alCerrar={() => setHistorial(null)} />
    </>
  );
}

function FormularioProducto({ producto, alCerrar, alGuardar }: { producto: Producto | 'nuevo' | null; alCerrar: () => void; alGuardar: () => void }) {
  const { avisar } = useAvisos();
  const [d, setD] = useState<DatosProducto & { activo: boolean }>({ ...VACIO, activo: true });
  const [motivoCosto, setMotivoCosto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const nuevo = producto === 'nuevo';
  const original = producto && producto !== 'nuevo' ? producto : null;

  useEffect(() => {
    setError(null);
    setMotivoCosto('');
    if (original) {
      setD({
        sku: original.sku,
        descripcion: original.descripcion,
        categoria: original.categoria,
        unidad: original.unidad,
        costoEstandar: original.costoEstandar,
        stockMinimo: original.stockMinimo,
        stockMaximo: original.stockMaximo,
        puntoReorden: original.puntoReorden,
        claseAbc: original.claseAbc,
        serializado: original.serializado,
        sensible: original.sensible,
        activo: original.activo,
      });
    } else setD({ ...VACIO, activo: true });
  }, [producto, original]);

  const cambiaCosto = !!original && Number(d.costoEstandar) !== original.costoEstandar;
  const errCampo = error?.erroresPorCampo() ?? {};
  const num = (k: keyof DatosProducto) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: Number(e.target.value) });

  const guardar = async () => {
    setEnviando(true);
    setError(null);
    try {
      if (original) await api.productos.actualizar(original.id, { ...d, version: original.version, motivoCambioCosto: cambiaCosto ? motivoCosto : undefined });
      else await api.productos.crear(d);
      avisar('exito', `Producto ${d.sku || original?.sku} guardado.`);
      alGuardar();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialogo
      abierto={producto !== null}
      ancho
      titulo={nuevo ? 'Agregar producto' : `Editar ${original?.sku}`}
      alCerrar={alCerrar}
      alEnviar={() => void guardar()}
      pie={
        <>
          <Boton onClick={alCerrar}>Volver</Boton>
          <Boton type="submit" variante="primario" cargando={enviando}>
            Guardar producto
          </Boton>
        </>
      }
    >
      {error && <BandaError error={error} />}
      <div className="rejilla-form">
        <Campo etiqueta="SKU" requerido error={errCampo.sku} ayuda={nuevo ? 'Mayúsculas, números y guiones. No se puede cambiar después.' : undefined}>
          {(p) => <input {...p} className="entrada codigo" maxLength={20} disabled={!nuevo} value={d.sku} onChange={(e) => setD({ ...d, sku: e.target.value.toUpperCase() })} />}
        </Campo>
        <Campo etiqueta="Categoría" requerido error={errCampo.categoria}>
          {(p) => <input {...p} className="entrada" maxLength={40} value={d.categoria} onChange={(e) => setD({ ...d, categoria: e.target.value })} />}
        </Campo>
        <Campo etiqueta="Descripción" requerido className="rejilla-form__ancho" error={errCampo.descripcion}>
          {(p) => <input {...p} className="entrada" maxLength={120} value={d.descripcion} onChange={(e) => setD({ ...d, descripcion: e.target.value })} />}
        </Campo>
        <Campo etiqueta="Unidad">
          {(p) => (
            <select {...p} className="entrada" value={d.unidad} onChange={(e) => setD({ ...d, unidad: e.target.value as UnidadMedida })}>
              <option value="PZA">Pieza</option>
              <option value="CAJA">Caja</option>
              <option value="M">Metro</option>
              <option value="KIT">Kit</option>
            </select>
          )}
        </Campo>
        <Campo etiqueta="Clase ABC">
          {(p) => (
            <select {...p} className="entrada" value={d.claseAbc} onChange={(e) => setD({ ...d, claseAbc: e.target.value as ClaseAbc })}>
              <option value="A">A (alto valor)</option>
              <option value="B">B</option>
              <option value="C">C</option>
            </select>
          )}
        </Campo>
        <Campo etiqueta="Costo estándar (MXN)" requerido error={errCampo.costoEstandar}>
          {(p) => <input {...p} className="entrada entrada--num" type="number" min={0} step="0.01" value={d.costoEstandar} onChange={num('costoEstandar')} />}
        </Campo>
        <Campo etiqueta="Stock mínimo" error={errCampo.stockMinimo}>
          {(p) => <input {...p} className="entrada entrada--num" type="number" min={0} value={d.stockMinimo} onChange={num('stockMinimo')} />}
        </Campo>
        <Campo etiqueta="Punto de reorden" error={errCampo.puntoReorden}>
          {(p) => <input {...p} className="entrada entrada--num" type="number" min={0} value={d.puntoReorden} onChange={num('puntoReorden')} />}
        </Campo>
        <Campo etiqueta="Stock máximo" error={errCampo.stockMaximo}>
          {(p) => <input {...p} className="entrada entrada--num" type="number" min={0} value={d.stockMaximo} onChange={num('stockMaximo')} />}
        </Campo>
        {cambiaCosto && (
          <Campo etiqueta="Motivo del cambio de costo" requerido className="rejilla-form__ancho" error={errCampo.motivoCambioCosto} ayuda="Queda en el historial de costos con tu usuario y la fecha.">
            {(p) => <textarea {...p} className="entrada" maxLength={300} value={motivoCosto} onChange={(e) => setMotivoCosto(e.target.value)} />}
          </Campo>
        )}
        <div className="rejilla-form__ancho pila pila--estrecha">
          <label className="casilla">
            <input type="checkbox" checked={d.serializado} onChange={(e) => setD({ ...d, serializado: e.target.checked })} /> Se controla por número de serie
          </label>
          <label className="casilla">
            <input type="checkbox" checked={d.sensible} onChange={(e) => setD({ ...d, sensible: e.target.checked })} /> Producto sensible (alto valor y fácil reventa: conteo semanal)
          </label>
          {!nuevo && (
            <label className="casilla">
              <input type="checkbox" checked={!d.activo} onChange={(e) => setD({ ...d, activo: !e.target.checked })} /> Desactivar (solo si no tiene existencia)
            </label>
          )}
        </div>
      </div>
    </Dialogo>
  );
}

function HistorialCosto({ producto, alCerrar }: { producto: Producto | null; alCerrar: () => void }) {
  const h = useConsulta(() => api.productos.historialCosto(producto!.id), [producto?.id], { activo: !!producto });
  return (
    <Dialogo abierto={!!producto} titulo={`Historial de costo de ${producto?.sku ?? ''}`} alCerrar={alCerrar} pie={<Boton onClick={alCerrar}>Cerrar</Boton>}>
      {h.cargando ? (
        <Cargando filas={3} />
      ) : (
        <ol className="linea-tiempo">
          {(h.datos ?? []).map((c, i) => (
            <li key={i}>
              <span className="linea-tiempo__accion">
                {fmtMoneda(c.anterior)} → {fmtMoneda(c.nuevo)}
              </span>
              <span className="linea-tiempo__meta">{c.motivo}</span>
              <span className="linea-tiempo__meta">
                {fmtFechaHora(c.fecha)}, {c.usuario}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Dialogo>
  );
}
