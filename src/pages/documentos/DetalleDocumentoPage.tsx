import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CircleAlert, Lock, Paperclip, ShieldCheck, Truck } from 'lucide-react';
import { api } from '@/api/cliente';
import { ApiError } from '@/api/http';
import type { AccionDocumento, CuerpoAccion, Documento, TipoDocumento, TipoResolucion } from '@/api/types';
import { useAvisos } from '@/components/Avisos';
import { DialogoConfirmacion } from '@/components/Dialogo';
import { Boton, Cabecera, Cargando, ErrorCarga, Estado, Folio } from '@/components/ui';
import { ACCION_DOC, ESTADO_DOC, ESTADOS_FINALES, PASOS, TIPO_DOC } from '@/domain/estados';
import { ALMACEN_NOMBRE, fmtFecha, fmtFechaHora, fmtMoneda, fmtNumero, fmtRelativo } from '@/domain/formato';
import { nuevaLlaveIdempotencia } from '@/domain/seguridad';
import { textoAccion } from '@/domain/bitacora';
import { useConsulta } from '@/hooks/useConsulta';
import { DialogoEnvio, DialogoRecepcionCiega, DialogoSurtido, SelectorResolucion, TIPOS_RESOLUCION } from './DialogosAccion';

const ORDEN_ACCIONES: AccionDocumento[] = ['aprobar', 'surtir', 'enviar', 'recibir', 'confirmar_entrega', 'confirmar_recepcion', 'resolver_incidencia', 'enviar_aprobacion', 'rechazar', 'cancelar'];

const TEXTO_TE_TOCA: Partial<Record<AccionDocumento, string>> = {
  aprobar: 'Revisa los renglones y aprueba o rechaza.',
  surtir: 'Prepara el material y registra lo que surtes, con sus series.',
  enviar: 'Registra transportista, sellos y las series que salen.',
  recibir: 'Cuenta lo que llegó y regístralo sin ver lo enviado.',
  confirmar_entrega: 'Confirma con tu contraseña que recibiste el material.',
  confirmar_recepcion: 'Revisa tu captura y confírmala.',
  resolver_incidencia: 'Decide qué pasó con la diferencia y cierra la transferencia.',
  enviar_aprobacion: 'El documento está en borrador. Envíalo a aprobación cuando esté listo.',
};

