import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { api } from '@/api/cliente';
import { useUsuario } from '@/auth/AuthContext';
import { TablaDocumentos } from '@/components/documentos';
import { Cabecera, Cargando, ErrorCarga, Estado, Folio, Vacio } from '@/components/ui';
import { fmtMoneda, fmtMonedaCorta, fmtPorcentaje, fmtRelativo } from '@/domain/formato';
import { puede } from '@/domain/permisos';
import { useConsulta } from '@/hooks/useConsulta';

export function InicioPage() {
  const usuario = useUsuario();
  const tablero = useConsulta(() => api.tablero(), []);
  const bandeja = useConsulta(() => api.bandeja(), []);
  const t = tablero.datos;
  const nombre = usuario.nombre.split(' ')[0];
  const hoy = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <>
      <Cabecera titulo={`Hola, ${nombre}`} descripcion={`${hoy.charAt(0).toUpperCase()}${hoy.slice(1)}. Esto es lo que pasa en tus almacenes.`} />

      {tablero.error && <ErrorCarga error={tablero.error} reintentar={tablero.recargar} />}
      {t && (
        <div className="indicadores">
          <Link to="/bandeja" className="indicador" data-tono={t.pendientesMios > 0 ? 'senal' : undefined}>
            <span className="indicador__valor">{t.pendientesMios}</span>
            <span className="indicador__etiqueta">Pendientes que te tocan</span>
          </Link>
          {puede(usuario, 'transferencia.ver') && (
            <Link to="/transferencias?estado=EN_TRANSITO" className="indicador">
              <span className="indicador__valor">{t.enTransito}</span>
              <span className="indicador__etiqueta">Transferencias en tránsito</span>
            </Link>
          )}
          {puede(usuario, 'transferencia.ver') && (
            <Link to="/transferencias?estado=CON_DISCREPANCIA" className="indicador" data-tono={t.discrepanciasAbiertas > 0 ? 'error' : undefined}>
              <span className="indicador__valor">{t.discrepanciasAbiertas}</span>
              <span className="indicador__etiqueta">Discrepancias abiertas</span>
            </Link>
          )}
          {t.valorInventario != null && (
            <div className="indicador">
              <span className="indicador__valor">{fmtMonedaCorta(t.valorInventario)}</span>
              <span className="indicador__etiqueta">Valor del inventario</span>
            </div>
          )}
          {t.mermaMes != null && (
            <div className="indicador" data-tono={t.mermaMes > 0 ? 'error' : undefined}>
              <span className="indicador__valor">{fmtMonedaCorta(t.mermaMes)}</span>
              <span className="indicador__etiqueta">Merma del mes</span>
            </div>
          )}
          {puede(usuario, 'conteo.ver') && (
            <Link to="/conteos" className="indicador">
              <span className="indicador__valor">{fmtPorcentaje(t.ira)}</span>
              <span className="indicador__etiqueta">Exactitud de inventario (IRA)</span>
            </Link>
          )}
          {puede(usuario, 'hallazgos.ver') && (
            <Link to="/hallazgos" className="indicador" data-tono={t.hallazgosAbiertos > 0 ? 'error' : undefined}>
              <span className="indicador__valor">{t.hallazgosAbiertos}</span>
              <span className="indicador__etiqueta">Hallazgos sin cerrar</span>
            </Link>
          )}
        </div>
      )}
      {tablero.cargando && !t && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <Cargando filas={2} />
        </div>
      )}

      <div className="dos-columnas">
        <section className="panel" aria-labelledby="t-recientes">
          <div className="panel__cabecera">
            <h2 id="t-recientes" className="panel__titulo">
              Movimientos recientes
            </h2>
          </div>
          {tablero.cargando && !t ? (
            <Cargando />
          ) : (
            <TablaDocumentos
              documentos={t?.recientes ?? []}
              mostrarTipo
              compacta
              vacio={<Vacio titulo="Sin movimientos todavía">Los documentos que crees o que te toquen aparecerán aquí.</Vacio>}
            />
          )}
        </section>

        <div className="pila">
          <section className="panel" aria-labelledby="t-tocan">
            <div className="panel__cabecera">
              <h2 id="t-tocan" className="panel__titulo">
                Te toca
              </h2>
              <Link to="/bandeja" className="btn btn--fantasma btn--sm">
                Ver todo
              </Link>
            </div>
            {bandeja.cargando && !bandeja.datos ? (
              <Cargando filas={3} />
            ) : bandeja.datos?.length ? (
              <ul className="lista-limpia">
                {bandeja.datos.slice(0, 6).map((b) => (
                  <li key={`${b.tipo}-${b.id}`}>
                    <Link to={b.ruta} className="pendiente">
                      <span className="pendiente__titulo">
                        {b.titulo}
                        {b.urgente && <Estado tono="error">Prioritario</Estado>}
                      </span>
                      <span className="pendiente__detalle">
                        {b.folio && <Folio folio={b.folio} />} {b.detalle}
                      </span>
                      <span className="pendiente__fecha">{fmtRelativo(b.fecha)}</span>
                      <ArrowRight size={16} className="pendiente__flecha" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Vacio titulo="Nada pendiente">Cuando un documento necesite tu aprobación, surtido o recepción, aparecerá aquí.</Vacio>
            )}
          </section>

          {t?.mermaPorAlmacen && (
            <section className="panel" aria-labelledby="t-merma">
              <div className="panel__cabecera">
                <h2 id="t-merma" className="panel__titulo">
                  Merma del mes por almacén
                </h2>
              </div>
              <div className="panel__cuerpo pila pila--estrecha">
                {t.mermaPorAlmacen.map((m) => {
                  const max = Math.max(1, ...t.mermaPorAlmacen!.map((x) => x.valor));
                  return (
                    <div key={m.almacen}>
                      <div className="fila fila--entre pequeno">
                        <span className="codigo">{m.almacen}</span>
                        <span>{fmtMoneda(m.valor)}</span>
                      </div>
                      <div className="barra-progreso" role="img" aria-label={`${m.almacen}: ${fmtMoneda(m.valor)}`}>
                        <span style={{ width: `${(m.valor / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
