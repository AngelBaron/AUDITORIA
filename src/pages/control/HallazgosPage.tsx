import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { api } from '@/api/cliente';
import type { EstadoHallazgo, Hallazgo } from '@/api/types';
import { useUsuario } from '@/auth/AuthContext';
import { useAvisos } from '@/components/Avisos';
import { DialogoConfirmacion } from '@/components/Dialogo';
import { Boton, Cabecera, Cargando, ErrorCarga, Estado, Pestanas, Vacio } from '@/components/ui';
import { ESTADO_HALLAZGO } from '@/domain/estados';
import { fmtFechaHora } from '@/domain/formato';
import { puede } from '@/domain/permisos';
import { useConsulta } from '@/hooks/useConsulta';

type Vista = 'abiertos' | 'revision' | 'cerrados';
const CATEGORIA = { SEGURIDAD: 'Seguridad', FRAUDE: 'Posible fraude', INTEGRIDAD: 'Integridad' } as const;

export function HallazgosPage() {
  const usuario = useUsuario();
  const gestionar = puede(usuario, 'hallazgos.gestionar');
  const { avisar } = useAvisos();
  const [params] = useSearchParams();
  const resaltar = params.get('id');
  const { datos, error, cargando, recargar } = useConsulta(() => api.hallazgos.listar(), []);
  const [vista, setVista] = useState<Vista>('abiertos');
  const [cambio, setCambio] = useState<{ h: Hallazgo; estado: EstadoHallazgo } | null>(null);

  useEffect(() => {
    if (resaltar && datos) document.getElementById(`h-${resaltar}`)?.scrollIntoView({ block: 'center' });
  }, [resaltar, datos]);

  const filtro = (h: Hallazgo) => (vista === 'abiertos' ? h.estado === 'ABIERTO' : vista === 'revision' ? h.estado === 'EN_REVISION' || h.estado === 'ESCALADO' : h.estado === 'JUSTIFICADO');
  const lista = (datos ?? []).filter(filtro);
  const contar = (v: Vista) => (datos ?? []).filter((h) => (v === 'abiertos' ? h.estado === 'ABIERTO' : v === 'revision' ? h.estado === 'EN_REVISION' || h.estado === 'ESCALADO' : h.estado === 'JUSTIFICADO')).length;

  return (
    <>
      <Cabecera
        titulo="Hallazgos y alertas"
        descripcion="Patrones detectados automáticamente: intentos de acceso, violaciones de segregación, fraccionamiento de salidas, discrepancias repetidas y cambios de parámetros. Cada cambio de estado queda en bitácora."
      />
      <section className="panel">
        <Pestanas<Vista>
          etiqueta="Estado de los hallazgos"
          actual={vista}
          cambiar={setVista}
          opciones={[
            { valor: 'abiertos', texto: 'Abiertos', contador: contar('abiertos') },
            { valor: 'revision', texto: 'En revisión o escalados', contador: contar('revision') },
            { valor: 'cerrados', texto: 'Justificados', contador: contar('cerrados') },
          ]}
        />
        {error && <ErrorCarga error={error} reintentar={recargar} />}
        {cargando && !datos ? (
          <Cargando />
        ) : lista.length === 0 ? (
          <Vacio titulo="Nada en esta vista">Los hallazgos nuevos aparecen en "Abiertos" en cuanto el sistema los detecta.</Vacio>
        ) : (
          <ul className="lista-limpia">
            {lista.map((h) => (
              <li key={h.id} id={`h-${h.id}`} className={`hallazgo${resaltar === h.id ? ' hallazgo--resaltado' : ''}`}>
                <div className="fila fila--entre">
                  <div className="fila" style={{ gap: 8 }}>
                    <ShieldAlert size={18} aria-hidden />
                    <h2 className="hallazgo__titulo">{h.titulo}</h2>
                  </div>
                  <div className="fila" style={{ gap: 6 }}>
                    <Estado tono={h.severidad === 'CRITICA' || h.severidad === 'ALTA' ? 'error' : 'alerta'}>Severidad {h.severidad.toLowerCase()}</Estado>
                    <Estado tono={ESTADO_HALLAZGO[h.estado].tono}>{ESTADO_HALLAZGO[h.estado].texto}</Estado>
                  </div>
                </div>
                <p className="pequeno">{h.detalle}</p>
                <p className="pequeno suave">
                  {CATEGORIA[h.categoria]}, regla {h.regla}, detectado el {fmtFechaHora(h.fecha)}.
                </p>
                {h.historial.length > 1 && (
                  <ol className="linea-tiempo" style={{ marginTop: 8 }}>
                    {h.historial.slice(1).map((x, i) => (
                      <li key={i}>
                        <span className="linea-tiempo__accion">{ESTADO_HALLAZGO[x.estado].texto}</span>
                        <span className="linea-tiempo__meta">{x.comentario}</span>
                        <span className="linea-tiempo__meta">
                          {fmtFechaHora(x.fecha)}, {x.usuario}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                {gestionar && (
                  <div className="fila" style={{ marginTop: 10 }}>
                    {h.estado === 'ABIERTO' && (
                      <Boton tamano="sm" variante="primario" onClick={() => setCambio({ h, estado: 'EN_REVISION' })}>
                        Tomar para revisión
                      </Boton>
                    )}
                    {h.estado === 'EN_REVISION' && (
                      <>
                        <Boton tamano="sm" onClick={() => setCambio({ h, estado: 'JUSTIFICADO' })}>
                          Justificar y cerrar
                        </Boton>
                        <Boton tamano="sm" variante="peligro" onClick={() => setCambio({ h, estado: 'ESCALADO' })}>
                          Escalar
                        </Boton>
                      </>
                    )}
                    {h.estado === 'ESCALADO' && (
                      <Boton tamano="sm" onClick={() => setCambio({ h, estado: 'EN_REVISION' })}>
                        Retomar revisión
                      </Boton>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <DialogoConfirmacion
        abierto={!!cambio}
        titulo={cambio ? `${ESTADO_HALLAZGO[cambio.estado].texto}: ${cambio.h.titulo}` : ''}
        descripcion={cambio?.estado === 'JUSTIFICADO' ? 'Explica por qué no representa un riesgo y qué evidencia revisaste.' : cambio?.estado === 'ESCALADO' ? 'Indica a quién se escala y qué se encontró.' : 'Indica qué vas a revisar.'}
        textoConfirmar={cambio ? ESTADO_HALLAZGO[cambio.estado].texto : ''}
        peligro={cambio?.estado === 'ESCALADO'}
        motivoMinimo={15}
        etiquetaMotivo="Comentario"
        alCerrar={() => setCambio(null)}
        alConfirmar={async (v) => {
          await api.hallazgos.actualizar(cambio!.h.id, cambio!.estado, v.motivo);
          avisar('exito', 'Hallazgo actualizado.');
          setCambio(null);
          void recargar();
        }}
      />
    </>
  );
}
