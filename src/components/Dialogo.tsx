import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CircleAlert, ShieldCheck } from 'lucide-react';
import { ApiError } from '@/api/http';
import { Boton, Campo } from './ui';

interface DialogoProps {
  abierto: boolean;
  titulo: string;
  alCerrar: () => void;
  children: ReactNode;
  pie?: ReactNode;
  ancho?: boolean;
  /** Si es formulario, el diálogo entero es un <form> */
  alEnviar?: (e: FormEvent<HTMLFormElement>) => void;
}

/** Diálogo modal accesible basado en <dialog> nativo (trampa de foco y Esc incluidos). */
export function Dialogo({ abierto, titulo, alCerrar, children, pie, ancho, alEnviar }: DialogoProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  const previo = useRef<Element | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) {
      previo.current = document.activeElement;
      d.showModal();
    } else if (!abierto && d.open) {
      d.close();
      if (previo.current instanceof HTMLElement) previo.current.focus();
    }
  }, [abierto]);

  const contenido = (
    <>
      <div className="dialogo__cabecera">
        <h2 id={idTitulo} className="dialogo__titulo">
          {titulo}
        </h2>
      </div>
      <div className="dialogo__cuerpo">{children}</div>
      {pie && <div className="dialogo__pie">{pie}</div>}
    </>
  );

  return (
    <dialog
      ref={ref}
      className={`dialogo${ancho ? ' dialogo--ancho' : ''}`}
      aria-labelledby={idTitulo}
      onClose={() => abierto && alCerrar()}
      onCancel={(e) => {
        e.preventDefault();
        alCerrar();
      }}
    >
      {abierto &&
        (alEnviar ? (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              alEnviar(e);
            }}
          >
            {contenido}
          </form>
        ) : (
          contenido
        ))}
    </dialog>
  );
}

/* ───────────── Confirmación de acciones sensibles ───────────── */

export interface ValoresConfirmacion {
  motivo: string;
  password: string;
}

interface ConfirmarProps {
  abierto: boolean;
  titulo: string;
  descripcion: ReactNode;
  textoConfirmar: string;
  peligro?: boolean;
  /** Mínimo de caracteres del motivo; 0 = sin motivo */
  motivoMinimo?: number;
  etiquetaMotivo?: string;
  /** RS-SES-07: pide la contraseña antes de ejecutar */
  pedirPassword?: boolean;
  textoPassword?: string;
  alCerrar: () => void;
  alConfirmar: (v: ValoresConfirmacion) => Promise<unknown>;
  children?: ReactNode;
  ancho?: boolean;
}

export function DialogoConfirmacion({
  abierto,
  titulo,
  descripcion,
  textoConfirmar,
  peligro,
  motivoMinimo = 0,
  etiquetaMotivo = 'Motivo',
  pedirPassword,
  textoPassword = 'Confirma con tu contraseña. Es una operación de alto impacto.',
  alCerrar,
  alConfirmar,
  children,
  ancho,
}: ConfirmarProps) {
  const [motivo, setMotivo] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [intento, setIntento] = useState(false);

  useEffect(() => {
    if (abierto) {
      setMotivo('');
      setPassword('');
      setError(null);
      setIntento(false);
    }
  }, [abierto]);

  const motivoInvalido = motivoMinimo > 0 && motivo.trim().length < motivoMinimo;
  const passwordInvalido = !!pedirPassword && password.length === 0;
  const errCampos = error?.erroresPorCampo() ?? {};

  const enviar = async () => {
    setIntento(true);
    if (motivoInvalido || passwordInvalido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      await alConfirmar({ motivo: motivo.trim(), password });
      setPassword('');
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'DESCONOCIDO', 'No se pudo completar la operación.'));
      setPassword('');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialogo
      abierto={abierto}
      titulo={titulo}
      alCerrar={() => !enviando && alCerrar()}
      ancho={ancho}
      alEnviar={enviar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={enviando}>
            Volver
          </Boton>
          <Boton type="submit" variante={peligro ? 'peligro' : 'primario'} cargando={enviando}>
            {textoConfirmar}
          </Boton>
        </>
      }
    >
      <div className="suave">{descripcion}</div>
      {children}
      {motivoMinimo > 0 && (
        <Campo etiqueta={etiquetaMotivo} requerido error={intento && motivoInvalido ? `Escribe al menos ${motivoMinimo} caracteres.` : (errCampos.motivo ?? null)}>
          {(p) => (
            <>
              <textarea {...p} className="entrada" value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} />
              <span className="contador-caracteres" aria-live="polite">
                {motivo.trim().length}/{motivoMinimo} mínimo
              </span>
            </>
          )}
        </Campo>
      )}
      {pedirPassword && (
        <Campo etiqueta="Tu contraseña" requerido ayuda={textoPassword} error={intento && passwordInvalido ? 'Escribe tu contraseña.' : null}>
          {(p) => <input {...p} type="password" className="entrada" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Campo>
      )}
      {error && <BandaError error={error} />}
      {pedirPassword && (
        <p className="pequeno suave fila" style={{ gap: 6 }}>
          <ShieldCheck size={14} aria-hidden /> Tu usuario, la fecha, la hora y tu IP quedan en la bitácora de auditoría.
        </p>
      )}
    </Dialogo>
  );
}

export function BandaError({ error }: { error: ApiError }) {
  const bloqueo = error.codigo === 'SOD_VIOLATION';
  return (
    <div className={`banda ${bloqueo ? 'banda--bloqueo' : 'banda--error'}`} role="alert">
      <CircleAlert aria-hidden />
      <div>
        <strong>{bloqueo ? 'Bloqueado por segregación de funciones' : 'No se pudo completar'}</strong>
        {error.message}
        {error.detalles.length > 0 && !bloqueo && (
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {error.detalles.slice(0, 6).map((d) => (
              <li key={d.campo + d.mensaje}>{d.mensaje}</li>
            ))}
          </ul>
        )}
        {error.idCorrelacion && <span className="tabla__secundario">Referencia: {error.idCorrelacion}</span>}
      </div>
    </div>
  );
}
