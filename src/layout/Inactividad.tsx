import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/cliente';
import { useAuth } from '@/auth/AuthContext';
import { CONFIG } from '@/config/env';
import { Dialogo } from '@/components/Dialogo';
import { Boton } from '@/components/ui';

const AVISO_SEGUNDOS = 60;
const EVENTOS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * RS-SES-03: cierre de sesión por inactividad. Avisa un minuto antes; el servidor
 * aplica el mismo límite por su cuenta, esto solo evita que la sesión muera sin aviso.
 */
export function ControlInactividad() {
  const { salir } = useAuth();
  const limiteMs = CONFIG.minutosInactividad * 60 * 1000;
  const ultima = useRef(0);

  useEffect(() => {
    ultima.current = Date.now();
  }, []);
  const [restante, setRestante] = useState<number | null>(null);

  useEffect(() => {
    const marcar = () => {
      if (restante === null) ultima.current = Date.now();
    };
    EVENTOS.forEach((e) => window.addEventListener(e, marcar, { passive: true }));
    const intervalo = window.setInterval(() => {
      const transcurrido = Date.now() - ultima.current;
      const falta = Math.ceil((limiteMs - transcurrido) / 1000);
      if (falta <= 0) {
        window.clearInterval(intervalo);
        void salir(`Tu sesión se cerró tras ${CONFIG.minutosInactividad} minutos sin actividad.`);
      } else if (falta <= AVISO_SEGUNDOS) {
        setRestante(falta);
      }
    }, 1000);
    return () => {
      EVENTOS.forEach((e) => window.removeEventListener(e, marcar));
      window.clearInterval(intervalo);
    };
  }, [limiteMs, restante, salir]);

  const continuar = async () => {
    ultima.current = Date.now();
    setRestante(null);
    try {
      await api.auth.yo(); // renueva la actividad también en el servidor
    } catch {
      // si la sesión ya terminó, el cliente HTTP lo notifica
    }
  };

  return (
    <Dialogo
      abierto={restante !== null}
      titulo="¿Sigues ahí?"
      alCerrar={continuar}
      pie={
        <>
          <Boton onClick={() => void salir('Cerraste tu sesión.')}>Cerrar sesión</Boton>
          <Boton variante="primario" onClick={continuar}>
            Seguir trabajando
          </Boton>
        </>
      }
    >
      <p aria-live="assertive">
        Por seguridad, tu sesión se cerrará en <strong>{restante ?? 0} segundos</strong> por inactividad.
      </p>
    </Dialogo>
  );
}
