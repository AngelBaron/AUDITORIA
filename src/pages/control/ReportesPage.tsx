import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { CircleCheck, Lock, TriangleAlert } from 'lucide-react';
import { api } from '@/api/cliente';
import type { Periodo, Permiso } from '@/api/types';
import { useUsuario } from '@/auth/AuthContext';
import { useAvisos } from '@/components/Avisos';
import { DialogoConfirmacion } from '@/components/Dialogo';
import { BotonExportarCsv, BotonImprimir } from '@/components/Exportar';
import { Boton, Cabecera, Cargando, ErrorCarga, Estado, Folio, Pestanas, Vacio } from '@/components/ui';
import { fmtFechaHora, fmtMoneda, fmtNumero } from '@/domain/formato';
import { puede } from '@/domain/permisos';
import { rutaPorFolio } from '@/domain/rutas';
import { useConsulta } from '@/hooks/useConsulta';

interface Columna<T> {
  titulo: string;
  valor: (f: T) => string | number | null;
  mostrar?: (f: T) => ReactNode;
  num?: boolean;
  moneda?: boolean;
}

interface DefReporte<T> {
  clave: string;
  titulo: string;
  descripcion: string;
  permiso: Permiso;
  cargar: () => Promise<T[]>;
  columnas: Columna<T>[];
  total?: (filas: T[]) => string;
  resumen?: (filas: T[]) => ReactNode;
}

function def<T>(d: DefReporte<T>): DefReporte<unknown> {
  return d as unknown as DefReporte<unknown>;
}

