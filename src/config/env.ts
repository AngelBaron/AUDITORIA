/**
 * Configuración de entorno. El frontend no maneja secretos (RS-CIF-03): solo el modo
 * de operación y la ruta base de la API, ambos públicos.
 */
const modo = import.meta.env.VITE_API_MODE === 'real' ? 'real' : 'mock';

const base = String(import.meta.env.VITE_API_BASE ?? '/api/v1');
// Solo rutas relativas al mismo origen: la CSP limita connect-src a 'self'
const baseSegura = /^\/[A-Za-z0-9/_-]*$/.test(base) ? base.replace(/\/$/, '') : '/api/v1';

const minutos = Number(import.meta.env.VITE_IDLE_MINUTES ?? 15);

export const CONFIG = {
  modoApi: modo as 'mock' | 'real',
  apiBase: baseSegura,
  minutosInactividad: Number.isFinite(minutos) && minutos >= 1 && minutos <= 30 ? minutos : 15,
  version: '1.0.0',
  timeoutMs: 30_000,
} as const;

export const esModoDemo = CONFIG.modoApi === 'mock';
