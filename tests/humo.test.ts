import { crearMotorSembrado } from '@/api/mock/sembrar';
import { verificarCadena } from '@/api/mock/bitacora';
import { conciliacion, foliosFaltantes } from '@/api/mock/reportes';
import type { Ctx } from '@/api/mock/motor';

test('escenario sembrado coherente', async () => {
  const m = await crearMotorSembrado(new Date());
  const ctx = (id: string): Ctx => ({ usuario: m.usuario(id)!, sesion: null, ip: '1', userAgent: 'x', correlacion: 'c', ahora: new Date() });
  const conc = conciliacion(m, ctx('u-aud'));
  expect(conc.filter((f) => f.diferencia !== 0)).toEqual([]);
  expect((await verificarCadena(m.db.bitacora)).integra).toBe(true);
  expect(foliosFaltantes(m, ctx('u-aud')).every((f) => f.faltantes.length === 0)).toBe(true);
});

test('la bitácora y los movimientos siguen el orden cronológico', async () => {
  const m = await crearMotorSembrado(new Date());
  const fechas = m.db.bitacora.map((e) => e.fechaHoraUtc);
  expect(fechas).toEqual([...fechas].sort());
  const movs = m.db.t.movimientos.map((x) => x.fecha);
  expect(movs).toEqual([...movs].sort());
});
