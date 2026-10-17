import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@/api/cliente';
import { escuchar, olvidarCsrf } from '@/api/http';
import type { Permiso, RespuestaLogin, UsuarioSesion } from '@/api/types';
import { puede as puedeUsuario } from '@/domain/permisos';

type Estado = 'iniciando' | 'anonimo' | 'autenticado';

interface ContextoAuth {
  estado: Estado;
  usuario: UsuarioSesion | null;
  /** Mensaje que se muestra en la pantalla de acceso (sesión expirada, cierre por inactividad…) */
  mensajeAcceso: string | null;
  iniciarSesion: (usuario: string, password: string) => Promise<RespuestaLogin>;
  verificarMfa: (desafioId: string, codigo: string) => Promise<void>;
  salir: (mensaje?: string) => Promise<void>;
  actualizarUsuario: (u: UsuarioSesion) => void;
  refrescarUsuario: () => Promise<void>;
  puede: (permiso: Permiso) => boolean;
}

const Contexto = createContext<ContextoAuth | null>(null);

export function ProveedorAuth({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>('iniciando');
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [mensajeAcceso, setMensajeAcceso] = useState<string | null>(null);
  const estadoRef = useRef<Estado>('iniciando');

  const fijar = useCallback((e: Estado, u: UsuarioSesion | null) => {
    estadoRef.current = e;
    setEstado(e);
    setUsuario(u);
  }, []);

  // Al cargar: ¿hay una sesión válida (cookie HttpOnly)?
  useEffect(() => {
    let vivo = true;
    api.auth
      .yo()
      .then((u) => vivo && fijar('autenticado', u))
      .catch(() => vivo && fijar('anonimo', null));
    return () => {
      vivo = false;
    };
  }, [fijar]);

  // El cliente HTTP avisa cuando el servidor da la sesión por terminada
  useEffect(() => {
    const quitar1 = escuchar('sesion-terminada', (mensaje) => {
      if (estadoRef.current !== 'autenticado') return;
      olvidarCsrf();
      setMensajeAcceso(mensaje);
      fijar('anonimo', null);
    });
    const quitar2 = escuchar('cambio-password', () => {
      setUsuario((u) => (u ? { ...u, debeCambiarPassword: true } : u));
    });
    return () => {
      quitar1();
      quitar2();
    };
  }, [fijar]);

  const iniciarSesion = useCallback(
    async (correo: string, password: string) => {
      const r = await api.auth.login(correo, password);
      if (r.estado === 'OK') {
        setMensajeAcceso(null);
        fijar('autenticado', r.usuario);
      }
      return r;
    },
    [fijar],
  );

  const verificarMfa = useCallback(
    async (desafioId: string, codigo: string) => {
      const r = await api.auth.mfa(desafioId, codigo);
      if (r.estado === 'OK') {
        setMensajeAcceso(null);
        fijar('autenticado', r.usuario);
      }
    },
    [fijar],
  );

  const salir = useCallback(
    async (mensaje?: string) => {
      try {
        await api.auth.salir();
      } catch {
        // La sesión pudo haber expirado ya; el estado local se limpia de todos modos
      }
      olvidarCsrf();
      setMensajeAcceso(mensaje ?? null);
      fijar('anonimo', null);
    },
    [fijar],
  );

  const refrescarUsuario = useCallback(async () => {
    const u = await api.auth.yo();
    setUsuario(u);
  }, []);

  const valor = useMemo<ContextoAuth>(
    () => ({
      estado,
      usuario,
      mensajeAcceso,
      iniciarSesion,
      verificarMfa,
      salir,
      actualizarUsuario: setUsuario,
      refrescarUsuario,
      puede: (p) => puedeUsuario(usuario, p),
    }),
    [estado, usuario, mensajeAcceso, iniciarSesion, verificarMfa, salir, refrescarUsuario],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useAuth(): ContextoAuth {
  const c = useContext(Contexto);
  if (!c) throw new Error('useAuth debe usarse dentro de ProveedorAuth');
  return c;
}

/** Atajo para componentes que solo se muestran con sesión iniciada */
export function useUsuario(): UsuarioSesion {
  const { usuario } = useAuth();
  if (!usuario) throw new Error('No hay usuario en sesión');
  return usuario;
}
