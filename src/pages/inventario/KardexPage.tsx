import { useSearchParams } from 'react-router';
import { api } from '@/api/cliente';
import type { AlmacenClave } from '@/api/types';
import { useUsuario } from '@/auth/AuthContext';
import { BotonExportarCsv } from '@/components/Exportar';
import { Cabecera, Campo, Cargando, ErrorCarga, Folio, Vacio } from '@/components/ui';
import { ALMACEN_NOMBRE, fmtFechaHora, fmtMoneda, fmtNumero } from '@/domain/formato';
import { useConsulta } from '@/hooks/useConsulta';
import { rutaPorFolio } from '@/domain/rutas';

const TIPO_MOV: Record<string, string> = {
  ENTRADA: 'Entrada',
  SALIDA: 'Salida',
  TRANSF_SALIDA: 'Envío a tránsito',
  TRANSF_ENTRADA: 'Recepción de transferencia',
  TRANSITO_ENTRADA: 'Entra a tránsito',
  TRANSITO_SALIDA: 'Sale de tránsito',
  AJUSTE_POS: 'Ajuste positivo',
  AJUSTE_NEG: 'Ajuste negativo',
  MERMA: 'Merma',
};

export function KardexPage() {
  const usuario = useUsuario();
  const [params, setParams] = useSearchParams();
  const producto = params.get('producto') ?? '';
  const almacen = (params.get('almacen') ?? usuario.almacenes[0] ?? 'CEN') as AlmacenClave | 'TRANSITO';
  const productos = useConsulta(() => api.productos.listar(), []);
  const kardex = useConsulta(() => api.inventario.kardex(producto, almacen), [producto, almacen], { activo: !!producto });
  const p = productos.datos?.find((x) => x.id === producto);
  const cambiar = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    n.set(k, v);
    setParams(n, { replace: true });
  };

  return (
    <>
      <Cabecera
        titulo="Kardex"
        migas={[{ texto: 'Existencias', a: '/existencias' }]}
        descripcion="Cada entrada y salida con su documento, saldo resultante, costo y usuario. El saldo siempre se puede reconstruir sumando estos movimientos."
        acciones={
          kardex.datos && p ? (
            <BotonExportarCsv
              reporte="kardex"
              nombreArchivo={`kardex_${p.sku}_${almacen}`}
              encabezados={['Fecha', 'Folio', 'Tipo', 'Entrada', 'Salida', 'Saldo', 'Costo unitario', 'Usuario', 'Series']}
              filas={kardex.datos.map((m) => [m.fecha, m.folio, TIPO_MOV[m.tipo], m.entrada, m.salida, m.saldo, m.costoUnitario, m.usuario, m.series.join(' ')])}
            />
          ) : undefined
        }
      />
      <section className="panel">
        <div className="filtros">
          <Campo etiqueta="Producto" className="campo--busqueda">
            {(pp) => (
              <select {...pp} className="entrada" value={producto} onChange={(e) => cambiar('producto', e.target.value)}>
                <option value="">Elige un producto…</option>
                {(productos.datos ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.sku} · {x.descripcion}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo etiqueta="Almacén">
            {(pp) => (
              <select {...pp} className="entrada" value={almacen} onChange={(e) => cambiar('almacen', e.target.value)}>
                {usuario.almacenes.map((a) => (
                  <option key={a} value={a}>
                    {a} · {ALMACEN_NOMBRE[a]}
                  </option>
                ))}
                <option value="TRANSITO">Tránsito</option>
              </select>
            )}
          </Campo>
        </div>
        {!producto ? (
          <Vacio titulo="Elige un producto">Selecciona el producto y el almacén para ver su historial de movimientos.</Vacio>
        ) : kardex.error ? (
          <ErrorCarga error={kardex.error} reintentar={kardex.recargar} />
        ) : kardex.cargando && !kardex.datos ? (
          <Cargando />
        ) : !kardex.datos?.length ? (
          <Vacio titulo="Sin movimientos">Este producto no ha tenido movimientos en {almacen}.</Vacio>
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Documento</th>
                  <th scope="col">Movimiento</th>
                  <th scope="col" className="num">Entrada</th>
                  <th scope="col" className="num">Salida</th>
                  <th scope="col" className="num">Saldo</th>
                  <th scope="col" className="num">Costo unitario</th>
                  <th scope="col">Usuario</th>
                </tr>
              </thead>
              <tbody>
                {kardex.datos.map((m) => (
                  <tr key={m.id}>
                    <td>{fmtFechaHora(m.fecha)}</td>
                    <td>
                      <Folio folio={m.folio} a={rutaPorFolio(m.folio, m.documentoId)} />
                    </td>
                    <td>
                      {TIPO_MOV[m.tipo] ?? m.tipo}
                      {m.series.length > 0 && <span className="tabla__secundario">Series: {m.series.join(', ')}</span>}
                    </td>
                    <td className="num">{m.entrada ? fmtNumero(m.entrada) : ''}</td>
                    <td className="num">{m.salida ? fmtNumero(m.salida) : ''}</td>
                    <td className="num">
                      <strong>{fmtNumero(m.saldo)}</strong>
                    </td>
                    <td className="num">{fmtMoneda(m.costoUnitario)}</td>
                    <td>{m.usuario}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
