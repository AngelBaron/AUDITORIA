import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { api } from '@/api/cliente';
import { ApiError } from '@/api/http';
import type { AlmacenClave, ClaseAbc } from '@/api/types';
import { useUsuario } from '@/auth/AuthContext';
import { useAvisos } from '@/components/Avisos';
import { BandaError, Dialogo } from '@/components/Dialogo';
import { Boton, Cabecera, Campo, Cargando, ErrorCarga, Estado, Folio, Vacio } from '@/components/ui';
import { ESTADO_CONTEO } from '@/domain/estados';
import { ALMACEN_NOMBRE, fmtFechaHora, fmtPorcentaje } from '@/domain/formato';
import { almacenesConPermiso, puede } from '@/domain/permisos';
import { nuevaLlaveIdempotencia } from '@/domain/seguridad';
import { useConsulta } from '@/hooks/useConsulta';

export function ConteosPage() {
  const usuario = useUsuario();
  const navegar = useNavigate();
  const { avisar } = useAvisos();
  const { datos, error, cargando, recargar } = useConsulta(() => api.conteos.listar(), []);
  const [abierto, setAbierto] = useState(false);
  const almacenes = almacenesConPermiso(usuario, 'conteo.programar');
  const [almacen, setAlmacen] = useState<AlmacenClave | ''>(almacenes[0] ?? '');
  const [tipo, setTipo] = useState<'CICLICO' | 'GENERAL'>('CICLICO');
  const [clase, setClase] = useState<ClaseAbc>('A');
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [llave, setLlave] = useState(nuevaLlaveIdempotencia);

  const programar = async () => {
    if (!almacen) return;
    setEnviando(true);
    setErr(null);
    try {
      const c = await api.conteos.programar({ almacen, tipo, clase: tipo === 'CICLICO' ? clase : null }, llave);
      setLlave(nuevaLlaveIdempotencia());
      avisar('exito', `Conteo ${c.folio} programado con ${c.renglones.length} productos.`);
      navegar(`/conteos/${c.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'X', 'No se pudo programar.'));
      setLlave(nuevaLlaveIdempotencia());
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <Cabecera
        titulo="Conteos físicos"
        descripcion="Conteos cíclicos por clase ABC y conteos generales. Quien cuenta no ve la existencia del sistema; si la diferencia supera la tolerancia, otra persona vuelve a contar."
        acciones={
          puede(usuario, 'conteo.programar') && (
            <Boton variante="primario" icono={<Plus aria-hidden />} onClick={() => setAbierto(true)}>
              Programar conteo
            </Boton>
          )
        }
      />
      <section className="panel">
        {error && <ErrorCarga error={error} reintentar={recargar} />}
        {cargando && !datos ? (
          <Cargando />
        ) : !datos?.length ? (
          <Vacio titulo="No hay conteos todavía">Programa un conteo cíclico de la clase A para empezar por los productos de mayor valor.</Vacio>
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Folio</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Almacén</th>
                  <th scope="col">Alcance</th>
                  <th scope="col" className="num">Productos</th>
                  <th scope="col" className="num">IRA</th>
                  <th scope="col">Programó</th>
                </tr>
              </thead>
              <tbody>
                {datos.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Folio folio={c.folio} a={`/conteos/${c.id}`} />
                    </td>
                    <td>
                      <div className="fila" style={{ gap: 6 }}>
                        <Estado tono={ESTADO_CONTEO[c.estado].tono}>{ESTADO_CONTEO[c.estado].texto}</Estado>
                        {c.accionesPermitidas.some((a) => a !== 'cancelar') && <Estado tono="senal">Te toca</Estado>}
                      </div>
                    </td>
                    <td>
                      <span className="etiqueta">{c.almacen}</span>
                    </td>
                    <td>{c.tipo === 'GENERAL' ? 'General' : `Cíclico, clase ${c.clase}`}</td>
                    <td className="num">{c.renglones.length}</td>
                    <td className="num">{fmtPorcentaje(c.ira)}</td>
                    <td>
                      {c.programadoPor.usuario.nombre}
                      <span className="tabla__secundario">{fmtFechaHora(c.programadoPor.fecha)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialogo
        abierto={abierto}
        titulo="Programar conteo"
        alCerrar={() => setAbierto(false)}
        alEnviar={() => void programar()}
        pie={
          <>
            <Boton onClick={() => setAbierto(false)}>Volver</Boton>
            <Boton type="submit" variante="primario" cargando={enviando} disabled={!almacen}>
              Programar
            </Boton>
          </>
        }
      >
        <p className="suave">Se incluyen los productos con existencia en el almacén. Al iniciar el conteo se congela la existencia del sistema y esos productos dejan de aceptar movimientos hasta cerrar.</p>
        <Campo etiqueta="Almacén" requerido>
          {(p) => (
            <select {...p} className="entrada" value={almacen} onChange={(e) => setAlmacen(e.target.value as AlmacenClave)}>
              {almacenes.map((a) => (
                <option key={a} value={a}>
                  {ALMACEN_NOMBRE[a]}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <fieldset className="pila pila--estrecha" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="campo__etiqueta">Tipo de conteo</legend>
          <label className="casilla">
            <input type="radio" name="tipo" checked={tipo === 'CICLICO'} onChange={() => setTipo('CICLICO')} /> Cíclico por clase ABC
          </label>
          <label className="casilla">
            <input type="radio" name="tipo" checked={tipo === 'GENERAL'} onChange={() => setTipo('GENERAL')} /> General (todo el almacén)
          </label>
        </fieldset>
        {tipo === 'CICLICO' && (
          <Campo etiqueta="Clase" ayuda="A: alto valor, conteo mensual. B: trimestral. C: semestral.">
            {(p) => (
              <select {...p} className="entrada" value={clase} onChange={(e) => setClase(e.target.value as ClaseAbc)}>
                <option value="A">Clase A</option>
                <option value="B">Clase B</option>
                <option value="C">Clase C</option>
              </select>
            )}
          </Campo>
        )}
        {err && <BandaError error={err} />}
      </Dialogo>
    </>
  );
}
