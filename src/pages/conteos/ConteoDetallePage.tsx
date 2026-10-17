import { useState } from 'react';
import { useParams } from 'react-router';
import { EyeOff, Lock } from 'lucide-react';
import { api } from '@/api/cliente';
import { ApiError } from '@/api/http';
import type { Conteo } from '@/api/types';
import { useAvisos } from '@/components/Avisos';
import { BandaError, DialogoConfirmacion } from '@/components/Dialogo';
import { Boton, Cabecera, Cargando, ErrorCarga, Estado, Folio } from '@/components/ui';
import { ESTADO_CONTEO } from '@/domain/estados';
import { ALMACEN_NOMBRE, fmtFechaHora, fmtMoneda, fmtNumero, fmtPorcentaje } from '@/domain/formato';
import { esDecimal, nuevaLlaveIdempotencia } from '@/domain/seguridad';
import { useConsulta } from '@/hooks/useConsulta';

type AccionConteo = Conteo['accionesPermitidas'][number];

const TEXTO: Record<AccionConteo, string> = {
  iniciar: 'Iniciar conteo',
  capturar_primero: 'Registrar conteo',
  capturar_segundo: 'Registrar segundo conteo',
  cerrar: 'Cerrar conteo',
  cancelar: 'Cancelar conteo',
};

