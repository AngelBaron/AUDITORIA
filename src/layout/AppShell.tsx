import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { KeyRound, LogOut, Menu, MonitorSmartphone, Warehouse } from 'lucide-react';
import { api } from '@/api/cliente';
import { useAuth, useUsuario } from '@/auth/AuthContext';
import { puedeAlguno, ROL_NOMBRE } from '@/domain/permisos';
import { ALMACEN_NOMBRE, fmtFechaHora, iniciales } from '@/domain/formato';
import { CONFIG, esModoDemo } from '@/config/env';
import { NAVEGACION } from './navegacion';
import { ControlInactividad } from './Inactividad';
import { Logo } from './Logo';
import { Cargando } from '@/components/ui';

export function AppShell() {
  const usuario = useUsuario();
  const { salir } = useAuth();
  const ubicacion = useLocation();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [lateralAbierto, setLateralAbierto] = useState(false);
  const [pendientes, setPendientes] = useState<number>(0);
  const menuRef = useRef<HTMLDivElement>(null);

  // Contador de la bandeja: al navegar y cada minuto
  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      api
        .bandeja()
        .then((b) => vivo && setPendientes(b.length))
        .catch(() => undefined);
    void cargar();
    const t = window.setInterval(cargar, 60_000);
    return () => {
      vivo = false;
      window.clearInterval(t);
    };
  }, [ubicacion.pathname]);

  useEffect(() => {
    setLateralAbierto(false);
    setMenuAbierto(false);
  }, [ubicacion.pathname]);

  useEffect(() => {
    if (!menuAbierto) return;
    const cerrar = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenuAbierto(false);
    };
    document.addEventListener('mousedown', cerrar);
    document.addEventListener('keydown', cerrar);
    return () => {
      document.removeEventListener('mousedown', cerrar);
      document.removeEventListener('keydown', cerrar);
    };
  }, [menuAbierto]);

  const rolPrincipal = usuario.roles[0];
  const alcance = usuario.almacenes.length === 4 ? 'Todos los almacenes' : usuario.almacenes.map((a) => ALMACEN_NOMBRE[a]).join(', ');

  return (
    <div className="shell">
      <a href="#contenido" className="salto-contenido">
        Saltar al contenido
      </a>
      {lateralAbierto && <div className="velo" onClick={() => setLateralAbierto(false)} aria-hidden />}
      <aside className="lateral" data-abierto={lateralAbierto} aria-label="Menú principal">
        <Link to="/" className="lateral__marca">
          <Logo className="lateral__logo" />
          <span>
            <span className="lateral__nombre">SICIL</span>
            <span className="lateral__empresa">LogiTech Soluciones</span>
          </span>
        </Link>
        <nav>
          {NAVEGACION.map((g) => {
            const visibles = g.enlaces.filter((e) => e.permisos.length === 0 || puedeAlguno(usuario, e.permisos));
            if (!visibles.length) return null;
            return (
              <div className="lateral__grupo" key={g.titulo}>
                <p className="lateral__titulo">{g.titulo}</p>
                <ul className="lateral__lista">
                  {visibles.map((e) => (
                    <li key={e.a}>
                      <NavLink to={e.a} end={e.a === '/'} className="lateral__enlace">
                        <e.icono size={17} aria-hidden />
                        {e.texto}
                        {e.contador === 'bandeja' && pendientes > 0 && (
                          <span className="lateral__contador" aria-label={`${pendientes} pendientes`}>
                            {pendientes}
                          </span>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="lateral__pie">
          SICIL v{CONFIG.version}
          {esModoDemo && <> · modo demostración</>}
        </div>
      </aside>

      <div className="contenido">
        <header className="barra">
          <button type="button" className="btn btn--secundario btn--icono barra__menu" onClick={() => setLateralAbierto(true)} aria-label="Abrir menú">
            <Menu size={18} aria-hidden />
          </button>
          <div className="barra__alcance">
            <Warehouse size={16} aria-hidden />
            <span>
              Alcance: <strong>{alcance}</strong>
            </span>
          </div>
          <div className="barra__derecha" ref={menuRef} style={{ position: 'relative' }}>
            <button type="button" className="usuario-chip" aria-haspopup="menu" aria-expanded={menuAbierto} onClick={() => setMenuAbierto((v) => !v)}>
              <span className="usuario-chip__iniciales" aria-hidden>
                {iniciales(usuario.nombre)}
              </span>
              <span className="usuario-chip__texto">
                <span className="usuario-chip__nombre">{usuario.nombre}</span>
                <span className="usuario-chip__rol">
                  {usuario.roles.map((r) => ROL_NOMBRE[r.rol]).join(' · ') || (rolPrincipal ? ROL_NOMBRE[rolPrincipal.rol] : 'Sin rol')}
                </span>
              </span>
            </button>
            {menuAbierto && (
              <div className="menu-usuario" role="menu">
                <div className="menu-usuario__info">
                  {usuario.numEmpleado} · {usuario.correo}
                  <br />
                  Último acceso anterior: {fmtFechaHora(usuario.ultimoAccesoExitoso)}
                </div>
                <Link to="/cuenta/sesiones" role="menuitem">
                  <MonitorSmartphone size={16} aria-hidden /> Mis sesiones
                </Link>
                <Link to="/cuenta/contrasena" role="menuitem">
                  <KeyRound size={16} aria-hidden /> Cambiar contraseña
                </Link>
                <button type="button" role="menuitem" onClick={() => void salir('Cerraste tu sesión.')}>
                  <LogOut size={16} aria-hidden /> Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </header>
        <main id="contenido" className="pagina" tabIndex={-1}>
          <Suspense fallback={<div className="panel"><Cargando /></div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <ControlInactividad />
    </div>
  );
}
