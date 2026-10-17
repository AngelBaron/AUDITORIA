import type { Permiso, RolClave, UsuarioSesion } from '@/api/types';

/**
 * Matriz RBAC (ERS sección 4). La autoridad final es el servidor: aquí solo se usa
 * para mostrar u ocultar navegación y botones (RS-ACC-06). El mock la aplica como
 * si fuera el backend.
 */
export const ROL_PERMISOS: Record<RolClave, readonly Permiso[]> = {
  ALM: [
    'existencias.ver',
    'catalogo.ver',
    'oc.ver',
    'recepcion.ver',
    'recepcion.crear',
    'salida.ver',
    'salida.surtir',
    'transferencia.ver',
    'transferencia.crear',
    'transferencia.operar',
    'ajuste.ver',
    'ajuste.crear',
    'conteo.ver',
    'conteo.capturar',
    'reportes.ver',
  ],
  SUP: [
    'existencias.ver',
    'catalogo.ver',
    'oc.ver',
    'recepcion.ver',
    'recepcion.aprobar',
    'salida.ver',
    'salida.aprobar',
    'transferencia.ver',
    'transferencia.crear',
    'transferencia.aprobar',
    'transferencia.operar',
    'ajuste.ver',
    'ajuste.crear',
    'ajuste.aprobar',
    'conteo.ver',
    'conteo.capturar',
    'conteo.programar',
    'conteo.cerrar',
    'reportes.ver',
  ],
  GER: [
    'existencias.ver',
    'catalogo.ver',
    'catalogo.editar',
    'oc.ver',
    'recepcion.ver',
    'recepcion.aprobar',
    'salida.ver',
    'salida.aprobar',
    'transferencia.ver',
    'transferencia.crear',
    'transferencia.aprobar',
    'incidencia.resolver',
    'ajuste.ver',
    'ajuste.aprobar',
    'conteo.ver',
    'conteo.programar',
    'conteo.cerrar',
    'periodo.aprobar',
    'reportes.ver',
    'valuacion.ver',
    'bitacora.ver',
    'hallazgos.ver',
    'hallazgos.gestionar',
  ],
  SOL: ['catalogo.ver', 'salida.ver', 'salida.solicitar'],
  CMP: ['existencias.ver', 'catalogo.ver', 'catalogo.editar', 'oc.ver', 'oc.crear', 'recepcion.ver', 'reportes.ver'],
  CON: [
    'existencias.ver',
    'catalogo.ver',
    'oc.ver',
    'recepcion.ver',
    'salida.ver',
    'transferencia.ver',
    'ajuste.ver',
    'conteo.ver',
    'periodo.cerrar',
    'reportes.ver',
    'valuacion.ver',
  ],
  AUD: [
    'existencias.ver',
    'catalogo.ver',
    'oc.ver',
    'recepcion.ver',
    'salida.ver',
    'transferencia.ver',
    'ajuste.ver',
    'conteo.ver',
    'reportes.ver',
    'valuacion.ver',
    'bitacora.ver',
    'hallazgos.ver',
    'usuarios.ver',
    'parametros.ver',
  ],
  ADM: ['usuarios.ver', 'usuarios.gestionar', 'parametros.ver', 'parametros.proponer'],
  SEG: [
    'usuarios.ver',
    'usuarios.aprobar',
    'parametros.ver',
    'parametros.aprobar',
    'bitacora.ver',
    'hallazgos.ver',
    'hallazgos.gestionar',
  ],
};

export const ROL_NOMBRE: Record<RolClave, string> = {
  ALM: 'Almacenista',
  SUP: 'Supervisor de almacén',
  GER: 'Gerente de logística',
  SOL: 'Solicitante',
  CMP: 'Compras',
  CON: 'Contabilidad',
  AUD: 'Auditor interno',
  ADM: 'Administrador de sistemas',
  SEG: 'Oficial de seguridad',
};

/** Roles que pueden escribir en inventario (RS-SOD-11 / RS-SOD-12) */
export const ROLES_OPERATIVOS: readonly RolClave[] = ['ALM', 'SUP', 'GER'];
export const ROLES_CON_ESCRITURA: readonly RolClave[] = ['ALM', 'SUP', 'GER', 'SOL', 'CMP', 'CON', 'ADM', 'SEG'];

