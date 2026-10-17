import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { CircleAlert, Info, LogIn, ShieldCheck } from 'lucide-react';
import { ApiError } from '@/api/http';
import { useAuth } from '@/auth/AuthContext';
import { Boton, Campo } from '@/components/ui';
import { Logo } from '@/layout/Logo';
import { ROL_NOMBRE } from '@/domain/permisos';
import { MapaRutas } from './MapaRutas';

interface CuentaDemo {
  correo: string;
  nombre: string;
  rol: string;
}

/** Solo rutas internas como destino tras iniciar sesión (evita redirecciones abiertas). */
export function destinoSeguro(valor: unknown): string {
  return typeof valor === 'string' && /^\/(?!\/)[\w\-/?=&%.]*$/.test(valor) && !valor.startsWith('/acceso') ? valor : '/';
}

export function AccesoPage() {
  const { estado, iniciarSesion, verificarMfa, mensajeAcceso } = useAuth();
  const ubicacion = useLocation();
  const destino = destinoSeguro((ubicacion.state as { desde?: string } | null)?.desde);

  const [paso, setPaso] = useState<'credenciales' | 'mfa'>('credenciales');
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [codigo, setCodigo] = useState('');
  const [desafio, setDesafio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [intento, setIntento] = useState(false);
  const [demo, setDemo] = useState<{ cuentas: CuentaDemo[]; password: string; totp: string } | null>(null);
  const codigoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // El panel de cuentas de prueba existe solo en el build de demostración
    if (import.meta.env.VITE_API_MODE === 'real') return;
    void import('@/api/mock/semilla').then((s) =>
      setDemo({
        cuentas: s.USUARIOS.map((u) => ({ correo: u.correo, nombre: u.nombre, rol: u.roles.map((r) => ROL_NOMBRE[r.rol]).join(' + ') })),
        password: s.DEMO_PASSWORD,
        totp: s.DEMO_TOTP,
      }),
    );
  }, []);

  useEffect(() => {
    if (paso === 'mfa') codigoRef.current?.focus();
  }, [paso]);

  if (estado === 'autenticado') return <Navigate to={destino} replace />;

  const enviarCredenciales = async (e: FormEvent) => {
    e.preventDefault();
    setIntento(true);
    if (!correo.trim() || !password) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await iniciarSesion(correo.trim(), password);
      if (r.estado === 'MFA_REQUERIDO') {
        setDesafio(r.desafioId);
        setPaso('mfa');
        setIntento(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setPassword('');
      setEnviando(false);
    }
  };

  const enviarCodigo = async (e: FormEvent) => {
    e.preventDefault();
    setIntento(true);
    if (!/^\d{6}$/.test(codigo)) return;
    setEnviando(true);
    setError(null);
    try {
      await verificarMfa(desafio, codigo);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? 'No se pudo verificar el código.');
      if (apiErr?.codigo === 'MFA_VENCIDO') {
        setPaso('credenciales');
        setDesafio('');
      }
      setCodigo('');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="acceso">
      <section className="acceso__lienzo" aria-hidden="false">
        <MapaRutas className="acceso__mapa" />
        <div className="acceso__marca">
          <Logo className="lateral__logo" />
          <div>
            <div className="lateral__nombre">SICIL</div>
            <div className="lateral__empresa">LogiTech Soluciones S.A. de C.V.</div>
          </div>
        </div>
        <div>
          <p className="acceso__lema">Cada pieza con dueño, de la recepción a la entrega.</p>
          <p className="acceso__nota" style={{ marginTop: 16 }}>
            Planta Central y almacenes Norte, Centro y Sur. Cada movimiento lleva folio, la aprobación es de otra persona y la bitácora queda sellada.
          </p>
        </div>
      </section>

      <section className="acceso__panel">
        {paso === 'credenciales' ? (
          <form className="acceso__form" onSubmit={enviarCredenciales} noValidate>
            <h1 className="acceso__titulo">Inicia sesión</h1>
            {mensajeAcceso && !error && (
              <div className="banda banda--info" role="status">
                <Info aria-hidden />
                <div>{mensajeAcceso}</div>
              </div>
            )}
            {error && (
              <div className="banda banda--error" role="alert">
                <CircleAlert aria-hidden />
                <div>{error}</div>
              </div>
            )}
            <Campo etiqueta="Correo laboral" requerido error={intento && !correo.trim() ? 'Escribe tu correo.' : null}>
              {(p) => (
                <input
                  {...p}
                  className="entrada"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={120}
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  placeholder="nombre@logitech.mx"
                />
              )}
            </Campo>
            <Campo etiqueta="Contraseña" requerido error={intento && !password ? 'Escribe tu contraseña.' : null}>
              {(p) => <input {...p} className="entrada" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Campo>
            <Boton type="submit" variante="primario" cargando={enviando} icono={<LogIn aria-hidden />}>
              Entrar
            </Boton>
            <p className="pequeno suave">¿Olvidaste tu contraseña? Pide al administrador de sistemas un restablecimiento; recibirás un enlace válido 15 minutos.</p>
          </form>
        ) : (
          <form className="acceso__form" onSubmit={enviarCodigo} noValidate>
            <h1 className="acceso__titulo">Verificación en dos pasos</h1>
            <p className="suave">Escribe el código de 6 dígitos de tu app autenticadora. Tu rol aprueba movimientos o administra accesos, por eso se pide un segundo factor.</p>
            {error && (
              <div className="banda banda--error" role="alert">
                <CircleAlert aria-hidden />
                <div>{error}</div>
              </div>
            )}
            <Campo etiqueta="Código de verificación" requerido error={intento && !/^\d{6}$/.test(codigo) ? 'El código tiene 6 dígitos.' : null}>
              {(p) => (
                <input
                  {...p}
                  ref={codigoRef}
                  className="entrada codigo-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              )}
            </Campo>
            <Boton type="submit" variante="primario" cargando={enviando} icono={<ShieldCheck aria-hidden />}>
              Verificar
            </Boton>
            <Boton
              variante="fantasma"
              onClick={() => {
                setPaso('credenciales');
                setCodigo('');
                setError(null);
              }}
            >
              Usar otra cuenta
            </Boton>
          </form>
        )}

        <p className="acceso__privacidad">
          Aviso de privacidad: SICIL trata tu nombre, número de empleado y correo laboral para controlar el acceso y registrar quién realiza cada movimiento de inventario. Consulta el aviso completo con el área de Seguridad de la información.
        </p>

        {demo && (
          <details className="demo">
            <summary>Cuentas de demostración</summary>
            <p className="suave" style={{ marginTop: 6 }}>
              Contraseña de todas: <strong className="codigo">{demo.password}</strong>. Código de verificación: <strong className="codigo">{demo.totp}</strong>.
            </p>
            <div className="demo__lista">
              {demo.cuentas.map((c) => (
                <button
                  key={c.correo}
                  type="button"
                  onClick={() => {
                    setCorreo(c.correo);
                    setPassword(demo.password);
                    setPaso('credenciales');
                    setError(null);
                  }}
                >
                  <span>{c.nombre}</span>
                  <span className="suave">{c.rol}</span>
                </button>
              ))}
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
