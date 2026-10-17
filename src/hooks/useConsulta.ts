import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/http';

export interface EstadoConsulta<T> {
  datos: T | undefined;
  error: ApiError | null;
  cargando: boolean;
  recargar: () => Promise<void>;
  establecer: (datos: T) => void;
}

/**
 * Carga datos de la API y expone estado de carga/error.
 * Ignora respuestas que llegan tarde (si cambian los parámetros antes de que responda).
 */
export function useConsulta<T>(fn: () => Promise<T>, deps: readonly unknown[], opciones: { activo?: boolean } = {}): EstadoConsulta<T> {
  const activo = opciones.activo ?? true;
  const [datos, setDatos] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [cargando, setCargando] = useState<boolean>(activo);
  const turno = useRef(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  const cargar = useCallback(async () => {
    const mio = ++turno.current;
    setCargando(true);
    setError(null);
    try {
      const r = await fnRef.current();
      if (mio === turno.current) setDatos(r);
    } catch (e) {
      if (mio === turno.current) setError(e instanceof ApiError ? e : new ApiError(0, 'DESCONOCIDO', 'No se pudo cargar la información.'));
    } finally {
      if (mio === turno.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (activo) void cargar();
    else setCargando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, ...deps]);

  return { datos, error, cargando, recargar: cargar, establecer: setDatos };
}
