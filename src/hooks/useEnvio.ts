import { useCallback, useRef, useState } from 'react';
import { ApiError } from '@/api/http';
import { nuevaLlaveIdempotencia } from '@/domain/seguridad';

/**
 * Envío de formularios y acciones:
 * - evita el doble envío mientras hay una petición en curso
 * - conserva la MISMA llave de idempotencia si el usuario reintenta tras un error de red,
 *   y genera una nueva solo después de un éxito (RS-TRX-07)
 */
export function useEnvio<A extends unknown[], R>(fn: (llave: string, ...args: A) => Promise<R>) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const llave = useRef(nuevaLlaveIdempotencia());
  const enCurso = useRef(false);

  const enviar = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (enCurso.current) return undefined;
      enCurso.current = true;
      setEnviando(true);
      setError(null);
      try {
        const r = await fn(llave.current, ...args);
        llave.current = nuevaLlaveIdempotencia();
        return r;
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, 'DESCONOCIDO', 'No se pudo completar la operación.');
        // Un rechazo del servidor (4xx) no se reintenta con la misma llave
        if (err.status >= 400 && err.status < 500) llave.current = nuevaLlaveIdempotencia();
        setError(err);
        throw err;
      } finally {
        enCurso.current = false;
        setEnviando(false);
      }
    },
    [fn],
  );

  return { enviar, enviando, error, limpiarError: () => setError(null) };
}