/** Roles cuyo alcance siempre es "todos los almacenes" */
export const ROLES_GLOBALES: readonly RolClave[] = ['GER', 'CMP', 'CON', 'AUD', 'ADM', 'SEG'];

/** Roles que deben tener MFA (RS-AUT-04) */
export const ROLES_CON_MFA: readonly RolClave[] = ['SUP', 'GER', 'ADM', 'SEG', 'AUD'];

export function permisosDeRoles(roles: readonly RolClave[]): Permiso[] {
  const set = new Set<Permiso>();
  roles.forEach((r) => ROL_PERMISOS[r].forEach((p) => set.add(p)));
  return [...set].sort();
}

export function puede(usuario: Pick<UsuarioSesion, 'permisos'> | null | undefined, permiso: Permiso): boolean {
  return !!usuario && usuario.permisos.includes(permiso);
}

export function puedeAlguno(usuario: Pick<UsuarioSesion, 'permisos'> | null | undefined, permisos: readonly Permiso[]): boolean {
  return permisos.some((p) => puede(usuario, p));
}

export function tieneRol(usuario: Pick<UsuarioSesion, 'roles'> | null | undefined, rol: RolClave): boolean {
  return !!usuario && usuario.roles.some((r) => r.rol === rol);
}

/**
 * Validación de combinaciones de roles (RS-SOD-11, RS-SOD-12, RS-SOD-14).
 * Devuelve un error duro, una advertencia que exige excepción, o nada.
 */
export function evaluarCombinacionRoles(
  existentes: readonly { rol: RolClave; almacenes: readonly string[] | 'TODOS' }[],
  nuevo: { rol: RolClave; almacenes: readonly string[] | 'TODOS' },
): { tipo: 'prohibida'; codigo: string; mensaje: string } | { tipo: 'excepcion'; codigo: string; mensaje: string } | null {
  const todos = [...existentes, nuevo];
  const roles = new Set(todos.map((a) => a.rol));
  if (roles.has('ADM') && ROLES_OPERATIVOS.some((r) => roles.has(r))) {
    return {
      tipo: 'prohibida',
      codigo: 'RS-SOD-11',
      mensaje: 'Un administrador de sistemas no puede tener roles que mueven inventario (ALM, SUP o GER).',
    };
  }
  if (roles.has('AUD') && [...roles].some((r) => r !== 'AUD')) {
    return {
      tipo: 'prohibida',
      codigo: 'RS-SOD-12',
      mensaje: 'El auditor interno solo puede tener permisos de lectura; no se combina con otros roles.',
    };
  }
  if (roles.has('ADM') && roles.has('SEG')) {
    return {
      tipo: 'prohibida',
      codigo: 'RS-SOD-10',
      mensaje: 'Quien crea accesos (ADM) no puede ser quien los aprueba (SEG).',
    };
  }
  const alm = todos.filter((a) => a.rol === 'ALM');
  const sup = todos.filter((a) => a.rol === 'SUP');
  const comparten = alm.some((a) =>
    sup.some((s) => a.almacenes === 'TODOS' || s.almacenes === 'TODOS' || a.almacenes.some((x) => (s.almacenes as readonly string[]).includes(x))),
  );
  if (comparten) {
    return {
      tipo: 'excepcion',
      codigo: 'RS-SOD-14',
      mensaje: 'Almacenista y supervisor en el mismo almacén es una combinación de riesgo: requiere excepción justificada, aprobada por Seguridad y con fecha de vencimiento.',
    };
  }
  return null;
}

const TODOS: readonly import('@/api/types').AlmacenClave[] = ['CEN', 'NTE', 'CTR', 'SUR'];

/** Almacenes donde el usuario tiene un permiso concreto (permiso y alcance del mismo rol). */
export function almacenesConPermiso(usuario: Pick<UsuarioSesion, 'roles'> | null | undefined, permiso: Permiso): import('@/api/types').AlmacenClave[] {
  if (!usuario) return [];
  const set = new Set<import('@/api/types').AlmacenClave>();
  usuario.roles.forEach((r) => {
    if (!ROL_PERMISOS[r.rol].includes(permiso)) return;
    (r.almacenes === 'TODOS' || ROLES_GLOBALES.includes(r.rol) ? TODOS : r.almacenes).forEach((a) => set.add(a));
  });
  return TODOS.filter((a) => set.has(a));
}
