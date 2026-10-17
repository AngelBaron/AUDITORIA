import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Send, Save, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { api } from '@/api/cliente';
import { ApiError } from '@/api/http';
import type { AdjuntoNuevo, AlmacenClave, DocumentoNuevo, Permiso, Producto, TipoDocumento } from '@/api/types';
import { useUsuario } from '@/auth/AuthContext';
import { SelectorAdjuntos } from '@/components/Adjuntos';
import { useAvisos } from '@/components/Avisos';
import { BandaError } from '@/components/Dialogo';
import { SelectorProducto } from '@/components/SelectorProducto';
import { CapturaSeries, EleccionSeries } from '@/components/Series';
import { Boton, Cabecera, Campo, Cargando } from '@/components/ui';
import { TEXTO_NUEVO } from '@/components/documentos';
import { TIPO_DOC } from '@/domain/estados';
import { ALMACEN_NOMBRE, fmtMoneda, fmtNumero } from '@/domain/formato';
import { almacenesConPermiso, puede } from '@/domain/permisos';
import { esDecimal, limpiarTexto, nuevaLlaveIdempotencia } from '@/domain/seguridad';
import { useConsulta } from '@/hooks/useConsulta';

const PERMISO: Record<TipoDocumento, Permiso> = { ENT: 'recepcion.crear', SAL: 'salida.solicitar', TRF: 'transferencia.crear', AJU: 'ajuste.crear' };
const TODOS: AlmacenClave[] = ['CEN', 'NTE', 'CTR', 'SUR'];

interface Linea {
  producto: Producto;
  cantidad: string;
  costo: string;
  series: string[];
  sentido: '+' | '-';
}

const esquemaCantidad = z
  .string()
  .trim()
  .min(1, 'Captura la cantidad.')
  .refine((v) => esDecimal(v), 'Número positivo con máximo 4 decimales.')
  .refine((v) => Number(v) > 0, 'Debe ser mayor a cero.');

