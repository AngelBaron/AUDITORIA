import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { Permiso } from '@/api/types';
import { puedeAlguno } from '@/domain/permisos';
import { NoAutorizadoPage } from '@/pages/errores/ErroresPage';
import { useAuth } from './AuthContext';

export function PantallaCarga() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} role="status">
      <span className="suave">Verificando sesión…</span>
    </div>
  );
}

/** Exige sesión. Si la contraseña es temporal, solo permite la pantalla de cambio (RS-AUT-05). */
export function RequiereSesion() {
  const { estado, usuario } = useAuth();
  const ubicacion = useLocation();
  if (estado === 'iniciando') return <PantallaCarga />;
  if (estado !== 'autenticado' || !usuario) return <Navigate to="/acceso" replace state={{ desde: ubicacion.pathname + ubicacion.search }} />;
  if (usuario.debeCambiarPassword && ubicacion.pathname !== '/cuenta/contrasena') return <Navigate to="/cuenta/contrasena" replace />;
  return <Outlet />;
}

/** Oculta la ruta si el usuario no tiene ninguno de los permisos (el servidor vuelve a validar). */
export function RequierePermiso({ permisos, children }: { permisos: Permiso[]; children: ReactNode }) {
  const { usuario } = useAuth();
  if (!puedeAlguno(usuario, permisos)) return <NoAutorizadoPage />;
  return <>{children}</>;
}
