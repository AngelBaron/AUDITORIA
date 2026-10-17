import { useEffect, useState } from 'react';
import { api } from '@/api/cliente';
import { ApiError } from '@/api/http';
import type { CuerpoAccion, Documento, RenglonDocumento, TipoResolucion } from '@/api/types';
import { BandaError, Dialogo } from '@/components/Dialogo';
import { CapturaSeries, EleccionSeries } from '@/components/Series';
import { Boton, Campo } from '@/components/ui';
import { fmtNumero } from '@/domain/formato';

type Ejecutar = (cuerpo: Omit<CuerpoAccion, 'version'>) => Promise<unknown>;

interface Base {
  doc: Documento;
  abierto: boolean;
  alCerrar: () => void;
  ejecutar: Ejecutar;
}

function useSeriesDisponibles(doc: Documento, abierto: boolean) {
  const [series, setSeries] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!abierto || !doc.almacenOrigen) return;
    const almacen = doc.almacenOrigen;
    let vivo = true;
    Promise.all(doc.renglones.filter((r) => r.serializado).map(async (r) => [r.id, await api.inventario.seriesDisponibles(r.productoId, almacen)] as const))
      .then((pares) => vivo && setSeries(Object.fromEntries(pares)))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [abierto, doc]);
  return series;
}

function useEnvioDialogo(ejecutar: Ejecutar) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const enviar = async (cuerpo: Omit<CuerpoAccion, 'version'>) => {
    setEnviando(true);
    setError(null);
    try {
      await ejecutar(cuerpo);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'DESCONOCIDO', 'No se pudo completar.'));
    } finally {
      setEnviando(false);
    }
  };
  return { enviando, error, enviar, setError };
}

/* ───────────── Surtir salida ───────────── */

export function DialogoSurtido({ doc, abierto, alCerrar, ejecutar }: Base) {
  const disponibles = useSeriesDisponibles(doc, abierto);
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [series, setSeries] = useState<Record<string, string[]>>({});
  const { enviando, error, enviar, setError } = useEnvioDialogo(ejecutar);

  useEffect(() => {
    if (abierto) {
      setCantidades(Object.fromEntries(doc.renglones.map((r) => [r.id, r.cantidad])));
      setSeries({});
      setError(null);
    }
  }, [abierto, doc, setError]);

  const valido = doc.renglones.every((r) => {
    const c = cantidades[r.id] ?? 0;
    return c >= 0 && c <= r.cantidad && (!r.serializado || (series[r.id]?.length ?? 0) === c);
  });

  return (
    <Dialogo
      abierto={abierto}
      ancho
      titulo={`Surtir ${doc.folio}`}
      alCerrar={alCerrar}
      alEnviar={() => valido && void enviar({ renglones: doc.renglones.map((r) => ({ renglonId: r.id, cantidad: cantidades[r.id] ?? 0, series: series[r.id] })) })}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={enviando}>
            Volver
          </Boton>
          <Boton type="submit" variante="primario" cargando={enviando} disabled={!valido}>
            Confirmar surtido
          </Boton>
        </>
      }
    >
      <p className="suave">El material sale del almacén {doc.almacenOrigen} en cuanto confirmes. No puedes surtir más de lo aprobado; lo que no surtas se libera de la reserva.</p>
      {doc.renglones.map((r) => (
        <fieldset key={r.id} className="panel" style={{ padding: 14, margin: 0 }}>
          <legend className="codigo" style={{ padding: '0 6px' }}>
            {r.sku}
          </legend>
          <p className="pequeno suave" style={{ marginBottom: 8 }}>
            {r.descripcion}. Aprobado: <strong>{fmtNumero(r.cantidad)} {r.unidad}</strong>
          </p>
          <Campo etiqueta="Cantidad que surtes">
            {(p) => (
              <input
                {...p}
                className="entrada entrada--num"
                type="number"
                inputMode="decimal"
                min={0}
                max={r.cantidad}
                step={r.serializado ? 1 : 'any'}
                style={{ maxWidth: 160 }}
                value={cantidades[r.id] ?? 0}
                onChange={(e) => setCantidades((c) => ({ ...c, [r.id]: Math.max(0, Math.min(r.cantidad, Number(e.target.value))) }))}
              />
            )}
          </Campo>
          {r.serializado && (
            <div style={{ marginTop: 10 }}>
              <EleccionSeries disponibles={disponibles[r.id] ?? []} elegidas={series[r.id] ?? []} requeridas={cantidades[r.id] ?? 0} cambiar={(s) => setSeries((x) => ({ ...x, [r.id]: s }))} />
            </div>
          )}
        </fieldset>
      ))}
      {error && <BandaError error={error} />}
    </Dialogo>
  );
}

