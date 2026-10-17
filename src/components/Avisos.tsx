import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { ApiError } from '@/api/http';

type TipoAviso = 'exito' | 'error' | 'info';

interface Aviso {
  id: number;
  tipo: TipoAviso;
  texto: string;
  referencia?: string | null;
}

interface ContextoAvisos {
  avisar: (tipo: TipoAviso, texto: string, referencia?: string | null) => void;
  avisarError: (e: unknown) => void;
}

const Contexto = createContext<ContextoAvisos | null>(null);

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const siguiente = useRef(1);

  const quitar = useCallback((id: number) => setAvisos((a) => a.filter((x) => x.id !== id)), []);

  const avisar = useCallback(
    (tipo: TipoAviso, texto: string, referencia?: string | null) => {
      const id = siguiente.current++;
      setAvisos((a) => [...a.slice(-3), { id, tipo, texto, referencia }]);
      window.setTimeout(() => quitar(id), tipo === 'error' ? 9000 : 5000);
    },
    [quitar],
  );

  const avisarError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError) avisar('error', e.message, e.idCorrelacion);
      else avisar('error', 'No se pudo completar la operación.');
    },
    [avisar],
  );

  const valor = useMemo(() => ({ avisar, avisarError }), [avisar, avisarError]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      <div className="avisos" role="region" aria-label="Notificaciones" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className="aviso" data-tipo={a.tipo} role={a.tipo === 'error' ? 'alert' : 'status'}>
            {a.tipo === 'exito' ? <CircleCheck aria-hidden /> : a.tipo === 'error' ? <CircleAlert aria-hidden /> : <Info aria-hidden />}
            <div>
              {a.texto}
              {a.referencia && <span className="aviso__ref">Referencia para soporte: {a.referencia}</span>}
            </div>
            <button type="button" className="aviso__cerrar" onClick={() => quitar(a.id)} aria-label="Cerrar notificación">
              <X size={16} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </Contexto.Provider>
  );
}

export function useAvisos(): ContextoAvisos {
  const c = useContext(Contexto);
  if (!c) throw new Error('useAvisos debe usarse dentro de ProveedorAvisos');
  return c;
}
