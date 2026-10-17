import { useState } from 'react';
import { EyeOff, Plus, Trash2 } from 'lucide-react';
import { api } from '@/api/cliente';
import { ApiError } from '@/api/http';
import type { AlmacenClave, Producto } from '@/api/types';
import { useUsuario } from '@/auth/AuthContext';
import { useAvisos } from '@/components/Avisos';
import { BandaError, Dialogo } from '@/components/Dialogo';
import { SelectorProducto } from '@/components/SelectorProducto';
import { Boton, Cabecera, Campo, Cargando, ErrorCarga, Estado, Folio, Vacio } from '@/components/ui';
import { ALMACEN_NOMBRE, fmtFechaHora, fmtMoneda, fmtNumero } from '@/domain/formato';
import { puede } from '@/domain/permisos';
import { nuevaLlaveIdempotencia } from '@/domain/seguridad';
import { useConsulta } from '@/hooks/useConsulta';

const ESTADO_OC = { ABIERTA: { t: 'Abierta', tono: 'ruta' }, PARCIAL: { t: 'Recibida parcial', tono: 'alerta' }, CERRADA: { t: 'Cerrada', tono: 'ok' }, CANCELADA: { t: 'Cancelada', tono: 'neutro' } } as const;

export function OrdenesCompraPage() {
  const usuario = useUsuario();
  const crear = puede(usuario, 'oc.crear');
  // Recepción ciega (RF-ENT-02): quien solo recibe no ve las cantidades pedidas
  const veCantidades = crear || puede(usuario, 'recepcion.aprobar') || puede(usuario, 'valuacion.ver');
  const { datos, error, cargando, recargar } = useConsulta(() => api.ordenesCompra.listar(), []);
  const [nueva, setNueva] = useState(false);

  return (
    <>
      <Cabecera
        titulo="Órdenes de compra"
        descripcion="Lo que Compras pidió a proveedores. Quien registra una orden no puede recibir esa mercancía."
        acciones={
          crear && (
            <Boton variante="primario" icono={<Plus aria-hidden />} onClick={() => setNueva(true)}>
              Nueva orden de compra
            </Boton>
          )
        }
      />
      {!veCantidades && (
        <div className="banda banda--info" style={{ marginBottom: 20 }}>
          <EyeOff aria-hidden />
          <div>
            <strong>Cantidades ocultas</strong>
            Recibes mercancía, así que no ves lo pedido: la recepción es ciega para que la comparación contra la orden sea independiente.
          </div>
        </div>
      )}
      <section className="panel">
        {error && <ErrorCarga error={error} reintentar={recargar} />}
        {cargando && !datos ? (
          <Cargando />
        ) : !datos?.length ? (
          <Vacio titulo="No hay órdenes de compra" />
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Folio</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Proveedor</th>
                  <th scope="col">Destino</th>
                  <th scope="col">Productos</th>
                  {veCantidades && <th scope="col" className="num">Total</th>}
                  <th scope="col">Registró</th>
                </tr>
              </thead>
              <tbody>
                {datos.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Folio folio={o.folio} />
                    </td>
                    <td>
                      <Estado tono={ESTADO_OC[o.estado].tono}>{ESTADO_OC[o.estado].t}</Estado>
                    </td>
                    <td>
                      {o.proveedor.nombre}
                      <span className="tabla__secundario">RFC {o.proveedor.rfc}</span>
                    </td>
                    <td>
                      <span className="etiqueta">{o.almacenDestino}</span>
                    </td>
                    <td>
                      {o.renglones.map((r) => (
                        <span key={r.productoId} className="tabla__secundario">
                          {r.sku}
                          {veCantidades && `: ${fmtNumero(r.recibida)} de ${fmtNumero(r.cantidad)} recibidas`}
                        </span>
                      ))}
                    </td>
                    {veCantidades && <td className="num">{fmtMoneda(o.total)}</td>}
                    <td>
                      {o.creadoPor.usuario.nombre}
                      <span className="tabla__secundario">{fmtFechaHora(o.creadoPor.fecha)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <NuevaOrden abierto={nueva} alCerrar={() => setNueva(false)} alGuardar={() => { setNueva(false); void recargar(); }} />
    </>
  );
}

function NuevaOrden({ abierto, alCerrar, alGuardar }: { abierto: boolean; alCerrar: () => void; alGuardar: () => void }) {
  const { avisar } = useAvisos();
  const productos = useConsulta(() => api.productos.listar(), [], { activo: abierto });
  const proveedores = useConsulta(() => api.catalogos.proveedores(), [], { activo: abierto });
  const [proveedorId, setProveedorId] = useState('');
  const [almacen, setAlmacen] = useState<AlmacenClave>('CEN');
  const [lineas, setLineas] = useState<{ p: Producto; cantidad: string; costo: string }[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [llave, setLlave] = useState(nuevaLlaveIdempotencia);
  const valido = proveedorId && lineas.length > 0 && lineas.every((l) => Number(l.cantidad) > 0 && Number(l.costo) > 0);

  const guardar = async () => {
    if (!valido) return;
    setEnviando(true);
    setError(null);
    try {
      const oc = await api.ordenesCompra.crear({ proveedorId, almacenDestino: almacen, renglones: lineas.map((l) => ({ productoId: l.p.id, cantidad: Number(l.cantidad), costoUnitario: Number(l.costo) })) }, llave);
      setLlave(nuevaLlaveIdempotencia());
      setLineas([]);
      avisar('exito', `Orden ${oc.folio} registrada.`);
      alGuardar();
    } catch (e) {
      setLlave(nuevaLlaveIdempotencia());
      setError(e instanceof ApiError ? e : null);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialogo
      abierto={abierto}
      ancho
      titulo="Nueva orden de compra"
      alCerrar={alCerrar}
      alEnviar={() => void guardar()}
      pie={
        <>
          <Boton onClick={alCerrar}>Volver</Boton>
          <Boton type="submit" variante="primario" cargando={enviando} disabled={!valido}>
            Registrar orden
          </Boton>
        </>
      }
    >
      {error && <BandaError error={error} />}
      <div className="rejilla-form">
        <Campo etiqueta="Proveedor" requerido>
          {(p) => (
            <select {...p} className="entrada" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
              <option value="">Elige…</option>
              {(proveedores.datos ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nombre}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo etiqueta="Almacén destino" requerido>
          {(p) => (
            <select {...p} className="entrada" value={almacen} onChange={(e) => setAlmacen(e.target.value as AlmacenClave)}>
              {(['CEN', 'NTE', 'CTR', 'SUR'] as const).map((a) => (
                <option key={a} value={a}>
                  {ALMACEN_NOMBRE[a]}
                </option>
              ))}
            </select>
          )}
        </Campo>
      </div>
      <SelectorProducto productos={productos.datos ?? []} excluir={lineas.map((l) => l.p.id)} alElegir={(p) => setLineas((ls) => [...ls, { p, cantidad: '', costo: String(p.costoEstandar) }])} />
      {lineas.length > 0 && (
        <table className="tabla">
          <thead>
            <tr>
              <th scope="col">Producto</th>
              <th scope="col">Cantidad</th>
              <th scope="col">Costo unitario</th>
              <th scope="col"><span className="sr-only">Quitar</span></th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={l.p.id}>
                <td className="codigo">{l.p.sku}</td>
                <td>
                  <input className="entrada entrada--num" inputMode="decimal" aria-label={`Cantidad de ${l.p.sku}`} value={l.cantidad} onChange={(e) => setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, cantidad: e.target.value.replace(/[^\d.]/g, '') } : x)))} />
                </td>
                <td>
                  <input className="entrada entrada--num" inputMode="decimal" aria-label={`Costo de ${l.p.sku}`} value={l.costo} onChange={(e) => setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, costo: e.target.value.replace(/[^\d.]/g, '') } : x)))} />
                </td>
                <td>
                  <Boton tamano="sm" variante="fantasma" aria-label={`Quitar ${l.p.sku}`} icono={<Trash2 aria-hidden />} onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialogo>
  );
}
