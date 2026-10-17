import { almacenesConPermiso, evaluarCombinacionRoles, permisosDeRoles, ROL_PERMISOS } from '@/domain/permisos';
import type { Permiso, RolClave } from '@/api/types';

const ESCRITURA: Permiso[] = (Object.values(ROL_PERMISOS).flat() as Permiso[]).filter((p) => !p.endsWith('.ver'));

describe('Matriz RBAC (ERS sección 4)', () => {
  it('el auditor solo tiene permisos de lectura (RS-SOD-12)', () => {
    expect(ROL_PERMISOS.AUD.every((p) => p.endsWith('.ver'))).toBe(true);
  });
  it('el administrador de sistemas no mueve inventario (RS-SOD-11)', () => {
    const inventario = ESCRITURA.filter((p) => /^(recepcion|salida|transferencia|ajuste|conteo|incidencia)\./.test(p));
    expect(ROL_PERMISOS.ADM.some((p) => inventario.includes(p))).toBe(false);
  });
  it('el administrador no aprueba accesos y seguridad no los crea (RS-SOD-10)', () => {
    expect(ROL_PERMISOS.ADM).not.toContain('usuarios.aprobar');
    expect(ROL_PERMISOS.SEG).not.toContain('usuarios.gestionar');
  });
  it('el almacenista no aprueba nada', () => {
    expect(ROL_PERMISOS.ALM.some((p) => p.endsWith('.aprobar'))).toBe(false);
  });
  it('el solicitante no surte ni aprueba', () => {
    expect(ROL_PERMISOS.SOL).not.toContain('salida.surtir');
    expect(ROL_PERMISOS.SOL).not.toContain('salida.aprobar');
  });
  it('compras no recibe la mercancía que pide (RS-SOD-09)', () => {
    expect(ROL_PERMISOS.CMP).not.toContain('recepcion.crear');
  });
  it('solo gerencia resuelve incidencias de transferencia', () => {
    const roles = (Object.keys(ROL_PERMISOS) as RolClave[]).filter((r) => ROL_PERMISOS[r].includes('incidencia.resolver'));
    expect(roles).toEqual(['GER']);
  });
  it('combina permisos de varios roles sin duplicados', () => {
    const p = permisosDeRoles(['ALM', 'SUP']);
    expect(new Set(p).size).toBe(p.length);
    expect(p).toContain('transferencia.aprobar');
  });
  it('el alcance de un permiso viene del rol que lo otorga', () => {
    const u = { roles: [{ id: '1', rol: 'ALM' as const, almacenes: ['CEN' as const] }, { id: '2', rol: 'SUP' as const, almacenes: ['NTE' as const] }] };
    expect(almacenesConPermiso(u, 'salida.surtir')).toEqual(['CEN']);
    expect(almacenesConPermiso(u, 'salida.aprobar')).toEqual(['NTE']);
  });
});

describe('Combinaciones de roles (RS-SOD-11, 12, 14)', () => {
  it('prohíbe ADM con roles operativos', () => {
    expect(evaluarCombinacionRoles([{ rol: 'ADM', almacenes: 'TODOS' }], { rol: 'ALM', almacenes: ['CEN'] })?.tipo).toBe('prohibida');
  });
  it('prohíbe AUD con cualquier otro rol', () => {
    expect(evaluarCombinacionRoles([{ rol: 'AUD', almacenes: 'TODOS' }], { rol: 'CON', almacenes: 'TODOS' })?.tipo).toBe('prohibida');
  });
  it('exige excepción para ALM + SUP en el mismo almacén', () => {
    expect(evaluarCombinacionRoles([{ rol: 'ALM', almacenes: ['CTR'] }], { rol: 'SUP', almacenes: ['CTR'] })?.tipo).toBe('excepcion');
  });
  it('permite ALM y SUP en almacenes distintos', () => {
    expect(evaluarCombinacionRoles([{ rol: 'ALM', almacenes: ['CEN'] }], { rol: 'SUP', almacenes: ['NTE'] })).toBeNull();
  });
});