export function DetalleDocumentoPage({ tipo }: { tipo: TipoDocumento }) {
  const { id = '' } = useParams();
  const { avisar, avisarError } = useAvisos();
  const doc = useConsulta(() => api.documentos.obtener(id), [id]);
  const eventos = useConsulta(() => api.documentos.eventos(id), [id]);
  const [accion, setAccion] = useState<AccionDocumento | null>(null);
  const [llave, setLlave] = useState(nuevaLlaveIdempotencia);
  const [tipoResolucion, setTipoResolucion] = useState<TipoResolucion | ''>('');
  const [intentoResolucion, setIntentoResolucion] = useState(false);

  const d = doc.datos;

  const ejecutar = useCallback(
    async (a: AccionDocumento, cuerpo: Omit<CuerpoAccion, 'version'>) => {
      if (!d) return;
      try {
        const actualizado = await api.documentos.accion(d.id, a, { version: d.version, ...cuerpo }, llave);
        doc.establecer(actualizado);
        setLlave(nuevaLlaveIdempotencia());
        setAccion(null);
        avisar('exito', `${ACCION_DOC[a].hecho}: ${actualizado.folio}`);
        void eventos.recargar();
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) setLlave(nuevaLlaveIdempotencia());
        if (e instanceof ApiError && e.codigo === 'VERSION_CONFLICTO') {
          setAccion(null);
          avisarError(e);
          void doc.recargar();
          void eventos.recargar();
          return;
        }
        void eventos.recargar();
        throw e;
      }
    },
    [d, llave, doc, eventos, avisar, avisarError],
  );

  if (doc.error) {
    return (
      <>
        <Cabecera titulo={TIPO_DOC[tipo].singular} migas={[{ texto: TIPO_DOC[tipo].plural, a: TIPO_DOC[tipo].ruta }]} />
        <div className="panel">
          <ErrorCarga error={doc.error} reintentar={doc.error.status === 404 ? undefined : doc.recargar} />
        </div>
      </>
    );
  }
  if (!d) return <div className="panel"><Cargando /></div>;

  const est = ESTADO_DOC[d.estado];
  const acciones = ORDEN_ACCIONES.filter((a) => d.accionesPermitidas.includes(a));
  const principal = acciones.find((a) => a !== 'rechazar' && a !== 'cancelar');
  const nivelAlto = d.nivelAprobacion === 'GER' || (d.tipo === 'AJU' && d.estado === 'PENDIENTE_N2');
  const esTransferencia = d.tipo === 'TRF';
  const ocultoParaMi = esTransferencia && d.estado === 'EN_TRANSITO' && d.renglones.every((r) => r.cantidadEnviada === null);

  return (
    <>
      <Cabecera
        migas={[{ texto: TIPO_DOC[tipo].plural, a: TIPO_DOC[tipo].ruta }]}
        titulo={
          <span className="fila" style={{ gap: 14 }}>
            <Folio folio={d.folio} grande />
            <Estado tono={est.tono}>{est.texto}</Estado>
          </span>
        }
        descripcion={`${TIPO_DOC[d.tipo].singular} creada por ${d.creadoPor.usuario.nombre} el ${fmtFechaHora(d.creadoPor.fecha)}.`}
        acciones={acciones.map((a) => (
          <Boton key={a} variante={a === principal ? 'primario' : ACCION_DOC[a].peligro ? 'peligro' : 'secundario'} onClick={() => setAccion(a)}>
            {ACCION_DOC[a].texto}
          </Boton>
        ))}
      />

      <div className="pila" style={{ marginBottom: 20 }}>
        {principal && (
          <div className="banda banda--accion" role="status">
            <CircleAlert aria-hidden />
            <div>
              <strong>Te toca: {ACCION_DOC[principal].texto.toLowerCase()}</strong>
              {TEXTO_TE_TOCA[principal]}
              {d.venceEn && !ESTADOS_FINALES.includes(d.estado) && <span className="tabla__secundario">Vence {fmtRelativo(d.venceEn)} ({fmtFechaHora(d.venceEn)}).</span>}
            </div>
          </div>
        )}
        {d.bloqueos.map((b) => (
          <div key={b.accion + b.codigo} className="banda banda--bloqueo">
            <Lock aria-hidden />
            <div>
              <strong>No puedes {ACCION_DOC[b.accion].texto.toLowerCase()}</strong>
              {b.mensaje} {b.codigo.startsWith('RS-') && <span className="suave">({b.codigo})</span>}
            </div>
          </div>
        ))}
        {ocultoParaMi && (
          <div className="banda banda--info">
            <ShieldCheck aria-hidden />
            <div>
              <strong>Recepción ciega</strong>
              Las cantidades y series enviadas se muestran después de que registres lo recibido.
            </div>
          </div>
        )}
      </div>

      <section className="panel" aria-label="Avance del documento" style={{ marginBottom: 20 }}>
        {esTransferencia ? <RutaTransferencia doc={d} /> : <Pasos doc={d} />}
      </section>

      <div className="dos-columnas">
        <div className="pila">
          <section className="panel" aria-labelledby="t-renglones">
            <div className="panel__cabecera">
              <h2 id="t-renglones" className="panel__titulo">
                Productos
              </h2>
              <span className="suave pequeno">{d.renglones.length} renglón(es)</span>
            </div>
            <Renglones doc={d} />
          </section>

          {d.incidencia && (
            <section className="panel" aria-labelledby="t-inc">
              <div className="panel__cabecera">
                <h2 id="t-inc" className="panel__titulo">
                  Incidencia de recepción
                </h2>
                <Estado tono={d.incidencia.estado === 'ABIERTA' ? 'error' : 'ok'}>{d.incidencia.estado === 'ABIERTA' ? 'Abierta' : 'Resuelta'}</Estado>
              </div>
              <div className="tabla-contenedor">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th scope="col">SKU</th>
                      <th scope="col" className="num">Enviada</th>
                      <th scope="col" className="num">Recibida</th>
                      <th scope="col" className="num">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.incidencia.renglones.map((r) => (
                      <tr key={r.sku}>
                        <td>
                          <span className="codigo">{r.sku}</span>
                          <span className="tabla__secundario">{r.descripcion}</span>
                        </td>
                        <td className="num">{fmtNumero(r.enviada)}</td>
                        <td className="num">{fmtNumero(r.recibida)}</td>
                        <td className="num" style={{ color: 'var(--error-700)', fontWeight: 700 }}>
                          {r.diferencia > 0 ? `Faltan ${fmtNumero(r.diferencia)}` : `Sobran ${fmtNumero(-r.diferencia)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.incidencia.resolucion && (
                <div className="panel__cuerpo pequeno">
                  <strong>{TIPOS_RESOLUCION.find((t) => t.valor === d.incidencia!.tipoResolucion)?.texto}:</strong> {d.incidencia.resolucion}
                  <span className="tabla__secundario">
                    Resolvió {d.incidencia.resueltoPor?.usuario.nombre} el {fmtFechaHora(d.incidencia.resueltoPor?.fecha)}
                  </span>
                </div>
              )}
            </section>
          )}

          <section className="panel" aria-labelledby="t-hist">
            <div className="panel__cabecera">
              <h2 id="t-hist" className="panel__titulo">
                Historial en bitácora
              </h2>
              <span className="suave pequeno">Incluye intentos rechazados</span>
            </div>
            <div className="panel__cuerpo">
              {eventos.cargando && !eventos.datos ? (
                <Cargando filas={3} />
              ) : (
                <ol className="linea-tiempo">
                  {(eventos.datos ?? []).map((e) => (
                    <li key={e.id} data-resultado={e.resultado}>
                      <span className="linea-tiempo__accion">{textoAccion(e.accion, e.resultado === 'EXITO')}</span>
                      {e.resultado !== 'EXITO' && (
                        <>
                          {' '}
                          <Estado tono="error">Rechazado</Estado>
                        </>
                      )}
                      {e.detalle && <span className="linea-tiempo__meta">{e.detalle}</span>}
                      <span className="linea-tiempo__meta">
                        {fmtFechaHora(e.fecha)}, {e.usuario}, IP {e.ip}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>

        <aside className="pila" aria-label="Datos del documento">
          <section className="panel">
            <div className="panel__cabecera">
              <h2 className="panel__titulo">Datos</h2>
            </div>
            <dl className="lista-datos panel__cuerpo">
              {d.almacenOrigen && (
                <>
                  <dt>{d.tipo === 'AJU' ? 'Almacén' : 'Origen'}</dt>
                  <dd>{ALMACEN_NOMBRE[d.almacenOrigen]}</dd>
                </>
              )}
              {d.almacenDestino && (
                <>
                  <dt>Destino</dt>
                  <dd>{ALMACEN_NOMBRE[d.almacenDestino]}</dd>
                </>
              )}
              {d.motivo && (
                <>
                  <dt>Motivo</dt>
                  <dd>{d.motivo.nombre}</dd>
                </>
              )}
              {d.centroCosto && (
                <>
                  <dt>Centro de costo</dt>
                  <dd>{d.centroCosto}</dd>
                </>
              )}
              {d.ordenCompra && (
                <>
                  <dt>Orden de compra</dt>
                  <dd className="codigo">{d.ordenCompra}</dd>
                </>
              )}
              {d.proveedor && (
                <>
                  <dt>Proveedor</dt>
                  <dd>{d.proveedor}</dd>
                </>
              )}
              {d.fechaRequerida && (
                <>
                  <dt>Se requiere el</dt>
                  <dd>{fmtFecha(d.fechaRequerida)}</dd>
                </>
              )}
              {d.referencia && (
                <>
                  <dt>Origen</dt>
                  <dd className="codigo">{d.referencia}</dd>
                </>
              )}
              <dt>Importe</dt>
              <dd>{ocultoParaMi ? 'Visible al registrar' : fmtMoneda(d.montoTotal)}</dd>
              <dt>Aprobación</dt>
              <dd>{d.nivelAprobacion === 'SUP' ? 'Supervisor' : d.nivelAprobacion === 'GER' ? 'Gerencia (importe alto)' : 'Supervisor y Gerencia'}</dd>
              {d.extemporanea && (
                <>
                  <dt>Captura</dt>
                  <dd>
                    <Estado tono="alerta">Extemporánea</Estado>
                  </dd>
                </>
              )}
            </dl>
            {d.justificacion && (
              <div className="panel__cuerpo" style={{ paddingTop: 0 }}>
                <p className="pequeno suave">Justificación</p>
                <p className="pequeno">{d.justificacion}</p>
              </div>
            )}
            {d.transporte && (
              <div className="panel__cuerpo pequeno" style={{ borderTop: '1px solid var(--linea)' }}>
                <p className="fila" style={{ gap: 6, fontWeight: 600 }}>
                  <Truck size={15} aria-hidden /> Transporte
                </p>
                {d.transporte.transportista}
                <span className="tabla__secundario">
                  {d.transporte.unidad}. Sellos: {d.transporte.sellos}
                </span>
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="t-part">
            <div className="panel__cabecera">
              <h2 id="t-part" className="panel__titulo">
                Quién participó
              </h2>
            </div>
            <Participantes doc={d} />
          </section>

          {d.adjuntos.length > 0 && (
            <section className="panel" aria-labelledby="t-adj">
              <div className="panel__cabecera">
                <h2 id="t-adj" className="panel__titulo">
                  Evidencia
                </h2>
              </div>
              <ul className="lista-limpia panel__cuerpo pila pila--estrecha">
                {d.adjuntos.map((a) => (
                  <li key={a.id} className="pequeno">
                    <span className="fila" style={{ gap: 6 }}>
                      <Paperclip size={14} aria-hidden /> {a.nombre}
                    </span>
                    <span className="tabla__secundario">
                      {(a.tamano / 1024).toFixed(0)} KB, subido por {a.subidoPor}. SHA-256 {a.sha256.slice(0, 16)}…
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(d.motivoRechazo || d.motivoCancelacion) && (
            <section className="panel">
              <div className="panel__cuerpo pequeno">
                <strong>{d.motivoRechazo ? 'Motivo del rechazo' : 'Motivo de la cancelación'}</strong>
                <p>{d.motivoRechazo ?? d.motivoCancelacion}</p>
              </div>
            </section>
          )}
        </aside>
      </div>

      {/* Diálogos de acción */}
      <DialogoConfirmacion
        abierto={accion === 'aprobar' || accion === 'enviar_aprobacion' || accion === 'confirmar_recepcion'}
        titulo={accion ? `${ACCION_DOC[accion].texto} ${d.folio}` : ''}
        descripcion={
          accion === 'aprobar' ? (
            <>
              {ACCION_DOC.aprobar.confirmacion} {d.tipo === 'SAL' || d.tipo === 'TRF' ? `Se apartarán ${d.renglones.length} producto(s) en ${d.almacenOrigen}.` : d.tipo === 'AJU' && d.nivelAprobacion === 'SUP+GER' && d.estado === 'PENDIENTE' ? 'Por su importe, después pasará a Gerencia para la segunda aprobación.' : d.tipo === 'AJU' ? 'El ajuste se aplicará al inventario.' : 'La mercancía entrará al inventario.'}
            </>
          ) : accion ? (
            ACCION_DOC[accion].confirmacion
          ) : (
            ''
          )
        }
        textoConfirmar={accion ? ACCION_DOC[accion].texto : ''}
        pedirPassword={accion === 'aprobar' && nivelAlto}
        alCerrar={() => setAccion(null)}
        alConfirmar={(v) => ejecutar(accion!, v.password ? { reautenticacion: { password: v.password } } : {})}
      />
      <DialogoConfirmacion
        abierto={accion === 'rechazar' || accion === 'cancelar'}
        titulo={accion ? `${ACCION_DOC[accion].texto}: ${d.folio}` : ''}
        descripcion={accion ? ACCION_DOC[accion].confirmacion : ''}
        textoConfirmar={accion === 'rechazar' ? 'Rechazar' : 'Cancelar documento'}
        peligro
        motivoMinimo={15}
        etiquetaMotivo={accion === 'rechazar' ? 'Motivo del rechazo' : 'Motivo de la cancelación'}
        alCerrar={() => setAccion(null)}
        alConfirmar={(v) => ejecutar(accion!, { motivo: v.motivo })}
      />
      <DialogoConfirmacion
        abierto={accion === 'confirmar_entrega'}
        titulo={`Confirmar entrega de ${d.folio}`}
        descripcion="Revisa que recibiste todo lo surtido. Tu confirmación cierra la salida y queda como firma en la bitácora."
        textoConfirmar="Confirmo que lo recibí"
        pedirPassword
        textoPassword="Tu contraseña funciona como firma de recibido."
        alCerrar={() => setAccion(null)}
        alConfirmar={(v) => ejecutar('confirmar_entrega', { reautenticacion: { password: v.password } })}
      />
      <DialogoConfirmacion
        abierto={accion === 'resolver_incidencia'}
        titulo={`Resolver incidencia de ${d.folio}`}
        descripcion={ACCION_DOC.resolver_incidencia.confirmacion}
        textoConfirmar="Resolver y cerrar"
        motivoMinimo={20}
        etiquetaMotivo="Explicación y evidencia (acta, reporte del transportista)"
        alCerrar={() => {
          setAccion(null);
          setTipoResolucion('');
          setIntentoResolucion(false);
        }}
        alConfirmar={async (v) => {
          setIntentoResolucion(true);
          if (!tipoResolucion) throw new ApiError(422, 'VALIDACION', 'Elige el tipo de resolución.');
          await ejecutar('resolver_incidencia', { motivo: v.motivo, tipoResolucion });
          setTipoResolucion('');
          setIntentoResolucion(false);
        }}
      >
        <SelectorResolucion valor={tipoResolucion} cambiar={setTipoResolucion} intento={intentoResolucion} />
      </DialogoConfirmacion>
      <DialogoSurtido doc={d} abierto={accion === 'surtir'} alCerrar={() => setAccion(null)} ejecutar={(c) => ejecutar('surtir', c)} />
      <DialogoEnvio doc={d} abierto={accion === 'enviar'} alCerrar={() => setAccion(null)} ejecutar={(c) => ejecutar('enviar', c)} />
      <DialogoRecepcionCiega doc={d} abierto={accion === 'recibir'} alCerrar={() => setAccion(null)} ejecutar={(c) => ejecutar('recibir', c)} />
      {d.tipo === 'ENT' && d.estado === 'CONFIRMADA' && (
        <p className="pequeno suave" style={{ marginTop: 16 }}>
          La entrada ya forma parte del inventario. Consulta el <Link to={`/existencias/kardex?producto=${d.renglones[0]?.productoId ?? ''}&almacen=${d.almacenDestino}`}>kardex</Link> para ver los movimientos generados.
        </p>
      )}
    </>
  );
}

/* ───────────── Piezas del detalle ───────────── */

function RutaTransferencia({ doc }: { doc: Documento }) {
  const enviado = ['EN_TRANSITO', 'CON_DISCREPANCIA', 'CERRADA'].includes(doc.estado);
  const recibido = ['CON_DISCREPANCIA', 'CERRADA'].includes(doc.estado);
  return (
    <div className="ruta">
      <div className="ruta__nodo" data-activo={!enviado && !['CANCELADA', 'RECHAZADA'].includes(doc.estado)} data-hecho={enviado}>
        <span className="ruta__clave">{doc.almacenOrigen}</span>
        <span className="ruta__texto">{doc.enviadoPor ? `Envió ${doc.enviadoPor.usuario.nombre}, ${fmtFechaHora(doc.enviadoPor.fecha)}` : ALMACEN_NOMBRE[doc.almacenOrigen ?? '']}</span>
      </div>
      <div className="ruta__tramo" data-hecho={enviado} aria-hidden />
      <div className="ruta__nodo" data-activo={doc.estado === 'EN_TRANSITO'} data-hecho={recibido}>
        <span className="ruta__clave">TRÁNSITO</span>
        <span className="ruta__texto">{doc.transporte ? doc.transporte.transportista : 'Almacén virtual'}</span>
      </div>
      <div className="ruta__tramo" data-hecho={recibido} aria-hidden />
      <div className="ruta__nodo" data-activo={doc.estado === 'CON_DISCREPANCIA'} data-hecho={doc.estado === 'CERRADA'}>
        <span className="ruta__clave">{doc.almacenDestino}</span>
        <span className="ruta__texto">{doc.recibidoPor ? `Recibió ${doc.recibidoPor.usuario.nombre}, ${fmtFechaHora(doc.recibidoPor.fecha)}` : ALMACEN_NOMBRE[doc.almacenDestino ?? '']}</span>
      </div>
    </div>
  );
}

function Pasos({ doc }: { doc: Documento }) {
  let pasos = PASOS[doc.tipo];
  if (doc.tipo === 'AJU' && doc.nivelAprobacion !== 'SUP+GER') pasos = pasos.filter((p) => p !== 'PENDIENTE_N2');
  const indice = pasos.indexOf(doc.estado);
  const terminado = ['RECHAZADA', 'CANCELADA', 'VENCIDA'].includes(doc.estado);
  return (
    <ol className="pasos">
      {pasos.map((p, i) => (
        <li key={p} data-estado={terminado ? 'detenido' : i < indice ? 'hecho' : i === indice ? 'actual' : 'pendiente'} aria-current={i === indice ? 'step' : undefined}>
          <span className="pasos__marca" aria-hidden>
            {i + 1}
          </span>
          {ESTADO_DOC[p].texto}
        </li>
      ))}
      {terminado && (
        <li data-estado="final-error">
          <span className="pasos__marca" aria-hidden>
            ×
          </span>
          {ESTADO_DOC[doc.estado].texto}
        </li>
      )}
    </ol>
  );
}

function Renglones({ doc }: { doc: Documento }) {
  const esTrf = doc.tipo === 'TRF';
  const esSal = doc.tipo === 'SAL';
  const esEnt = doc.tipo === 'ENT';
  const mostrarRecibida = esTrf && doc.renglones.some((r) => r.cantidadRecibida != null);
  const mostrarEsperada = esEnt && doc.renglones.some((r) => r.cantidadEsperada != null);
  const ocultas = esTrf && doc.estado === 'EN_TRANSITO' && doc.renglones.every((r) => r.cantidadEnviada === null);
  return (
    <div className="tabla-contenedor">
      <table className="tabla renglones">
        <thead>
          <tr>
            <th scope="col">Producto</th>
            <th scope="col" className="num">
              {esEnt ? 'Recibida' : doc.tipo === 'AJU' ? 'Ajuste' : 'Solicitada'}
            </th>
            {mostrarEsperada && <th scope="col" className="num">Esperada (OC)</th>}
            {esSal && <th scope="col" className="num">Surtida</th>}
            {esTrf && <th scope="col" className="num">Enviada</th>}
            {mostrarRecibida && <th scope="col" className="num">Recibida</th>}
            <th scope="col" className="num">Costo unitario</th>
            <th scope="col" className="num">Importe</th>
          </tr>
        </thead>
        <tbody>
          {doc.renglones.map((r) => (
            <tr key={r.id}>
              <td>
                <span className="codigo">{r.sku}</span>
                <span className="tabla__secundario">{r.descripcion}</span>
                {r.series.length > 0 && (
                  <div className="series-lista">
                    {r.series.map((s) => (
                      <span key={s} className="serie" title={r.seriesRecibidas.length && !r.seriesRecibidas.includes(s) ? 'No se recibió' : undefined} style={r.seriesRecibidas.length && !r.seriesRecibidas.includes(s) ? { borderColor: 'var(--error-700)', color: 'var(--error-700)' } : undefined}>
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td className="num">{ocultas ? '—' : `${r.cantidad > 0 && doc.tipo === 'AJU' ? '+' : ''}${fmtNumero(r.cantidad)} ${r.unidad}`}</td>
              {mostrarEsperada && <td className="num">{r.cantidadEsperada == null ? 'No estaba en la OC' : fmtNumero(r.cantidadEsperada)}</td>}
              {esSal && <td className="num">{r.cantidadSurtida == null ? '—' : fmtNumero(r.cantidadSurtida)}</td>}
              {esTrf && <td className="num">{r.cantidadEnviada == null ? '—' : fmtNumero(r.cantidadEnviada)}</td>}
              {mostrarRecibida && (
                <td className="num">
                  {r.cantidadRecibida == null ? '—' : fmtNumero(r.cantidadRecibida)}
                  {r.diferencia ? <span className="tabla__secundario" style={{ color: 'var(--error-700)' }}>Diferencia {fmtNumero(r.diferencia)}</span> : null}
                </td>
              )}
              <td className="num">{ocultas ? '—' : fmtMoneda(r.costoUnitario)}</td>
              <td className="num">{ocultas ? '—' : fmtMoneda(r.importe)}</td>
            </tr>
          ))}
        </tbody>
        {!ocultas && (
          <tfoot>
            <tr>
              <td colSpan={99} className="num">
                Total {fmtMoneda(doc.montoTotal)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function Participantes({ doc }: { doc: Documento }) {
  const filas: [string, Documento['creadoPor'] | null][] = [
    ['Creó', doc.creadoPor],
    ['Envió a aprobación', doc.enviadoAprobacionPor],
    [doc.tipo === 'AJU' && doc.nivelAprobacion === 'SUP+GER' ? 'Primera aprobación' : 'Aprobó', doc.aprobador1],
    ['Segunda aprobación', doc.aprobador2],
    ['Surtió', doc.surtidoPor],
    ['Envió', doc.enviadoPor],
    ['Recibió', doc.recibidoPor],
    ['Confirmó entrega', doc.entregadoA],
    ['Rechazó', doc.rechazadoPor],
    ['Canceló', doc.canceladoPor],
  ];
  const presentes = filas.filter(([, p]) => p);
  const personas = new Set(presentes.map(([, p]) => p!.usuario.id));
  return (
    <div className="panel__cuerpo pila pila--estrecha">
      <ol className="linea-tiempo">
        {presentes.map(([rol, p]) => (
          <li key={rol}>
            <span className="linea-tiempo__accion">{rol}</span>
            <span className="linea-tiempo__meta">
              {p!.usuario.nombre}, {fmtFechaHora(p!.fecha)}
            </span>
          </li>
        ))}
      </ol>
      <p className="pequeno suave fila" style={{ gap: 6 }}>
        <ShieldCheck size={14} aria-hidden /> {personas.size} persona(s) distintas en {presentes.length} paso(s).
      </p>
    </div>
  );
}
