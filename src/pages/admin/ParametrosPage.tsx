import { useState } from 'react';
import { api } from '@/api/cliente';
import type { Parametro } from '@/api/types';
import { useUsuario } from '@/auth/AuthContext';
import { useAvisos } from '@/components/Avisos';
import { DialogoConfirmacion } from '@/components/Dialogo';
import { Boton, Cabecera, Campo, Cargando, ErrorCarga, Estado } from '@/components/ui';
import { fmtFechaHora, fmtMoneda, fmtNumero } from '@/domain/formato';
import { puede } from '@/domain/permisos';
import { useConsulta } from '@/hooks/useConsulta';

const fmtValor = (p: Pick<Parametro, 'unidad'>, v: number) => (p.unidad === 'MXN' ? fmtMoneda(v) : `${fmtNumero(v)} ${p.unidad}`);

export function ParametrosPage() {
  const usuario = useUsuario();
  const { avisar } = useAvisos();
  const proponer = puede(usuario, 'parametros.proponer');
  const aprobar = puede(usuario, 'parametros.aprobar');
  const { datos, error, cargando, recargar } = useConsulta(() => api.parametros.listar(), []);
  const [edicion, setEdicion] = useState<Parametro | null>(null);
  const [valor, setValor] = useState('');
  const [resolucion, setResolucion] = useState<{ p: Parametro; aprobar: boolean } | null>(null);

  return (
    <>
      <Cabecera
        titulo="Parámetros de control"
        descripcion="Umbrales que deciden quién aprueba y cuándo se alerta. Un cambio lo propone el administrador, lo aprueba Seguridad y se notifica a Gerencia y Auditoría."
      />
      <section className="panel">
        {error && <ErrorCarga error={error} reintentar={recargar} />}
        {cargando && !datos ? (
          <Cargando />
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Parámetro</th>
                  <th scope="col" className="num">Valor vigente</th>
                  <th scope="col">Último cambio</th>
                  <th scope="col">Cambio pendiente</th>
                  <th scope="col" className="acciones"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {(datos ?? []).map((p) => (
                  <tr key={p.clave}>
                    <td>
                      <strong>{p.nombre}</strong>
                      <span className="tabla__secundario">{p.descripcion}</span>
                    </td>
                    <td className="num">
                      <strong>{fmtValor(p, p.valor)}</strong>
                    </td>
                    <td>{p.modificadoEn ? `${p.modificadoPor}, ${fmtFechaHora(p.modificadoEn)}` : <span className="suave">Valor inicial</span>}</td>
                    <td>
                      {p.solicitudPendiente ? (
                        <>
                          <Estado tono="alerta">→ {fmtValor(p, p.solicitudPendiente.valorPropuesto)}</Estado>
                          <span className="tabla__secundario">
                            {p.solicitudPendiente.solicitadoPor}: {p.solicitudPendiente.motivo}
                          </span>
                        </>
                      ) : (
                        <span className="suave">—</span>
                      )}
                    </td>
                    <td className="acciones">
                      {proponer && !p.solicitudPendiente && (
                        <Boton
                          tamano="sm"
                          onClick={() => {
                            setEdicion(p);
                            setValor(String(p.valor));
                          }}
                        >
                          Proponer cambio
                        </Boton>
                      )}
                      {aprobar && p.solicitudPendiente && (
                        <div className="fila" style={{ justifyContent: 'flex-end', gap: 4 }}>
                          <Boton tamano="sm" variante="primario" onClick={() => setResolucion({ p, aprobar: true })}>
                            Aprobar
                          </Boton>
                          <Boton tamano="sm" onClick={() => setResolucion({ p, aprobar: false })}>
                            Rechazar
                          </Boton>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <DialogoConfirmacion
        abierto={!!edicion}
        titulo={`Proponer cambio: ${edicion?.nombre ?? ''}`}
        descripcion={`Valor vigente: ${edicion ? fmtValor(edicion, edicion.valor) : ''}. El cambio no aplica hasta que Seguridad lo apruebe.`}
        textoConfirmar="Enviar propuesta"
        motivoMinimo={20}
        etiquetaMotivo="Justificación"
        pedirPassword
        alCerrar={() => setEdicion(null)}
        alConfirmar={async (v) => {
          await api.parametros.proponer(edicion!.clave, Number(valor), v.motivo, v.password);
          avisar('exito', 'Propuesta enviada a Seguridad de la información.');
          setEdicion(null);
          void recargar();
        }}
      >
        <Campo etiqueta={`Nuevo valor (${edicion?.unidad ?? ''})`} requerido>
          {(p) => <input {...p} className="entrada entrada--num" inputMode="decimal" style={{ maxWidth: 200 }} value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.]/g, ''))} />}
        </Campo>
      </DialogoConfirmacion>
      <DialogoConfirmacion
        abierto={!!resolucion}
        titulo={resolucion ? `${resolucion.aprobar ? 'Aprobar' : 'Rechazar'} cambio de ${resolucion.p.nombre}` : ''}
        descripcion={
          resolucion?.aprobar
            ? `El valor pasará de ${fmtValor(resolucion.p, resolucion.p.valor)} a ${fmtValor(resolucion.p, resolucion.p.solicitudPendiente!.valorPropuesto)} de inmediato. Se notificará a Gerencia y Auditoría.`
            : 'La propuesta se descarta y el valor vigente no cambia.'
        }
        textoConfirmar={resolucion?.aprobar ? 'Aprobar cambio' : 'Rechazar'}
        pedirPassword
        alCerrar={() => setResolucion(null)}
        alConfirmar={async (v) => {
          await api.parametros.resolver(resolucion!.p.clave, resolucion!.aprobar, v.password);
          avisar('exito', resolucion!.aprobar ? 'Cambio aplicado.' : 'Propuesta rechazada.');
          setResolucion(null);
          void recargar();
        }}
      />
    </>
  );
}