const REPORTES = [
  def({
    clave: 'valuacion',
    titulo: 'Valuación',
    descripcion: 'Existencia a costo promedio ponderado por almacén y producto (NIF C-4). Incluye lo que está en tránsito.',
    permiso: 'valuacion.ver',
    cargar: api.reportes.valuacion,
    columnas: [
      { titulo: 'Almacén', valor: (f) => f.almacen },
      { titulo: 'SKU', valor: (f) => f.sku },
      { titulo: 'Descripción', valor: (f) => f.descripcion },
      { titulo: 'Existencia', valor: (f) => f.existencia, num: true },
      { titulo: 'Costo promedio', valor: (f) => f.costoPromedio, num: true, moneda: true },
      { titulo: 'Valor', valor: (f) => f.valor, num: true, moneda: true },
    ],
    total: (filas) => `Valor total ${fmtMoneda(filas.reduce((s, f) => s + f.valor, 0))}`,
  }),
  def({
    clave: 'mermas',
    titulo: 'Mermas y ajustes',
    descripcion: 'Toda baja de inventario por merma, daño, robo, ajuste negativo o incidencia de transferencia, con quién la capturó y quién la aprobó.',
    permiso: 'reportes.ver',
    cargar: api.reportes.mermas,
    columnas: [
      { titulo: 'Fecha', valor: (f) => f.fecha, mostrar: (f) => fmtFechaHora(f.fecha) },
      { titulo: 'Folio', valor: (f) => f.folio, mostrar: (f) => <Folio folio={f.folio} a={rutaPorFolio(f.folio, f.documentoId)} /> },
      { titulo: 'Almacén', valor: (f) => f.almacen },
      { titulo: 'Motivo', valor: (f) => f.motivo },
      { titulo: 'Capturó', valor: (f) => f.usuario },
      { titulo: 'Aprobó', valor: (f) => f.aprobadores },
      { titulo: 'Cantidad', valor: (f) => f.cantidad, num: true },
      { titulo: 'Valor', valor: (f) => f.valor, num: true, moneda: true },
    ],
    total: (filas) => `Merma total ${fmtMoneda(filas.reduce((s, f) => s + f.valor, 0))}`,
  }),
  def({
    clave: 'discrepancias',
    titulo: 'Discrepancias',
    descripcion: 'Transferencias donde lo recibido no coincidió con lo enviado, y cómo se resolvió cada una.',
    permiso: 'reportes.ver',
    cargar: api.reportes.discrepancias,
    columnas: [
      { titulo: 'Folio', valor: (f) => f.folio, mostrar: (f) => <Folio folio={f.folio} a={`/transferencias/${f.documentoId}`} /> },
      { titulo: 'Ruta', valor: (f) => `${f.origen} → ${f.destino}` },
      { titulo: 'Transportista', valor: (f) => f.transportista },
      { titulo: 'Diferencia (piezas)', valor: (f) => f.diferenciaPiezas, num: true },
      { titulo: 'Diferencia (valor)', valor: (f) => f.diferenciaValor, num: true, moneda: true },
      { titulo: 'Estado', valor: (f) => f.estado, mostrar: (f) => <Estado tono={f.estado === 'ABIERTA' ? 'error' : 'ok'}>{f.estado === 'ABIERTA' ? 'Abierta' : 'Resuelta'}</Estado> },
      { titulo: 'Resolución', valor: (f) => f.resolucion },
    ],
  }),
  def({
    clave: 'conciliacion',
    titulo: 'Conciliación',
    descripcion: 'Comprueba que la existencia registrada sea igual a la suma de todos sus movimientos. Cualquier diferencia indica una alteración fuera de los documentos.',
    permiso: 'reportes.ver',
    cargar: api.reportes.conciliacion,
    columnas: [
      { titulo: 'Almacén', valor: (f) => f.almacen },
      { titulo: 'SKU', valor: (f) => f.sku },
      { titulo: 'Existencia registrada', valor: (f) => f.existenciaRegistrada, num: true },
      { titulo: 'Suma de movimientos', valor: (f) => f.sumaMovimientos, num: true },
      {
        titulo: 'Diferencia',
        valor: (f) => f.diferencia,
        num: true,
        mostrar: (f) => (f.diferencia === 0 ? <span className="suave">0</span> : <strong style={{ color: 'var(--error-700)' }}>{fmtNumero(f.diferencia)}</strong>),
      },
    ],
    resumen: (filas) => {
      const malas = filas.filter((f) => f.diferencia !== 0).length;
      return malas === 0 ? (
        <div className="banda banda--ok">
          <CircleCheck aria-hidden />
          <div>
            <strong>Sin diferencias</strong>
            Los {filas.length} saldos coinciden con la suma de sus movimientos.
          </div>
        </div>
      ) : (
        <div className="banda banda--error">
          <TriangleAlert aria-hidden />
          <div>
            <strong>{malas} saldo(s) no cuadran</strong>
            Revisa la bitácora de esos productos: el saldo cambió sin un documento que lo respalde.
          </div>
        </div>
      );
    },
  }),
  def({
    clave: 'fuera-horario',
    titulo: 'Fuera de horario',
    descripcion: 'Movimientos registrados de lunes a sábado fuera de 07:00 a 20:00 (hora de Ciudad de México) o en domingo.',
    permiso: 'reportes.ver',
    cargar: api.reportes.fueraHorario,
    columnas: [
      { titulo: 'Fecha y hora', valor: (f) => f.fecha, mostrar: (f) => fmtFechaHora(f.fecha) },
      { titulo: 'Folio', valor: (f) => f.folio },
      { titulo: 'Acción', valor: (f) => f.accion },
      { titulo: 'Usuario', valor: (f) => f.usuario },
      { titulo: 'Almacén', valor: (f) => f.almacen },
    ],
  }),
  def({
    clave: 'top-usuarios',
    titulo: 'Usuarios con más ajustes',
    descripcion: 'Los 10 usuarios con más ajustes, cancelaciones o rechazos y el valor de sus ajustes negativos.',
    permiso: 'reportes.ver',
    cargar: api.reportes.topUsuarios,
    columnas: [
      { titulo: 'Usuario', valor: (f) => f.usuario },
      { titulo: 'Ajustes', valor: (f) => f.ajustes, num: true },
      { titulo: 'Cancelaciones', valor: (f) => f.cancelaciones, num: true },
      { titulo: 'Rechazos recibidos', valor: (f) => f.rechazos, num: true },
      { titulo: 'Valor de ajustes negativos', valor: (f) => f.valorAjustesNeg, num: true, moneda: true },
    ],
  }),
  def({
    clave: 'folios',
    titulo: 'Folios',
    descripcion: 'Los folios son consecutivos y nunca se reutilizan. Un hueco en la serie indicaría un documento eliminado (RN-08).',
    permiso: 'reportes.ver',
    cargar: api.reportes.folios,
    columnas: [
      { titulo: 'Serie', valor: (f) => f.serie },
      { titulo: 'Folios emitidos', valor: (f) => f.emitidos, num: true },
      { titulo: 'Faltantes', valor: (f) => f.faltantes.length, num: true, mostrar: (f) => (f.faltantes.length ? <strong style={{ color: 'var(--error-700)' }}>{f.faltantes.join(', ')}</strong> : <span className="suave">Ninguno</span>) },
    ],
  }),
];