export function NuevoDocumentoPage({ tipo }: { tipo: TipoDocumento }) {
  const usuario = useUsuario();
  const navegar = useNavigate();
  const { avisar } = useAvisos();
  const permitidos = almacenesConPermiso(usuario, PERMISO[tipo]);

  const [origen, setOrigen] = useState<AlmacenClave | ''>(permitidos.length === 1 ? permitidos[0]! : '');
  const [destino, setDestino] = useState<AlmacenClave | ''>(tipo === 'ENT' && permitidos.length === 1 ? permitidos[0]! : '');
  const [ocId, setOcId] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [centroCosto, setCentroCosto] = useState(usuario.centroCosto ?? '');
  const [fechaRequerida, setFechaRequerida] = useState('');
  const [justificacion, setJustificacion] = useState('');
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [adjuntos, setAdjuntos] = useState<AdjuntoNuevo[]>([]);
  const [intento, setIntento] = useState(false);
  const [enviando, setEnviando] = useState<'borrador' | 'enviar' | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [llave, setLlave] = useState(nuevaLlaveIdempotencia);

  const productos = useConsulta(() => api.productos.listar(), []);
  const motivos = useConsulta(() => api.catalogos.motivos(), []);
  const centros = useConsulta(() => api.catalogos.centrosCosto(), [], { activo: tipo === 'SAL' });
  const proveedores = useConsulta(() => api.catalogos.proveedores(), [], { activo: tipo === 'ENT' });
  const ocs = useConsulta(() => api.ordenesCompra.listar(true, destino || undefined), [destino], { activo: tipo === 'ENT' && !!destino });
  // El solicitante no consulta existencias (matriz RBAC): la disponibilidad la valida el servidor al aprobar
  const veExistencias = puede(usuario, 'existencias.ver');
  const existencias = useConsulta(() => api.inventario.existencias({ almacen: origen }), [origen], { activo: veExistencias && tipo !== 'ENT' && !!origen });
  const [seriesDisp, setSeriesDisp] = useState<Record<string, string[]>>({});

  const disponible = useMemo(() => Object.fromEntries((existencias.datos ?? []).map((e) => [e.producto.id, e.disponible])), [existencias.datos]);

  // Al elegir una orden de compra, se proponen sus productos SIN mostrar la cantidad esperada (captura ciega)
  useEffect(() => {
    if (tipo !== 'ENT' || !ocId) return;
    const oc = ocs.datos?.find((o) => o.id === ocId);
    const prods = productos.datos ?? [];
    if (!oc) return;
    setLineas(oc.renglones.map((r) => ({ producto: prods.find((p) => p.id === r.productoId)!, cantidad: '', costo: '', series: [], sentido: '+' as const })).filter((l) => l.producto));
  }, [ocId, ocs.datos, productos.datos, tipo]);

  // Series disponibles para bajas de productos serializados en ajustes
  useEffect(() => {
    if (tipo !== 'AJU' || !origen) return;
    const faltan = lineas.filter((l) => l.producto.serializado && l.sentido === '-' && !seriesDisp[l.producto.id]);
    faltan.forEach((l) =>
      api.inventario
        .seriesDisponibles(l.producto.id, origen)
        .then((s) => setSeriesDisp((x) => ({ ...x, [l.producto.id]: s })))
        .catch(() => undefined),
    );
  }, [lineas, origen, tipo, seriesDisp]);

  const motivosTipo = (motivos.datos ?? []).filter((m) => (m.aplicaA as string[]).includes(tipo));
  const motivoDef = motivosTipo.find((m) => m.clave === motivo);
  const minJustificacion = tipo === 'ENT' && !ocId ? 30 : motivoDef?.requiereJustificacionExtendida ? 30 : tipo === 'AJU' ? 15 : 0;
  const importe = lineas.reduce((s, l) => {
    const c = Number(l.cantidad) || 0;
    const costo = tipo === 'ENT' && !ocId ? Number(l.costo) || 0 : l.producto.costoPromedio;
    return s + c * costo;
  }, 0);

  /* ───── Validación del lado del cliente (el servidor vuelve a validar todo) ───── */
  const errores: Record<string, string> = {};
  if (tipo === 'ENT' && !destino) errores.destino = 'Elige el almacén que recibe.';
  if (tipo !== 'ENT' && !origen) errores.origen = 'Elige el almacén.';
  if (tipo === 'TRF' && !destino) errores.destino = 'Elige el destino.';
  if (tipo === 'TRF' && origen && destino && origen === destino) errores.destino = 'El destino debe ser distinto del origen.';
  if (tipo === 'ENT' && !ocId && !proveedorId) errores.proveedor = 'Sin orden de compra, indica el proveedor.';
  if (tipo !== 'ENT' && !motivo) errores.motivo = 'Elige el motivo.';
  if (tipo === 'SAL' && !centroCosto) errores.centroCosto = 'Elige el centro de costo.';
  if (justificacion.trim().length < minJustificacion) errores.justificacion = `Escribe al menos ${minJustificacion} caracteres.`;
  if (tipo === 'AJU' && adjuntos.length === 0) errores.adjuntos = 'Adjunta la evidencia: foto, acta o reporte.';
  if (!lineas.length) errores.lineas = 'Agrega al menos un producto.';
  lineas.forEach((l, i) => {
    const r = esquemaCantidad.safeParse(l.cantidad);
    if (!r.success) errores[`l${i}`] = r.error.issues[0]?.message ?? 'Cantidad inválida.';
    else if (l.producto.serializado && !Number.isInteger(Number(l.cantidad))) errores[`l${i}`] = 'Se controla por pieza: usa enteros.';
    else if (veExistencias && (tipo === 'SAL' || tipo === 'TRF' || (tipo === 'AJU' && l.sentido === '-')) && Number(l.cantidad) > (disponible[l.producto.id] ?? 0)) {
      errores[`l${i}`] = `Solo hay ${fmtNumero(disponible[l.producto.id] ?? 0)} disponibles.`;
    }
    const necesitaSeries = l.producto.serializado && (tipo === 'ENT' || tipo === 'AJU');
    if (necesitaSeries && r.success && l.series.length !== Number(l.cantidad)) errores[`s${i}`] = `Captura ${l.cantidad} series (llevas ${l.series.length}).`;
    if (tipo === 'ENT' && !ocId && !(Number(l.costo) > 0)) errores[`c${i}`] = 'Costo unitario requerido.';
  });
  const valido = Object.keys(errores).length === 0;
  const ver = (k: string) => (intento ? (errores[k] ?? null) : null);

  const enviar = async (modo: 'borrador' | 'enviar') => {
    setIntento(true);
    if (!valido || enviando) return;
    setEnviando(modo);
    setError(null);
    const datos: DocumentoNuevo = {
      tipo,
      almacenOrigen: tipo === 'ENT' ? null : (origen as AlmacenClave),
      almacenDestino: tipo === 'ENT' || tipo === 'TRF' ? (destino as AlmacenClave) : null,
      motivo: tipo === 'ENT' ? null : motivo,
      justificacion: limpiarTexto(justificacion),
      centroCosto: tipo === 'SAL' ? centroCosto : null,
      ordenCompraId: tipo === 'ENT' && ocId ? ocId : null,
      proveedorId: tipo === 'ENT' && !ocId ? proveedorId : null,
      fechaRequerida: tipo === 'SAL' && fechaRequerida ? fechaRequerida : null,
      renglones: lineas.map((l) => ({
        productoId: l.producto.id,
        cantidad: tipo === 'AJU' && l.sentido === '-' ? -Number(l.cantidad) : Number(l.cantidad),
        costoUnitario: tipo === 'ENT' && !ocId ? Number(l.costo) : undefined,
        series: l.producto.serializado ? l.series : undefined,
      })),
      adjuntos,
      enviarAprobacion: modo === 'enviar',
    };
    try {
      const doc = await api.documentos.crear(datos, llave);
      avisar('exito', `${TIPO_DOC[tipo].singular} ${doc.folio} ${modo === 'enviar' ? 'enviada a aprobación' : 'guardada'}.`);
      navegar(`${TIPO_DOC[tipo].ruta}/${doc.id}`, { replace: true });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'DESCONOCIDO', 'No se pudo guardar.');
      if (err.status >= 400 && err.status < 500) setLlave(nuevaLlaveIdempotencia());
      setError(err);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setEnviando(null);
    }
  };

  const actualizar = (i: number, cambios: Partial<Linea>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...cambios } : l)));

  if (permitidos.length === 0) return null;
  if (productos.cargando && !productos.datos) return <div className="panel"><Cargando /></div>;

  const opcionesOrigen = permitidos;
  const opcionesDestino = tipo === 'TRF' ? TODOS.filter((a) => a !== origen) : permitidos;

  return (
    <>
      <Cabecera titulo={TEXTO_NUEVO[tipo]} migas={[{ texto: TIPO_DOC[tipo].plural, a: TIPO_DOC[tipo].ruta }]} descripcion={DESCRIPCION[tipo]} />
      <form
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void enviar(tipo === 'ENT' ? 'borrador' : 'enviar');
        }}
        className="pila"
      >
        {error && <BandaError error={error} />}
        {intento && !valido && !error && (
          <div className="banda banda--error" role="alert">
            <div>
              <strong>Faltan datos</strong>
              Revisa los campos marcados en rojo.
            </div>
          </div>
        )}

        <section className="panel">
          <div className="panel__cabecera">
            <h2 className="panel__titulo">Datos generales</h2>
          </div>
          <div className="panel__cuerpo rejilla-form">
            {tipo !== 'ENT' && (
              <Campo etiqueta={tipo === 'TRF' ? 'Almacén de origen' : tipo === 'SAL' ? 'Almacén que surte' : 'Almacén'} requerido error={ver('origen')}>
                {(p) => (
                  <select {...p} className="entrada" value={origen} onChange={(e) => { setOrigen(e.target.value as AlmacenClave); setLineas([]); }}>
                    <option value="">Elige…</option>
                    {opcionesOrigen.map((a) => (
                      <option key={a} value={a}>{a} · {ALMACEN_NOMBRE[a]}</option>
                    ))}
                  </select>
                )}
              </Campo>
            )}
            {(tipo === 'ENT' || tipo === 'TRF') && (
              <Campo etiqueta={tipo === 'ENT' ? 'Almacén que recibe' : 'Almacén de destino'} requerido error={ver('destino')}>
                {(p) => (
                  <select {...p} className="entrada" value={destino} onChange={(e) => { setDestino(e.target.value as AlmacenClave); if (tipo === 'ENT') { setOcId(''); setLineas([]); } }}>
                    <option value="">Elige…</option>
                    {opcionesDestino.map((a) => (
                      <option key={a} value={a}>{a} · {ALMACEN_NOMBRE[a]}</option>
                    ))}
                  </select>
                )}
              </Campo>
            )}
            {tipo === 'ENT' && (
              <Campo etiqueta="Orden de compra" ayuda="Sin orden de compra, la entrada es extraordinaria y la autoriza un supervisor.">
                {(p) => (
                  <select {...p} className="entrada" value={ocId} disabled={!destino} onChange={(e) => { setOcId(e.target.value); if (!e.target.value) setLineas([]); }}>
                    <option value="">Sin orden de compra</option>
                    {(ocs.datos ?? []).map((o) => (
                      <option key={o.id} value={o.id}>{o.folio} · {o.proveedor.nombre}</option>
                    ))}
                  </select>
                )}
              </Campo>
            )}
            {tipo === 'ENT' && !ocId && (
              <Campo etiqueta="Proveedor" requerido error={ver('proveedor')}>
                {(p) => (
                  <select {...p} className="entrada" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
                    <option value="">Elige…</option>
                    {(proveedores.datos ?? []).map((pr) => (
                      <option key={pr.id} value={pr.id}>{pr.nombre}</option>
                    ))}
                  </select>
                )}
              </Campo>
            )}
            {tipo !== 'ENT' && (
              <Campo etiqueta="Motivo" requerido error={ver('motivo')}>
                {(p) => (
                  <select {...p} className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                    <option value="">Elige…</option>
                    {motivosTipo.map((m) => (
                      <option key={m.clave} value={m.clave}>{m.nombre}</option>
                    ))}
                  </select>
                )}
              </Campo>
            )}
            {tipo === 'SAL' && (
              <>
                <Campo etiqueta="Centro de costo" requerido error={ver('centroCosto')}>
                  {(p) => (
                    <select {...p} className="entrada" value={centroCosto} onChange={(e) => setCentroCosto(e.target.value)}>
                      <option value="">Elige…</option>
                      {(centros.datos ?? []).map((c) => (
                        <option key={c.clave} value={c.clave}>{c.clave} · {c.nombre}</option>
                      ))}
                    </select>
                  )}
                </Campo>
                <Campo etiqueta="Se requiere el">
                  {(p) => <input {...p} type="date" className="entrada" min={new Date().toISOString().slice(0, 10)} value={fechaRequerida} onChange={(e) => setFechaRequerida(e.target.value)} />}
                </Campo>
              </>
            )}
            <Campo
              className="rejilla-form__ancho"
              etiqueta={tipo === 'ENT' ? 'Factura, remisión u observaciones' : 'Justificación'}
              requerido={minJustificacion > 0}
              error={ver('justificacion')}
              ayuda={minJustificacion > 0 ? `Mínimo ${minJustificacion} caracteres. Explica qué pasó y por qué.` : undefined}
            >
              {(p) => (
                <>
                  <textarea {...p} className="entrada" maxLength={500} value={justificacion} onChange={(e) => setJustificacion(e.target.value)} />
                  <span className="contador-caracteres">{justificacion.length}/500</span>
                </>
              )}
            </Campo>
          </div>
        </section>

        <section className="panel">
          <div className="panel__cabecera">
            <h2 className="panel__titulo">Productos</h2>
            {lineas.length > 0 && <span className="suave pequeno">Importe estimado {fmtMoneda(importe)}</span>}
          </div>
          {tipo === 'ENT' && ocId && (
            <div className="panel__cuerpo" style={{ paddingBottom: 0 }}>
              <div className="banda banda--info">
                <div>
                  <strong>Captura ciega</strong>
                  Cuenta lo que llegó y captúralo. No ves la cantidad de la orden de compra para que la comparación sea independiente; el sistema la hace al confirmar.
                </div>
              </div>
            </div>
          )}
          <div className="panel__cuerpo">
            <SelectorProducto productos={productos.datos ?? []} excluir={lineas.map((l) => l.producto.id)} alElegir={(p) => setLineas((ls) => [...ls, { producto: p, cantidad: '', costo: tipo === 'ENT' ? String(p.costoEstandar) : '', series: [], sentido: '-' }])} />
            {ver('lineas') && <span className="campo__error" style={{ marginTop: 6 }}>{ver('lineas')}</span>}
            {tipo !== 'ENT' && !origen && veExistencias && <p className="campo__ayuda" style={{ marginTop: 6 }}>Elige primero el almacén para ver lo disponible.</p>}
            {tipo === 'SAL' && !veExistencias && <p className="campo__ayuda" style={{ marginTop: 6 }}>La disponibilidad se confirma al aprobar: si no alcanza, el supervisor te lo indicará.</p>}
          </div>
          {lineas.length > 0 && (
            <div className="tabla-contenedor">
              <table className="tabla renglones">
                <thead>
                  <tr>
                    <th scope="col">Producto</th>
                    {tipo === 'AJU' && <th scope="col">Tipo</th>}
                    {tipo !== 'ENT' && veExistencias && <th scope="col" className="num">Disponible</th>}
                    <th scope="col">{tipo === 'ENT' ? 'Cantidad recibida' : 'Cantidad'}</th>
                    {tipo === 'ENT' && !ocId && <th scope="col">Costo unitario</th>}
                    <th scope="col" className="acciones"><span className="sr-only">Quitar</span></th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l, i) => (
                    <tr key={l.producto.id}>
                      <td style={{ minWidth: 240 }}>
                        <span className="codigo">{l.producto.sku}</span>
                        <span className="tabla__secundario">{l.producto.descripcion}</span>
                        {l.producto.serializado && (tipo === 'ENT' || (tipo === 'AJU' && l.sentido === '+')) && (
                          <div style={{ marginTop: 8 }}>
                            <CapturaSeries series={l.series} cambiar={(s) => actualizar(i, { series: s })} esperadas={Number(l.cantidad) || undefined} />
                            {ver(`s${i}`) && <span className="campo__error">{ver(`s${i}`)}</span>}
                          </div>
                        )}
                        {l.producto.serializado && tipo === 'AJU' && l.sentido === '-' && (
                          <div style={{ marginTop: 8 }}>
                            <EleccionSeries disponibles={seriesDisp[l.producto.id] ?? []} elegidas={l.series} requeridas={Number(l.cantidad) || 0} cambiar={(s) => actualizar(i, { series: s })} />
                            {ver(`s${i}`) && <span className="campo__error">{ver(`s${i}`)}</span>}
                          </div>
                        )}
                      </td>
                      {tipo === 'AJU' && (
                        <td>
                          <select className="entrada" aria-label={`Tipo de ajuste de ${l.producto.sku}`} value={l.sentido} onChange={(e) => actualizar(i, { sentido: e.target.value as '+' | '-', series: [] })}>
                            <option value="-">Faltante (baja)</option>
                            <option value="+">Sobrante (alta)</option>
                          </select>
                        </td>
                      )}
                      {tipo !== 'ENT' && veExistencias && <td className="num">{fmtNumero(disponible[l.producto.id] ?? 0)} {l.producto.unidad}</td>}
                      <td style={{ width: 170 }}>
                        <input
                          className="entrada entrada--num"
                          inputMode="decimal"
                          aria-label={`Cantidad de ${l.producto.sku}`}
                          aria-invalid={!!ver(`l${i}`)}
                          maxLength={12}
                          value={l.cantidad}
                          onChange={(e) => actualizar(i, { cantidad: e.target.value.replace(/[^\d.]/g, '') })}
                        />
                        {ver(`l${i}`) && <span className="campo__error">{ver(`l${i}`)}</span>}
                      </td>
                      {tipo === 'ENT' && !ocId && (
                        <td style={{ width: 150 }}>
                          <input className="entrada entrada--num" inputMode="decimal" aria-label={`Costo unitario de ${l.producto.sku}`} aria-invalid={!!ver(`c${i}`)} maxLength={12} value={l.costo} onChange={(e) => actualizar(i, { costo: e.target.value.replace(/[^\d.]/g, '') })} />
                          {ver(`c${i}`) && <span className="campo__error">{ver(`c${i}`)}</span>}
                        </td>
                      )}
                      <td className="acciones">
                        <Boton tamano="sm" variante="fantasma" aria-label={`Quitar ${l.producto.sku}`} icono={<Trash2 aria-hidden />} onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {(tipo === 'AJU' || tipo === 'ENT') && (
          <section className="panel">
            <div className="panel__cuerpo">
              <SelectorAdjuntos
                adjuntos={adjuntos}
                cambiar={setAdjuntos}
                etiqueta={tipo === 'AJU' ? 'Evidencia del ajuste' : 'Factura o remisión del proveedor'}
                requerido={tipo === 'AJU'}
                error={ver('adjuntos')}
              />
            </div>
          </section>
        )}

        <div className="fila" style={{ justifyContent: 'flex-end' }}>
          <Boton onClick={() => navegar(TIPO_DOC[tipo].ruta)}>Descartar</Boton>
          {tipo !== 'ENT' && (
            <Boton icono={<Save aria-hidden />} cargando={enviando === 'borrador'} disabled={!!enviando} onClick={() => void enviar('borrador')}>
              Guardar borrador
            </Boton>
          )}
          <Boton type="submit" variante="primario" icono={tipo === 'ENT' ? <Save aria-hidden /> : <Send aria-hidden />} cargando={enviando === (tipo === 'ENT' ? 'borrador' : 'enviar')} disabled={!!enviando}>
            {tipo === 'ENT' ? 'Guardar captura' : 'Enviar a aprobación'}
          </Boton>
        </div>
      </form>
    </>
  );
}

const DESCRIPCION: Record<TipoDocumento, string> = {
  ENT: 'Registra lo que llegó físicamente. Después confirmarás la captura; si hay diferencias contra la orden de compra, la autoriza un supervisor.',
  SAL: 'Pide material de un almacén. Lo aprobará tu supervisor (o Gerencia si el importe es alto), lo surtirá un almacenista y tú confirmarás la entrega.',
  TRF: 'Mueve mercancía entre almacenes. La aprueba un supervisor del origen; quien envía no puede recibir.',
  AJU: 'Corrige la existencia con motivo y evidencia. Nunca lo aprueba quien lo captura.',
};
