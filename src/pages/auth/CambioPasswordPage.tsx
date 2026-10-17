import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Check, KeyRound, X } from 'lucide-react';
import { api } from '@/api/cliente';
import { ApiError } from '@/api/http';
import { useAuth, useUsuario } from '@/auth/AuthContext';
import { BandaError } from '@/components/Dialogo';
import { Boton, Cabecera, Campo } from '@/components/ui';
import { useAvisos } from '@/components/Avisos';
import { evaluarPassword, PASSWORD_MAX } from '@/domain/seguridad';

export function CambioPasswordPage() {
  const usuario = useUsuario();
  const { actualizarUsuario, salir } = useAuth();
  const { avisar } = useAvisos();
  const navegar = useNavigate();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [intento, setIntento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const evaluacion = evaluarPassword(nueva, usuario);
  const obligatorio = usuario.debeCambiarPassword;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setIntento(true);
    if (!actual || !evaluacion.valida || nueva !== confirmacion || nueva === actual) return;
    setEnviando(true);
    setError(null);
    try {
      const u = await api.auth.cambiarPassword(actual, nueva);
      actualizarUsuario(u);
      avisar('exito', 'Contraseña actualizada. Se cerraron tus otras sesiones.');
      navegar('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'DESCONOCIDO', 'No se pudo cambiar la contraseña.'));
    } finally {
      setActual('');
      setEnviando(false);
    }
  };

  const errorNueva = intento && !evaluacion.valida ? 'La contraseña no cumple las reglas.' : intento && nueva === actual && nueva ? 'Debe ser distinta de la actual.' : null;

  return (
    <div style={{ maxWidth: 560 }}>
      <Cabecera
        titulo="Cambiar contraseña"
        descripcion={obligatorio ? 'Tu contraseña es temporal. Crea una propia para continuar; nadie más debe conocerla.' : 'Al cambiarla se cierran tus sesiones en otros dispositivos.'}
      />
      <form className="panel" onSubmit={enviar} noValidate>
        <div className="panel__cuerpo pila">
          {error && <BandaError error={error} />}
          <Campo etiqueta={obligatorio ? 'Contraseña temporal' : 'Contraseña actual'} requerido error={intento && !actual ? 'Escribe tu contraseña actual.' : null}>
            {(p) => <input {...p} className="entrada" type="password" autoComplete="current-password" maxLength={PASSWORD_MAX} value={actual} onChange={(e) => setActual(e.target.value)} />}
          </Campo>
          <Campo etiqueta="Nueva contraseña" requerido error={errorNueva} ayuda="Usa una frase fácil de recordar para ti y difícil de adivinar, por ejemplo tres palabras y un número.">
            {(p) => <input {...p} className="entrada" type="password" autoComplete="new-password" maxLength={PASSWORD_MAX} value={nueva} onChange={(e) => setNueva(e.target.value)} />}
          </Campo>
          <div className="medidor" data-nivel={evaluacion.nivel} aria-hidden>
            <span />
            <span />
            <span />
            <span />
          </div>
          <ul className="reglas" aria-label="Reglas de la contraseña">
            {evaluacion.reglas.map((r) => (
              <li key={r.clave} data-ok={r.ok}>
                {r.ok ? <Check aria-hidden /> : <X aria-hidden />}
                {r.texto}
                <span className="sr-only">{r.ok ? 'cumple' : 'no cumple'}</span>
              </li>
            ))}
            <li data-ok={nueva.length > 0}>
              <Check aria-hidden /> No repetir tus últimas 5 contraseñas (lo valida el servidor)
            </li>
          </ul>
          <Campo etiqueta="Confirma la nueva contraseña" requerido error={intento && nueva !== confirmacion ? 'Las contraseñas no coinciden.' : null}>
            {(p) => <input {...p} className="entrada" type="password" autoComplete="new-password" maxLength={PASSWORD_MAX} value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />}
          </Campo>
        </div>
        <div className="dialogo__pie">
          {obligatorio ? (
            <Boton onClick={() => void salir('Cerraste tu sesión.')}>Salir</Boton>
          ) : (
            <Boton onClick={() => navegar(-1)}>Volver</Boton>
          )}
          <Boton type="submit" variante="primario" cargando={enviando} icono={<KeyRound aria-hidden />}>
            Guardar contraseña
          </Boton>
        </div>
      </form>
    </div>
  );
}
