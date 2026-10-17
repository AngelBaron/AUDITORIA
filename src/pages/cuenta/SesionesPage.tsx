import { MonitorSmartphone } from 'lucide-react';
import { api } from '@/api/cliente';
import { useUsuario } from '@/auth/AuthContext';
import { useAvisos } from '@/components/Avisos';
import { Boton, Cabecera, Cargando, ErrorCarga, Estado } from '@/components/ui';
import { fmtFechaHora, fmtRelativo } from '@/domain/formato';
import { useConsulta } from '@/hooks/useConsulta';

export function SesionesPage() {
  const usuario = useUsuario();
  const { avisar, avisarError } = useAvisos();
  const { datos, error, cargando, recargar } = useConsulta(() => api.auth.sesiones(), []);

  return (
    <div style={{ maxWidth: 820 }}>
      <Cabecera titulo="Mis sesiones" descripcion="Puedes tener hasta 2 sesiones abiertas. Si no reconoces una, ciérrala y cambia tu contraseña." />
      {usuario.intentosFallidosDesdeUltimo > 0 && (
        <div className="banda banda--accion" role="status" style={{ marginBottom: 20 }}>
          <div>
            <strong>Hubo {usuario.intentosFallidosDesdeUltimo} intento(s) fallido(s) de inicio de sesión con tu cuenta desde tu último acceso.</strong>
            Si no fuiste tú, cambia tu contraseña y avisa a Seguridad de la información.
          </div>
        </div>
      )}
      <section className="panel">
        {error && <ErrorCarga error={error} reintentar={recargar} />}
        {cargando && !datos ? (
          <Cargando filas={2} />
        ) : (
          <ul className="lista-limpia">
            {(datos ?? []).map((s) => (
              <li key={s.id} className="hallazgo">
                <div className="fila fila--entre">
                  <span className="fila" style={{ gap: 10 }}>
                    <MonitorSmartphone size={20} aria-hidden />
                    <span>
                      <strong>{s.dispositivo}</strong>
                      <span className="tabla__secundario">
                        IP {s.ip}. Inició {fmtFechaHora(s.creada)}, actividad {fmtRelativo(s.ultimaActividad)}.
                      </span>
                    </span>
                  </span>
                  {s.actual ? (
                    <Estado tono="ok">Esta sesión</Estado>
                  ) : (
                    <Boton
                      tamano="sm"
                      onClick={async () => {
                        try {
                          await api.auth.cerrarSesion(s.id);
                          avisar('exito', 'Sesión cerrada.');
                          void recargar();
                        } catch (e) {
                          avisarError(e);
                        }
                      }}
                    >
                      Cerrar sesión
                    </Boton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="pequeno suave" style={{ marginTop: 12 }}>
        Último acceso anterior: {fmtFechaHora(usuario.ultimoAccesoExitoso)}.
      </p>
    </div>
  );
}