/* ───────────── Enviar transferencia ───────────── */

export function DialogoEnvio({ doc, abierto, alCerrar, ejecutar }: Base) {
  const disponibles = useSeriesDisponibles(doc, abierto);
  const [t, setT] = useState({ transportista: '', unidad: '', sellos: '' });
  const [series, setSeries] = useState<Record<string, string[]>>({});
  const [intento, setIntento] = useState(false);
  const { enviando, error, enviar, setError } = useEnvioDialogo(ejecutar);

  useEffect(() => {
    if (abierto) {
      setT({ transportista: '', unidad: '', sellos: '' });
      setSeries({});
      setIntento(false);
      setError(null);
    }
  }, [abierto, setError]);

  const faltaTransporte = !t.transportista.trim() || !t.unidad.trim() || !t.sellos.trim();
  const faltanSeries = doc.renglones.some((r) => r.serializado && (series[r.id]?.length ?? 0) !== r.cantidad);

  return (
    <Dialogo
      abierto={abierto}
      ancho
      titulo={`Enviar ${doc.folio} a ${doc.almacenDestino}`}
      alCerrar={alCerrar}
      alEnviar={() => {
        setIntento(true);
        if (faltaTransporte || faltanSeries) return;
        void enviar({ transporte: t, renglones: doc.renglones.map((r) => ({ renglonId: r.id, cantidad: r.cantidad, series: series[r.id] })) });
      }}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={enviando}>
            Volver
          </Boton>
          <Boton type="submit" variante="primario" cargando={enviando}>
            Enviar a tránsito
          </Boton>
        </>
      }
    >
      <p className="suave">La mercancía sale de {doc.almacenOrigen} y queda en el almacén virtual TRÁNSITO en una sola operación. Después ya no se puede cancelar.</p>
      <div className="rejilla-form">
        <Campo etiqueta="Transportista" requerido error={intento && !t.transportista.trim() ? 'Requerido.' : null}>
          {(p) => <input {...p} className="entrada" maxLength={80} value={t.transportista} onChange={(e) => setT({ ...t, transportista: e.target.value })} />}
        </Campo>
        <Campo etiqueta="Unidad o placas" requerido error={intento && !t.unidad.trim() ? 'Requerido.' : null}>
          {(p) => <input {...p} className="entrada" maxLength={80} value={t.unidad} onChange={(e) => setT({ ...t, unidad: e.target.value })} />}
        </Campo>
        <Campo etiqueta="Sellos o guía" requerido ayuda="Números de sello de seguridad separados por coma." error={intento && !t.sellos.trim() ? 'Requerido.' : null}>
          {(p) => <input {...p} className="entrada" maxLength={120} value={t.sellos} onChange={(e) => setT({ ...t, sellos: e.target.value })} />}
        </Campo>
      </div>
      {doc.renglones
        .filter((r) => r.serializado)
        .map((r) => (
          <fieldset key={r.id} className="panel" style={{ padding: 14, margin: 0 }}>
            <legend className="codigo" style={{ padding: '0 6px' }}>
              {r.sku}: elige {r.cantidad} series
            </legend>
            <EleccionSeries disponibles={disponibles[r.id] ?? []} elegidas={series[r.id] ?? []} requeridas={r.cantidad} cambiar={(s) => setSeries((x) => ({ ...x, [r.id]: s }))} />
            {intento && (series[r.id]?.length ?? 0) !== r.cantidad && <span className="campo__error">Faltan series por elegir.</span>}
          </fieldset>
        ))}
      {error && <BandaError error={error} />}
    </Dialogo>
  );
}

/* ───────────── Recepción ciega de transferencia ───────────── */

