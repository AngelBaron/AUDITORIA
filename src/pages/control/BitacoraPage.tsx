import { Fragment, useState, type FormEvent } from 'react';
import { ChevronRight, Download, Filter, ShieldCheck, ShieldX } from 'lucide-react';
import { api } from '@/api/cliente';
import type { EventoBitacora, FiltrosBitacora, Severidad, VerificacionCadena } from '@/api/types';
import { useAvisos } from '@/components/Avisos';
import { Boton, Cabecera, Campo, Cargando, ErrorCarga, Estado, Paginacion, Vacio } from '@/components/ui';
import type { Tono } from '@/domain/estados';
import { fmtFechaHoraSeg } from '@/domain/formato';
import { descargarArchivo, generarCsv, sha256Hex } from '@/domain/seguridad';
import { useConsulta } from '@/hooks/useConsulta';

const TONO_SEV: Record<Severidad, Tono> = { INFO: 'neutro', MEDIA: 'alerta', ALTA: 'error', CRITICA: 'error' };
const FILTROS_VACIOS: FiltrosBitacora = { desde: '', hasta: '', usuario: '', accion: '', folio: '', almacen: '', resultado: '', severidad: '', ip: '' };

export function BitacoraPage() {
  const { avisar, avisarError } = useAvisos();
  const [borrador, setBorrador] = useState<FiltrosBitacora>(FILTROS_VACIOS);
  const [filtros, setFiltros] = useState<FiltrosBitacora>(FILTROS_VACIOS);
  const [pagina, setPagina] = useState(1);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [verificacion, setVerificacion] = useState<VerificacionCadena | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const { datos, error, cargando, recargar } = useConsulta(() => api.bitacora.consultar({ ...filtros, pagina }), [filtros, pagina]);

  const aplicar = (e: FormEvent) => {
    e.preventDefault();
    setPagina(1);
    setFiltros({ ...borrador });
  };

  const verificar = async () => {
    setVerificando(true);
    try {
      setVerificacion(await api.bitacora.verificar());
    } catch (e) {
      avisarError(e);
    } finally {
      setVerificando(false);
    }
  };

  const exportar = async () => {
    setExportando(true);
    try {
      const { eventos } = await api.bitacora.exportar(filtros);
      const csv = generarCsv(
        ['id', 'fecha_hora_utc', 'usuario', 'roles', 'ip', 'user_agent', 'sesion', 'correlacion', 'accion', 'entidad', 'folio', 'almacen', 'resultado', 'motivo_rechazo', 'severidad', 'valor_anterior', 'valor_nuevo', 'hash_anterior', 'hash_actual'],
        eventos.map((e) => [e.id, e.fechaHoraUtc, e.usuarioNombre, e.rolesActivos.join('|'), e.ipOrigen, e.userAgent, e.idSesionHash, e.idCorrelacion, e.accion, e.entidad, e.folio, e.almacen, e.resultado, e.motivoRechazo, e.severidad, JSON.stringify(e.valorAnterior), JSON.stringify(e.valorNuevo), e.hashAnterior, e.hashActual]),
      );
      const hash = await sha256Hex(csv);
      descargarArchivo(`bitacora_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
      avisar('exito', `Exportaste ${eventos.length} eventos. SHA-256 del archivo: ${hash.slice(0, 16)}…`);
      void recargar();
    } catch (e) {
      avisarError(e);
    } finally {
      setExportando(false);
    }
  };

  const campo = (k: keyof FiltrosBitacora, etiqueta: string, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <Campo etiqueta={etiqueta}>
      {(p) => <input {...p} className="entrada" maxLength={60} value={String(borrador[k] ?? '')} onChange={(e) => setBorrador({ ...borrador, [k]: e.target.value })} {...extra} />}
    </Campo>
  );

  return (
    <>
      <Cabecera
        titulo="Bitácora de auditoría"
        descripcion="Registro de solo inserción: quién hizo qué, cuándo, desde qué IP y con qué resultado. Cada evento se encadena con SHA-256 al anterior; alterar uno rompe la cadena."
        acciones={
          <>
            <Boton icono={<ShieldCheck aria-hidden />} cargando={verificando} onClick={verificar}>
              Verificar integridad
            </Boton>
            <Boton icono={<Download aria-hidden />} cargando={exportando} onClick={exportar}>
              Exportar CSV
            </Boton>
          </>
        }
      />
      {verificacion && (
        <div className={`banda ${verificacion.integra ? 'banda--ok' : 'banda--error'}`} role="status" style={{ marginBottom: 20 }}>
          {verificacion.integra ? <ShieldCheck aria-hidden /> : <ShieldX aria-hidden />}
          <div>
            <strong>{verificacion.integra ? 'Cadena íntegra' : `Cadena rota en el evento ${verificacion.primerEslabonRoto}`}</strong>
            {verificacion.integra
              ? `Se recalcularon los hashes de ${verificacion.eventosVerificados} eventos y todos coinciden.`
              : `Los eventos a partir del ${verificacion.primerEslabonRoto} fueron alterados o eliminados. Se generó una alerta crítica.`}{' '}
            Verificado el {fmtFechaHoraSeg(verificacion.verificadoEn)}.
          </div>
        </div>
      )}
      <section className="panel">
        <form className="filtros" onSubmit={aplicar} role="search">
          {campo('desde', 'Desde', { type: 'date' })}
          {campo('hasta', 'Hasta', { type: 'date' })}
          {campo('usuario', 'Usuario')}
          {campo('accion', 'Acción', { placeholder: 'p. ej. APROBAR' })}
          {campo('folio', 'Folio')}
          {campo('ip', 'IP')}
          <Campo etiqueta="Almacén">
            {(p) => (
              <select {...p} className="entrada" value={borrador.almacen} onChange={(e) => setBorrador({ ...borrador, almacen: e.target.value })}>
                <option value="">Todos</option>
                {['CEN', 'NTE', 'CTR', 'SUR', 'TRANSITO'].map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            )}
          </Campo>
          <Campo etiqueta="Resultado">
            {(p) => (
              <select {...p} className="entrada" value={borrador.resultado} onChange={(e) => setBorrador({ ...borrador, resultado: e.target.value })}>
                <option value="">Todos</option>
                <option value="EXITO">Éxito</option>
                <option value="RECHAZADO">Rechazado</option>
                <option value="ERROR">Error</option>
              </select>
            )}
          </Campo>
          <Campo etiqueta="Severidad">
            {(p) => (
              <select {...p} className="entrada" value={borrador.severidad} onChange={(e) => setBorrador({ ...borrador, severidad: e.target.value })}>
                <option value="">Todas</option>
                <option value="INFO">Info</option>
                <option value="MEDIA">Media</option>
                <option value="ALTA">Alta</option>
                <option value="CRITICA">Crítica</option>
              </select>
            )}
          </Campo>
          <div className="fila" style={{ paddingBottom: 2 }}>
            <Boton type="submit" variante="primario" icono={<Filter aria-hidden />}>
              Aplicar filtros
            </Boton>
            <Boton
              variante="fantasma"
              onClick={() => {
                setBorrador(FILTROS_VACIOS);
                setFiltros(FILTROS_VACIOS);
                setPagina(1);
              }}
            >
              Limpiar
            </Boton>
          </div>
        </form>
        <p className="pequeno suave" style={{ padding: '10px 20px 0' }}>
          Tu consulta también queda registrada en la bitácora.
        </p>
        {error && <ErrorCarga error={error} reintentar={recargar} />}
        {cargando && !datos ? (
          <Cargando filas={8} />
        ) : !datos?.datos.length ? (
          <Vacio titulo="Sin eventos con estos filtros" />
        ) : (
          <>
            <div className="tabla-contenedor">
              <table className="tabla">
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">Detalle</span></th>
                    <th scope="col">#</th>
                    <th scope="col">Fecha y hora</th>
                    <th scope="col">Usuario</th>
                    <th scope="col">IP</th>
                    <th scope="col">Acción</th>
                    <th scope="col">Objeto</th>
                    <th scope="col">Resultado</th>
                    <th scope="col">Severidad</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.datos.map((e) => (
                    <Fragment key={e.id}>
                      <tr>
                        <td>
                          <button
                            type="button"
                            className="btn btn--fantasma btn--icono"
                            aria-expanded={abierto === e.id}
                            aria-label={`Ver detalle del evento ${e.id}`}
                            onClick={() => setAbierto(abierto === e.id ? null : e.id)}
                          >
                            <ChevronRight size={16} aria-hidden style={{ transform: abierto === e.id ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />
                          </button>
                        </td>
                        <td className="codigo">{e.id}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtFechaHoraSeg(e.fechaHoraUtc)}</td>
                        <td>
                          {e.usuarioNombre}
                          {e.rolesActivos.length > 0 && <span className="tabla__secundario">{e.rolesActivos.join(', ')}</span>}
                        </td>
                        <td className="codigo">{e.ipOrigen}</td>
                        <td className="codigo">{e.accion}</td>
                        <td>
                          {e.folio ?? e.entidad}
                          {e.almacen && <span className="tabla__secundario">{e.almacen}</span>}
                        </td>
                        <td>
                          <Estado tono={e.resultado === 'EXITO' ? 'ok' : 'error'}>{e.resultado === 'EXITO' ? 'Éxito' : e.resultado === 'RECHAZADO' ? 'Rechazado' : 'Error'}</Estado>
                          {e.motivoRechazo && <span className="tabla__secundario">{e.motivoRechazo}</span>}
                        </td>
                        <td>
                          <Estado tono={TONO_SEV[e.severidad]}>{e.severidad}</Estado>
                        </td>
                      </tr>
                      {abierto === e.id && (
                        <tr>
                          <td colSpan={9} style={{ background: '#f7f9fa' }}>
                            <DetalleEvento e={e} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={datos.pagina} porPagina={datos.porPagina} total={datos.total} cambiar={setPagina} />
          </>
        )}
      </section>
    </>
  );
}

function DetalleEvento({ e }: { e: EventoBitacora }) {
  return (
    <div className="dos-columnas" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <dl className="lista-datos">
        <dt>UUID</dt>
        <dd className="codigo">{e.uuid}</dd>
        <dt>Correlación</dt>
        <dd className="codigo">{e.idCorrelacion}</dd>
        <dt>Sesión (hash)</dt>
        <dd className="codigo">{e.idSesionHash ?? '—'}</dd>
        <dt>Navegador</dt>
        <dd>{e.userAgent}</dd>
        <dt>Hash anterior</dt>
        <dd className="codigo" style={{ wordBreak: 'break-all' }}>{e.hashAnterior}</dd>
        <dt>Hash actual</dt>
        <dd className="codigo" style={{ wordBreak: 'break-all' }}>{e.hashActual}</dd>
      </dl>
      <div className="pila pila--estrecha">
        <p className="pequeno suave">Valor anterior</p>
        <pre className="bloque-json">{e.valorAnterior ? JSON.stringify(e.valorAnterior, null, 2) : '—'}</pre>
        <p className="pequeno suave">Valor nuevo</p>
        <pre className="bloque-json">{e.valorNuevo ? JSON.stringify(e.valorNuevo, null, 2) : '—'}</pre>
      </div>
    </div>
  );
}