export function ConteoDetallePage() {
  const { id = '' } = useParams();
  const { avisar, avisarError } = useAvisos();
  const c = useConsulta(() => api.conteos.obtener(id), [id]);
  const [captura, setCaptura] = useState<Record<string, string>>({});
  const [dialogo, setDialogo] = useState<AccionConteo | null>(null);
  const [llave, setLlave] = useState(nuevaLlaveIdempotencia);
  const [error, setError] = useState<ApiError | null>(null);

  if (c.error) return <div className="panel"><ErrorCarga error={c.error} /></div>;
  if (!c.datos) return <div className="panel"><Cargando /></div>;
  const conteo = c.datos;
  const est = ESTADO_CONTEO[conteo.estado];
  const capturando = conteo.accionesPermitidas.includes('capturar_primero') ? 'primero' : conteo.accionesPermitidas.includes('capturar_segundo') ? 'segundo' : null;
  const filasCaptura = conteo.renglones.filter((r) => (capturando === 'segundo' ? r.requiereSegundo : true));
  const ciego = conteo.renglones.some((r) => r.existenciaSistema === null);
  const faltan = capturando ? filasCaptura.filter((r) => !esDecimal(captura[r.productoId] ?? '')) : [];

  const ejecutar = async (accion: AccionConteo, extra: { motivo?: string } = {}) => {
    setError(null);
    try {
      const cuerpo =
        accion === 'capturar_primero' || accion === 'capturar_segundo'
          ? { version: conteo.version, renglones: filasCaptura.map((r) => ({ productoId: r.productoId, cantidad: Number(captura[r.productoId]) })) }
          : { version: conteo.version, ...extra };
      const nuevo = await api.conteos.accion(conteo.id, accion, cuerpo, llave);
      setLlave(nuevaLlaveIdempotencia());
      c.establecer(nuevo);
      setCaptura({});
      setDialogo(null);
      avisar('exito', accion === 'cerrar' && nuevo.ajustesGenerados.length ? `Conteo cerrado. Se generó el ajuste ${nuevo.ajustesGenerados[0]!.folio}, pendiente de aprobación.` : `${TEXTO[accion]}: hecho.`);
    } catch (e) {
      setLlave(nuevaLlaveIdempotencia());
      if (e instanceof ApiError && e.codigo === 'VERSION_CONFLICTO') {
        avisarError(e);
        setDialogo(null);
        void c.recargar();
        return;
      }
      throw e;
    }
  };

  return (
    <>
      <Cabecera
        migas={[{ texto: 'Conteos físicos', a: '/conteos' }]}
        titulo={
          <span className="fila" style={{ gap: 14 }}>
            <Folio folio={conteo.folio} grande />
            <Estado tono={est.tono}>{est.texto}</Estado>
          </span>
        }
        descripcion={`${conteo.tipo === 'GENERAL' ? 'Conteo general' : `Conteo cíclico de clase ${conteo.clase}`} en ${ALMACEN_NOMBRE[conteo.almacen]}. Programó ${conteo.programadoPor.usuario.nombre} el ${fmtFechaHora(conteo.programadoPor.fecha)}.`}
        acciones={conteo.accionesPermitidas
          .filter((a) => a !== 'capturar_primero' && a !== 'capturar_segundo')
          .map((a) => (
            <Boton key={a} variante={a === 'cancelar' ? 'peligro' : 'primario'} onClick={() => setDialogo(a)}>
              {TEXTO[a]}
            </Boton>
          ))}
      />
      <div className="pila" style={{ marginBottom: 20 }}>
        {ciego && (
          <div className="banda banda--info">
            <EyeOff aria-hidden />
            <div>
              <strong>Conteo ciego</strong>
              No ves la existencia del sistema{conteo.estado === 'SEGUNDO_CONTEO' ? ' ni el primer conteo' : ''}. Cuenta lo que hay en el rack y captúralo tal cual.
            </div>
          </div>
        )}
        {conteo.bloqueos.map((b) => (
          <div key={b.accion} className="banda banda--bloqueo">
            <Lock aria-hidden />
            <div>
              <strong>No puedes {TEXTO[b.accion as AccionConteo]?.toLowerCase() ?? b.accion}</strong>
              {b.mensaje}
            </div>
          </div>
        ))}
        {conteo.estado === 'CERRADO' && (
          <div className="banda banda--ok">
            <div>
              <strong>Exactitud de inventario: {fmtPorcentaje(conteo.ira)}</strong>
              {conteo.ajustesGenerados.length
                ? `Las diferencias se enviaron como ajuste pendiente de aprobación: ${conteo.ajustesGenerados.map((a) => a.folio).join(', ')}. Nadie que haya contado puede aprobarlo.`
                : 'Sin diferencias: no se generaron ajustes.'}
            </div>
          </div>
        )}
      </div>

      <form
        className="panel"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!capturando || faltan.length) return;
          try {
            await ejecutar(capturando === 'primero' ? 'capturar_primero' : 'capturar_segundo');
          } catch (err) {
            setError(err instanceof ApiError ? err : null);
          }
        }}
      >
        <div className="panel__cabecera">
          <h2 className="panel__titulo">{capturando ? (capturando === 'segundo' ? 'Segundo conteo de los productos con diferencia' : 'Captura del conteo') : 'Resultado'}</h2>
          <span className="suave pequeno">{conteo.renglones.length} productos</span>
        </div>
        <div className="tabla-contenedor">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col" className="num">Sistema</th>
                <th scope="col" className="num">Primer conteo</th>
                <th scope="col" className="num">Segundo conteo</th>
                <th scope="col" className="num">Diferencia</th>
                <th scope="col" className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {conteo.renglones.map((r) => {
                const editable = capturando === 'primero' || (capturando === 'segundo' && r.requiereSegundo);
                return (
                  <tr key={r.productoId} className={r.requiereSegundo ? 'fila-destacada' : undefined}>
                    <td>
                      <span className="codigo">{r.sku}</span>
                      <span className="tabla__secundario">{r.descripcion}</span>
                    </td>
                    <td className="num">{r.existenciaSistema == null ? <span className="suave">Oculto</span> : fmtNumero(r.existenciaSistema)}</td>
                    <td className="num">
                      {capturando === 'primero' ? (
                        <input
                          className="entrada entrada--num"
                          style={{ maxWidth: 120, marginLeft: 'auto' }}
                          inputMode="decimal"
                          aria-label={`Conteo de ${r.sku}`}
                          maxLength={10}
                          value={captura[r.productoId] ?? ''}
                          onChange={(e) => setCaptura((x) => ({ ...x, [r.productoId]: e.target.value.replace(/[^\d.]/g, '') }))}
                        />
                      ) : (
                        <>
                          {r.conteo1 == null ? (r.contador1 ? <span className="suave">Oculto</span> : '—') : fmtNumero(r.conteo1)}
                          {r.contador1 && <span className="tabla__secundario">{r.contador1}</span>}
                        </>
                      )}
                    </td>
                    <td className="num">
                      {editable && capturando === 'segundo' ? (
                        <input
                          className="entrada entrada--num"
                          style={{ maxWidth: 120, marginLeft: 'auto' }}
                          inputMode="decimal"
                          aria-label={`Segundo conteo de ${r.sku}`}
                          maxLength={10}
                          value={captura[r.productoId] ?? ''}
                          onChange={(e) => setCaptura((x) => ({ ...x, [r.productoId]: e.target.value.replace(/[^\d.]/g, '') }))}
                        />
                      ) : (
                        <>
                          {r.conteo2 == null ? (r.requiereSegundo ? <Estado tono="alerta">Requerido</Estado> : '—') : fmtNumero(r.conteo2)}
                          {r.contador2 && <span className="tabla__secundario">{r.contador2}</span>}
                        </>
                      )}
                    </td>
                    <td className="num" style={r.diferencia ? { color: 'var(--error-700)', fontWeight: 700 } : undefined}>
                      {r.diferencia == null ? '—' : r.diferencia > 0 ? `+${fmtNumero(r.diferencia)}` : fmtNumero(r.diferencia)}
                    </td>
                    <td className="num">{fmtMoneda(r.diferenciaValor)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {capturando && (
          <div className="dialogo__pie">
            {error && <BandaError error={error} />}
            {faltan.length > 0 && <span className="suave pequeno">Faltan {faltan.length} producto(s) por capturar (escribe 0 si no hay).</span>}
            <Boton type="submit" variante="primario" disabled={faltan.length > 0}>
              {TEXTO[capturando === 'primero' ? 'capturar_primero' : 'capturar_segundo']}
            </Boton>
          </div>
        )}
      </form>

      <DialogoConfirmacion
        abierto={dialogo === 'iniciar' || dialogo === 'cerrar'}
        titulo={dialogo ? TEXTO[dialogo] : ''}
        descripcion={
          dialogo === 'iniciar'
            ? 'Se congela la existencia del sistema y los productos del conteo dejan de aceptar movimientos en este almacén hasta cerrarlo.'
            : 'Se calcula la exactitud (IRA) y las diferencias se envían como ajuste pendiente de aprobación. No se aplican automáticamente.'
        }
        textoConfirmar={dialogo ? TEXTO[dialogo] : ''}
        alCerrar={() => setDialogo(null)}
        alConfirmar={() => ejecutar(dialogo!)}
      />
      <DialogoConfirmacion
        abierto={dialogo === 'cancelar'}
        titulo="Cancelar conteo"
        descripcion="El conteo se conserva como cancelado y los productos vuelven a aceptar movimientos."
        textoConfirmar="Cancelar conteo"
        peligro
        motivoMinimo={15}
        alCerrar={() => setDialogo(null)}
        alConfirmar={(v) => ejecutar('cancelar', { motivo: v.motivo })}
      />
    </>
  );
}