export function DialogoRecepcionCiega({ doc, abierto, alCerrar, ejecutar }: Base) {
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [series, setSeries] = useState<Record<string, string[]>>({});
  const [intento, setIntento] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const { enviando, error, enviar, setError } = useEnvioDialogo(ejecutar);

  useEffect(() => {
    if (abierto) {
      setCantidades({});
      setSeries({});
      setIntento(false);
      setConfirmar(false);
      setError(null);
    }
  }, [abierto, setError]);

  const faltan = doc.renglones.filter((r) => !r.serializado && (cantidades[r.id] ?? '') === '');

  const cuerpo = () => ({
    renglones: doc.renglones.map((r: RenglonDocumento) => (r.serializado ? { renglonId: r.id, cantidad: series[r.id]?.length ?? 0, series: series[r.id] ?? [] } : { renglonId: r.id, cantidad: Number(cantidades[r.id]) })),
  });

  return (
    <Dialogo
      abierto={abierto}
      ancho
      titulo={`Recibir ${doc.folio}`}
      alCerrar={alCerrar}
      alEnviar={() => {
        setIntento(true);
        if (faltan.length) return;
        if (!confirmar) {
          setConfirmar(true);
          return;
        }
        void enviar(cuerpo());
      }}
      pie={
        <>
          <Boton onClick={() => (confirmar ? setConfirmar(false) : alCerrar())} disabled={enviando}>
            {confirmar ? 'Revisar captura' : 'Volver'}
          </Boton>
          <Boton type="submit" variante="primario" cargando={enviando}>
            {confirmar ? 'Sí, registrar lo que conté' : 'Registrar recepción'}
          </Boton>
        </>
      }
    >
      <div className="banda banda--info">
        <div>
          <strong>Recepción ciega</strong>
          Cuenta físicamente lo que llegó y captúralo. No verás lo enviado hasta registrar: así la comparación es independiente. Si algo no llegó, escribe 0.
        </div>
      </div>
      {doc.transporte && (
        <p className="pequeno suave">
          Transportista: {doc.transporte.transportista}. Unidad: {doc.transporte.unidad}. Verifica que los sellos {doc.transporte.sellos} estén íntegros.
        </p>
      )}
      {doc.renglones.map((r) => (
        <fieldset key={r.id} className="panel" style={{ padding: 14, margin: 0 }} disabled={confirmar}>
          <legend className="codigo" style={{ padding: '0 6px' }}>
            {r.sku}
          </legend>
          <p className="pequeno suave" style={{ marginBottom: 8 }}>
            {r.descripcion} ({r.unidad})
          </p>
          {r.serializado ? (
            <CapturaSeries series={series[r.id] ?? []} cambiar={(s) => setSeries((x) => ({ ...x, [r.id]: s }))} ocultarEsperadas etiqueta="Escanea cada pieza recibida" />
          ) : (
            <Campo etiqueta="Cantidad recibida" requerido error={intento && (cantidades[r.id] ?? '') === '' ? 'Captura la cantidad (0 si no llegó).' : null}>
              {(p) => (
                <input
                  {...p}
                  className="entrada entrada--num"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  style={{ maxWidth: 160 }}
                  value={cantidades[r.id] ?? ''}
                  onChange={(e) => setCantidades((c) => ({ ...c, [r.id]: e.target.value }))}
                />
              )}
            </Campo>
          )}
        </fieldset>
      ))}
      {confirmar && (
        <div className="banda banda--accion" role="status">
          <div>
            <strong>Revisa antes de registrar</strong>
            Una vez registrada, la recepción no se puede modificar. Si lo capturado no coincide con lo enviado, se abrirá una incidencia que resolverá Gerencia.
          </div>
        </div>
      )}
      {error && <BandaError error={error} />}
    </Dialogo>
  );
}

export const TIPOS_RESOLUCION: { valor: TipoResolucion; texto: string; ayuda: string }[] = [
  { valor: 'FALTANTE_IMPUTABLE', texto: 'Faltante imputable', ayuda: 'La mercancía se perdió; se da de baja como merma y se documenta el responsable.' },
  { valor: 'DANIO_TRANSITO', texto: 'Daño en tránsito', ayuda: 'Llegó dañada y no es utilizable; se da de baja como merma.' },
  { valor: 'ERROR_CAPTURA', texto: 'Error de captura en el envío', ayuda: 'Nunca salió del origen (o salió de más); la diferencia regresa al almacén de origen.' },
];

export function SelectorResolucion({ valor, cambiar, intento }: { valor: TipoResolucion | ''; cambiar: (v: TipoResolucion) => void; intento: boolean }) {
  return (
    <fieldset className="pila pila--estrecha" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="campo__etiqueta" style={{ marginBottom: 6 }}>
        Tipo de resolución
      </legend>
      {TIPOS_RESOLUCION.map((t) => (
        <label key={t.valor} className="casilla" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <input type="radio" name="tipoResolucion" value={t.valor} checked={valor === t.valor} onChange={() => cambiar(t.valor)} />
          <strong>{t.texto}</strong>
          <span className="tabla__secundario">{t.ayuda}</span>
        </label>
      ))}
      {intento && !valor && <span className="campo__error">Elige el tipo de resolución.</span>}
    </fieldset>
  );
}