export function ReportesPage() {
  const usuario = useUsuario();
  const [params, setParams] = useSearchParams();
  const disponibles = REPORTES.filter((r) => puede(usuario, r.permiso));
  const pestanas = [...disponibles.map((r) => ({ valor: r.clave, texto: r.titulo })), ...(puede(usuario, 'reportes.ver') || puede(usuario, 'periodo.cerrar') ? [{ valor: 'periodos', texto: 'Periodos' }] : [])];
  const actual = pestanas.some((p) => p.valor === params.get('pestana')) ? params.get('pestana')! : (pestanas[0]?.valor ?? '');
  const reporte = disponibles.find((r) => r.clave === actual);

  return (
    <>
      <Cabecera titulo="Reportes" descripcion="Cada exportación o impresión queda registrada en la bitácora con el hash del archivo generado." />
      <section className="panel">
        <Pestanas etiqueta="Reportes" actual={actual} cambiar={(v) => setParams({ pestana: v }, { replace: true })} opciones={pestanas} />
        {reporte ? <VistaReporte key={reporte.clave} r={reporte} /> : actual === 'periodos' ? <Periodos /> : null}
      </section>
    </>
  );
}

function VistaReporte({ r }: { r: DefReporte<unknown> }) {
  const { datos, error, cargando, recargar } = useConsulta(() => r.cargar(), [r.clave]);
  const filas = useMemo(() => datos ?? [], [datos]);
  const exportables = filas.map((f) => r.columnas.map((c) => c.valor(f)));
  return (
    <>
      <div className="panel__cuerpo fila fila--entre">
        <p className="suave" style={{ maxWidth: '72ch' }}>
          {r.descripcion}
        </p>
        <div className="fila no-imprimir">
          <BotonExportarCsv reporte={r.clave} nombreArchivo={`reporte_${r.clave}`} encabezados={r.columnas.map((c) => c.titulo)} filas={exportables} />
          <BotonImprimir reporte={r.clave} contenidoParaHash={JSON.stringify(exportables)} />
        </div>
      </div>
      {error && <ErrorCarga error={error} reintentar={recargar} />}
      {cargando && !datos ? (
        <Cargando />
      ) : !filas.length ? (
        <Vacio titulo="Sin registros" />
      ) : (
        <>
          {r.resumen && <div className="panel__cuerpo" style={{ paddingTop: 0 }}>{r.resumen(filas)}</div>}
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  {r.columnas.map((c) => (
                    <th key={c.titulo} scope="col" className={c.num ? 'num' : undefined}>
                      {c.titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={i}>
                    {r.columnas.map((c) => {
                      const v = c.valor(f);
                      return (
                        <td key={c.titulo} className={c.num ? 'num' : undefined}>
                          {c.mostrar ? c.mostrar(f) : c.moneda ? fmtMoneda(v as number) : c.num ? fmtNumero(v as number) : (v ?? '—')}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {r.total && (
                <tfoot>
                  <tr>
                    <td colSpan={r.columnas.length} className="num">
                      {r.total(filas)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Periodos() {
  const usuario = useUsuario();
  const { avisar } = useAvisos();
  const { datos, error, cargando, recargar } = useConsulta(() => api.periodos.listar(), []);
  const [accion, setAccion] = useState<{ p: Periodo; tipo: 'cerrar' | 'reabrir' | 'aprobar' | 'rechazar' } | null>(null);
  const mesActual = new Date().toISOString().slice(0, 7);
  const nombreMes = (clave: string) => {
    const [a, m] = clave.split('-').map(Number);
    return new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(a!, m! - 1, 1)));
  };

  return (
    <>
      <p className="panel__cuerpo suave" style={{ maxWidth: '72ch' }}>
        Al cerrar un mes ya no se aceptan movimientos con fecha de ese mes. Reabrirlo lo solicita Contabilidad y lo autoriza Gerencia.
      </p>
      {error && <ErrorCarga error={error} reintentar={recargar} />}
      {cargando && !datos ? (
        <Cargando />
      ) : (
        <div className="tabla-contenedor">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Periodo</th>
                <th scope="col">Estado</th>
                <th scope="col">Cerró</th>
                <th scope="col" className="acciones"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {(datos ?? []).map((p) => (
                <tr key={p.clave}>
                  <td style={{ textTransform: 'capitalize' }}>{nombreMes(p.clave)}</td>
                  <td>
                    {p.estado === 'CERRADO' ? (
                      <Estado tono="neutro">
                        <Lock size={12} aria-hidden /> Cerrado
                      </Estado>
                    ) : p.estado === 'REAPERTURA_SOLICITADA' ? (
                      <Estado tono="alerta">Reapertura solicitada</Estado>
                    ) : (
                      <Estado tono="ok">Abierto</Estado>
                    )}
                    {p.solicitudReapertura && <span className="tabla__secundario">{p.solicitudReapertura.usuario}: {p.solicitudReapertura.motivo}</span>}
                  </td>
                  <td>{p.cerradoPor ? `${p.cerradoPor.usuario.nombre}, ${fmtFechaHora(p.cerradoPor.fecha)}` : '—'}</td>
                  <td className="acciones">
                    {puede(usuario, 'periodo.cerrar') && p.estado === 'ABIERTO' && p.clave < mesActual && (
                      <Boton tamano="sm" onClick={() => setAccion({ p, tipo: 'cerrar' })}>
                        Cerrar periodo
                      </Boton>
                    )}
                    {puede(usuario, 'periodo.cerrar') && p.estado === 'CERRADO' && (
                      <Boton tamano="sm" variante="fantasma" onClick={() => setAccion({ p, tipo: 'reabrir' })}>
                        Solicitar reapertura
                      </Boton>
                    )}
                    {puede(usuario, 'periodo.aprobar') && p.estado === 'REAPERTURA_SOLICITADA' && (
                      <>
                        <Boton tamano="sm" variante="primario" onClick={() => setAccion({ p, tipo: 'aprobar' })}>
                          Autorizar reapertura
                        </Boton>
                        <Boton tamano="sm" onClick={() => setAccion({ p, tipo: 'rechazar' })}>
                          Mantener cerrado
                        </Boton>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DialogoConfirmacion
        abierto={!!accion}
        titulo={accion ? { cerrar: 'Cerrar', reabrir: 'Solicitar reapertura de', aprobar: 'Autorizar reapertura de', rechazar: 'Mantener cerrado' }[accion.tipo] + ` ${nombreMes(accion.p.clave)}` : ''}
        descripcion={
          accion?.tipo === 'cerrar'
            ? 'Después de cerrar, ningún documento podrá registrarse con fecha de este mes.'
            : accion?.tipo === 'reabrir'
              ? 'Gerencia revisará la solicitud. Mientras tanto el periodo sigue cerrado.'
              : 'La decisión queda en la bitácora con tu usuario.'
        }
        textoConfirmar={accion ? { cerrar: 'Cerrar periodo', reabrir: 'Enviar solicitud', aprobar: 'Autorizar', rechazar: 'Mantener cerrado' }[accion.tipo] : ''}
        motivoMinimo={accion?.tipo === 'reabrir' ? 30 : 0}
        etiquetaMotivo="Motivo de la reapertura"
        pedirPassword={accion?.tipo === 'aprobar' || accion?.tipo === 'rechazar'}
        alCerrar={() => setAccion(null)}
        alConfirmar={async (v) => {
          const a = accion!;
          if (a.tipo === 'cerrar') await api.periodos.cerrar(a.p.clave);
          else if (a.tipo === 'reabrir') await api.periodos.solicitarReapertura(a.p.clave, v.motivo);
          else await api.periodos.resolverReapertura(a.p.clave, a.tipo === 'aprobar', v.password);
          avisar('exito', 'Periodo actualizado.');
          setAccion(null);
          void recargar();
        }}
      />
    </>
  );
}
