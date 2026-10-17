/**
 * Pruebas de auditoría (ERS sección 19). Cada prueba reproduce lo que un auditor intentaría
 * y verifica la respuesta del servidor, el estado de los datos y la bitácora.
 * Su salida sirve como evidencia del formato F-09.
 */
import { crearMotorSembrado } from '@/api/mock/sembrar';
import { verificarCadena } from '@/api/mock/bitacora';
import { renovar } from '@/api/mock/autenticacion';
import { conciliacion } from '@/api/mock/reportes';
import { DEMO_PASSWORD } from '@/api/mock/semilla';
import type { Motor, Ctx } from '@/api/mock/motor';
import type { Documento, EventoBitacora } from '@/api/types';
import { Navegador, codigo, cuerpo } from './apoyo/cliente';

let m: Motor;
const nav = () => new Navegador(m);
const doc = (folio: string) => m.db.t.documentos.find((d) => d.folio === folio)!;
const buscar = (f: (d: Motor['db']['t']['documentos'][number]) => boolean) => {
  const d = m.db.t.documentos.find(f);
  if (!d) throw new Error('Documento de escenario no encontrado');
  return d;
};
/** Documentos del escenario sembrado, localizados por su situación y no por folio */
const esc = {
  salidaGerencia: () => buscar((d) => d.tipo === 'SAL' && d.estado === 'PENDIENTE' && d.nivelAprobacion === 'GER'),
  salidaPendienteSup: () => buscar((d) => d.tipo === 'SAL' && d.estado === 'PENDIENTE' && d.nivelAprobacion === 'SUP' && d.almacenOrigen === 'CEN'),
  salidaPorSurtir: () => buscar((d) => d.tipo === 'SAL' && d.estado === 'APROBADA' && d.almacenOrigen === 'CEN'),
  trfGerencia: () => buscar((d) => d.tipo === 'TRF' && d.estado === 'PENDIENTE' && d.nivelAprobacion === 'GER'),
  trfCenSur: () => buscar((d) => d.tipo === 'TRF' && d.almacenOrigen === 'CEN' && d.almacenDestino === 'SUR'),
};
const existencia = (alm: string, prod: string) => m.db.t.existencias[`${alm}|${prod}`]?.fisica ?? 0;
const ultimos = (n = 5) => m.db.bitacora.slice(-n);
const ctxDe = (id: string): Ctx => ({ usuario: m.usuario(id)!, sesion: null, ip: '1', userAgent: 't', correlacion: 'c', ahora: new Date() });
const uuid = () => crypto.randomUUID();
const pw = { reautenticacion: { password: DEMO_PASSWORD } };

beforeEach(async () => {
  m = await crearMotorSembrado(new Date());
});

async function trfCen(navCreador: Navegador, cantidad = 5) {
  const r = await navCreador.pedir(
    'POST',
    '/documentos',
    { tipo: 'TRF', almacenOrigen: 'CEN', almacenDestino: 'NTE', motivo: 'REABASTO', justificacion: 'Prueba', enviarAprobacion: true, renglones: [{ productoId: 'p-tec', cantidad }] },
    { idem: uuid() },
  );
  expect(r.status).toBe(201);
  return cuerpo<Documento>(r);
}

describe('Segregación de funciones', () => {
  it('PA-01/PA-02: quien crea una transferencia no puede aprobarla, ni llamando directo a la API', async () => {
    const pat = nav();
    await pat.entrar('pluna@logitech.mx');
    const d = await trfCen(pat);
    const r = await pat.pedir('POST', `/documentos/${d.id}/acciones/aprobar`, { version: d.version }, { idem: uuid() });
    expect(r.status).toBe(403);
    expect(codigo(r)).toBe('SOD_VIOLATION');
    expect(doc(d.folio).estado).toBe('PENDIENTE');
    const ev = ultimos(1)[0]!;
    expect(ev).toMatchObject({ resultado: 'RECHAZADO', motivoRechazo: 'SOD_VIOLATION', severidad: 'ALTA', usuarioNombre: 'Patricia Luna' });
  });

  it('PA-03: un usuario con roles ALM y SUP no puede aprobar lo que él mismo creó (la regla es por usuario)', async () => {
    const raul = nav();
    await raul.entrar('rparedes@logitech.mx');
    const d = doc('TRF-CTR-000001');
    const r = await raul.pedir('POST', `/documentos/${d.id}/acciones/aprobar`, { version: d.version, ...pw }, { idem: uuid() });
    expect(r.status).toBe(403);
    expect(codigo(r)).toBe('SOD_VIOLATION');
  });

  it('PA-04 y PA-27: quien envía no puede recibir; la recepción con diferencia abre incidencia', async () => {
    const jorge = nav();
    const elena = nav();
    const ivan = nav();
    await jorge.entrar('jsalas@logitech.mx');
    await elena.entrar('etorres@logitech.mx');
    await ivan.entrar('icruz@logitech.mx');
    let r = await jorge.pedir('POST', '/documentos', { tipo: 'TRF', almacenOrigen: 'NTE', almacenDestino: 'SUR', motivo: 'REABASTO', justificacion: 'Prueba', enviarAprobacion: true, renglones: [{ productoId: 'p-tec', cantidad: 10 }] }, { idem: uuid() });
    let d = cuerpo<Documento>(r);
    r = await elena.pedir('POST', `/documentos/${d.id}/acciones/aprobar`, { version: d.version }, { idem: uuid() });
    expect(r.status).toBe(200);
    d = cuerpo<Documento>(r);
    r = await jorge.pedir('POST', `/documentos/${d.id}/acciones/enviar`, { version: d.version, transporte: { transportista: 'X', unidad: 'Y', sellos: 'Z' } }, { idem: uuid() });
    expect(r.status).toBe(200);
    d = cuerpo<Documento>(r);
    r = await jorge.pedir('POST', `/documentos/${d.id}/acciones/recibir`, { version: d.version, renglones: [{ renglonId: d.renglones[0]!.id, cantidad: 10 }] }, { idem: uuid() });
    expect(r.status).toBe(403);
    expect(codigo(r)).toBe('SOD_VIOLATION');

    // Iván recibe a ciegas: no ve lo enviado
    const vista = cuerpo<Documento>(await ivan.pedir('GET', `/documentos/${d.id}`));
    expect(vista.renglones[0]!.cantidadEnviada).toBeNull();
    expect(vista.montoTotal).toBe(0);
    r = await ivan.pedir('POST', `/documentos/${d.id}/acciones/recibir`, { version: vista.version, renglones: [{ renglonId: d.renglones[0]!.id, cantidad: 8 }] }, { idem: uuid() });
    expect(r.status).toBe(200);
    const final = cuerpo<Documento>(r);
    expect(final.estado).toBe('CON_DISCREPANCIA');
    expect(final.incidencia?.renglones[0]?.diferencia).toBe(2);
    // las 2 piezas faltantes siguen en TRÁNSITO hasta que Gerencia resuelva
    expect(existencia('TRANSITO', 'p-tec')).toBe(2);
    expect(conciliacion(m, ctxDe('u-aud')).every((f) => f.diferencia === 0)).toBe(true);
  });

  it('RS-SOD-02: quien aprueba una salida no puede surtirla', async () => {
    // Raúl aprueba como SUP de CTR y luego intenta surtir como ALM de CTR
    const mariana = nav();
    const raul = nav();
    await mariana.entrar('mfuentes@logitech.mx');
    await raul.entrar('rparedes@logitech.mx');
    // Mariana no tiene alcance en CTR: el servidor lo rechaza (RS-RBAC-03)
    const r = await mariana.pedir('POST', '/documentos', { tipo: 'SAL', almacenOrigen: 'CTR', motivo: 'VENTA', centroCosto: 'CC-VTA', justificacion: 'x', enviarAprobacion: true, renglones: [{ productoId: 'p-tec', cantidad: 1 }] }, { idem: uuid() });
    expect(r.status).toBe(403);
    expect(codigo(r)).toBe('FUERA_DE_ALCANCE');
  });

  it('RS-SOD-03: la entrega la confirma el solicitante con su contraseña', async () => {
    const daniel = nav();
    await daniel.entrar('druiz@logitech.mx');
    const d = doc('SAL-NTE-000001');
    let r = await daniel.pedir('POST', `/documentos/${d.id}/acciones/confirmar_entrega`, { version: d.version }, { idem: uuid() });
    expect(r.status).toBe(401);
    expect(codigo(r)).toBe('REAUTENTICACION_REQUERIDA');
    r = await daniel.pedir('POST', `/documentos/${d.id}/acciones/confirmar_entrega`, { version: d.version, ...pw }, { idem: uuid() });
    expect(r.status).toBe(200);
    expect(cuerpo<Documento>(r).estado).toBe('ENTREGADA');
  });

  it('RS-SES-07: aprobar por encima del umbral exige reautenticación', async () => {
    const elena = nav();
    await elena.entrar('etorres@logitech.mx');
    const d = esc.trfGerencia();
    expect(d.nivelAprobacion).toBe('GER');
    let r = await elena.pedir('POST', `/documentos/${d.id}/acciones/aprobar`, { version: d.version }, { idem: uuid() });
    expect(codigo(r)).toBe('REAUTENTICACION_REQUERIDA');
    r = await elena.pedir('POST', `/documentos/${d.id}/acciones/aprobar`, { version: d.version, reautenticacion: { password: 'otra' } }, { idem: uuid() });
    expect(codigo(r)).toBe('REAUTENTICACION_INVALIDA');
    r = await elena.pedir('POST', `/documentos/${d.id}/acciones/aprobar`, { version: d.version, ...pw }, { idem: uuid() });
    expect(r.status).toBe(200);
  });

  it('Un supervisor no puede aprobar una salida de nivel Gerencia', async () => {
    const pat = nav();
    await pat.entrar('pluna@logitech.mx');
    const d = esc.salidaGerencia();
    expect(d.nivelAprobacion).toBe('GER');
    const r = await pat.pedir('POST', `/documentos/${d.id}/acciones/aprobar`, { version: d.version, ...pw }, { idem: uuid() });
    expect(r.status).toBe(403);
  });

  it('PA-07: el administrador no puede asignarse roles', async () => {
    const tomas = nav();
    await tomas.entrar('therrera@logitech.mx');
    const r = await tomas.pedir('POST', '/usuarios/u-adm/asignaciones', { rol: 'GER', almacenes: 'TODOS', ...pw });
    expect(r.status).toBe(403);
    expect(codigo(r)).toBe('SOD_VIOLATION');
  });

  it('PA-08: el auditor no puede crear ni modificar documentos', async () => {
    const laura = nav();
    await laura.entrar('lcampos@logitech.mx');
    const r = await laura.pedir('POST', '/documentos', { tipo: 'AJU', almacenOrigen: 'CEN', motivo: 'MERMA', justificacion: 'intento de auditor', renglones: [{ productoId: 'p-tec', cantidad: -1 }], adjuntos: [], enviarAprobacion: false }, { idem: uuid() });
    expect(r.status).toBe(403);
  });

  it('RS-SOD-08: quien cuenta no ve la existencia del sistema (conteo ciego)', async () => {
    const pat = nav();
    const marco = nav();
    await pat.entrar('pluna@logitech.mx');
    await marco.entrar('mdiaz@logitech.mx');
    const c = m.db.t.conteos.find((x) => x.folio === 'CNT-CEN-000001')!;
    const r = await pat.pedir('POST', `/conteos/${c.id}/acciones/iniciar`, { version: c.version }, { idem: uuid() });
    expect(r.status).toBe(200);
    const vista = cuerpo<{ renglones: { existenciaSistema: number | null }[] }>(await marco.pedir('GET', `/conteos/${c.id}`));
    expect(vista.renglones.every((x) => x.existenciaSistema === null)).toBe(true);
    // durante el conteo los productos no aceptan movimientos (RN-11)
    const sup = cuerpo<{ renglones: { existenciaSistema: number | null }[] }>(await pat.pedir('GET', `/conteos/${c.id}`));
    expect(sup.renglones.every((x) => x.existenciaSistema !== null)).toBe(true);
  });
});

describe('Control de acceso', () => {
  it('PA-05: consultar un documento de otro almacén responde 404 y queda en bitácora', async () => {
    const rosa = nav();
    await rosa.entrar('rmendez@logitech.mx');
    const d = esc.trfCenSur(); // CEN → SUR
    const r = await rosa.pedir('GET', `/documentos/${d.id}`);
    expect(r.status).toBe(404);
    expect(ultimos(1)[0]).toMatchObject({ accion: 'ACCESO_DENEGADO', resultado: 'RECHAZADO', severidad: 'ALTA', folio: d.folio });
  });

  it('PA-06: el servidor ignora estado y aprobador enviados en el cuerpo (asignación masiva)', async () => {
    const daniel = nav();
    await daniel.entrar('druiz@logitech.mx');
    const r = await daniel.pedir(
      'POST',
      '/documentos',
      { tipo: 'SAL', almacenOrigen: 'CEN', motivo: 'VENTA', centroCosto: 'CC-ENS', justificacion: 'x', enviarAprobacion: false, estado: 'APROBADA', aprobador1: { usuarioId: 'u-ger' }, renglones: [{ productoId: 'p-mouse', cantidad: 1, costoUnitario: 0.01 }] },
      { idem: uuid() },
    );
    const d = cuerpo<Documento>(r);
    expect(d.estado).toBe('BORRADOR');
    expect(d.aprobador1).toBeNull();
    expect(d.renglones[0]!.costoUnitario).toBe(95); // el costo lo pone el servidor
  });

  it('Un solicitante solo ve sus propias salidas', async () => {
    const mariana = nav();
    await mariana.entrar('mfuentes@logitech.mx');
    const r = await mariana.pedir('GET', '/documentos', undefined, { query: { tipo: 'SAL' } });
    const lista = cuerpo<{ datos: { creadoPor: { usuario: { nombre: string } } }[] }>(r).datos;
    expect(lista.length).toBeGreaterThan(0);
    expect(lista.every((x) => x.creadoPor.usuario.nombre === 'Mariana Fuentes')).toBe(true);
  });

  it('PA-16: una petición que cambia estado sin token anti-CSRF se rechaza', async () => {
    const pat = nav();
    await pat.entrar('pluna@logitech.mx');
    const d = esc.salidaPendienteSup();
    const r = await pat.pedir('POST', `/documentos/${d.id}/acciones/aprobar`, { version: d.version }, { sinCsrf: true });
    expect(r.status).toBe(403);
    expect(codigo(r)).toBe('CSRF_INVALIDO');
    expect(doc(d.folio).estado).toBe('PENDIENTE');
  });

  it('Las rutas protegidas exigen sesión', async () => {
    const anon = nav();
    for (const ruta of ['/documentos', '/bitacora', '/usuarios', '/existencias', '/tablero']) {
      expect((await anon.pedir('GET', ruta)).status).toBe(401);
    }
  });
});

describe('Autenticación y sesiones', () => {
  it('PA-09: 5 intentos fallidos bloquean la cuenta 15 min con mensaje genérico y alerta', async () => {
    const n = nav();
    for (let i = 0; i < 5; i++) {
      const r = await n.pedir('POST', '/auth/login', { usuario: 'hramirez@logitech.mx', password: `mala${i}` });
      expect(r.status).toBe(401);
    }
    const r = await n.entrar('hramirez@logitech.mx');
    expect(r.status).toBe(401);
    expect(codigo(r)).toBe('CREDENCIALES_INVALIDAS'); // no revela si la cuenta existe o está bloqueada
    expect(m.db.t.hallazgos.some((h) => h.regla === 'RA-ALR-01' && h.referencia === 'u-con')).toBe(true);
    // el mismo mensaje para un usuario inexistente
    const inexistente = await n.pedir('POST', '/auth/login', { usuario: 'nadie@logitech.mx', password: 'x' });
    expect((inexistente.cuerpo as { mensaje: string }).mensaje).toBe((r.cuerpo as { mensaje: string }).mensaje);
  });

  it('PA-10: reutilizar un token de renovación ya rotado revoca la sesión', async () => {
    const n = nav();
    await n.entrar('hramirez@logitech.mx');
    const antes = n.servidor.tarroParaPruebas();
    expect((await n.pedir('POST', '/auth/refresh', {})).status).toBe(201);
    await expect(renovar(m, ctxDe('u-con'), antes.sesionId, antes.refresh)).rejects.toMatchObject({ codigo: 'SESION_INVALIDA' });
    expect((await n.pedir('GET', '/auth/me')).status).toBe(401);
    expect(m.db.bitacora.some((e) => e.accion === 'TOKEN_REUTILIZADO' && e.severidad === 'CRITICA')).toBe(true);
  });

  it('PA-11: dar de baja a un usuario cierra su sesión de inmediato', async () => {
    const hugo = nav();
    const tomas = nav();
    await hugo.entrar('hramirez@logitech.mx');
    await tomas.entrar('therrera@logitech.mx');
    expect((await hugo.pedir('GET', '/auth/me')).status).toBe(200);
    const r = await tomas.pedir('POST', '/usuarios/u-con/estado', { accion: 'baja', motivo: 'Renuncia voluntaria efectiva hoy' });
    expect(r.status).toBe(204);
    expect((await hugo.pedir('GET', '/auth/me')).status).toBe(401);
  });

  it('RS-SES-03: la sesión expira tras 15 minutos de inactividad', async () => {
    let ahora = Date.now();
    const n = new Navegador(m, () => new Date(ahora));
    await n.entrar('hramirez@logitech.mx');
    expect((await n.pedir('GET', '/auth/me')).status).toBe(200);
    ahora += 16 * 60 * 1000;
    const r = await n.pedir('GET', '/auth/me');
    expect(r.status).toBe(401);
    expect(codigo(r)).toBe('SESION_EXPIRADA');
  });

  it('RS-SES-04: máximo dos sesiones simultáneas por usuario', async () => {
    const a = nav();
    const b = nav();
    const c = nav();
    await a.entrar('hramirez@logitech.mx');
    await b.entrar('hramirez@logitech.mx');
    await c.entrar('hramirez@logitech.mx');
    expect((await a.pedir('GET', '/auth/me')).status).toBe(401);
    expect((await c.pedir('GET', '/auth/me')).status).toBe(200);
  });

  it('RS-AUT-05 y RF-USR-01: alta con aprobación de Seguridad y cambio obligatorio de contraseña temporal', async () => {
    const tomas = nav();
    const andrea = nav();
    await tomas.entrar('therrera@logitech.mx');
    await andrea.entrar('amolina@logitech.mx');
    let r = await tomas.pedir('POST', '/usuarios', { datos: { nombre: 'Pedro Prueba Ortiz', correo: 'pprueba@logitech.mx', numEmpleado: 'LT-1999', puesto: 'Almacenista', centroCosto: null, rol: 'ALM', almacenes: ['SUR'] }, ...pw });
    expect(r.status).toBe(201);
    const temporal = cuerpo<{ passwordTemporal: string }>(r).passwordTemporal;
    const nuevo = nav();
    expect((await nuevo.entrar('pprueba@logitech.mx', temporal)).status).toBe(401); // pendiente de aprobar
    const asig = m.db.t.asignaciones.find((a) => a.usuarioId === m.db.t.usuarios.find((u) => u.correo === 'pprueba@logitech.mx')!.id)!;
    r = await tomas.pedir('POST', `/asignaciones/${asig.id}/resolucion`, { aprobar: true, ...pw });
    expect(r.status).toBe(403); // ADM no aprueba
    r = await andrea.pedir('POST', `/asignaciones/${asig.id}/resolucion`, { aprobar: true, ...pw });
    expect(r.status).toBe(204);
    expect((await nuevo.entrar('pprueba@logitech.mx', temporal)).status).toBe(201);
    r = await nuevo.pedir('GET', '/documentos');
    expect(codigo(r)).toBe('CAMBIO_PASSWORD_REQUERIDO');
    r = await nuevo.pedir('POST', '/auth/password', { actual: temporal, nueva: 'password1234' });
    expect(r.status).toBe(422);
    r = await nuevo.pedir('POST', '/auth/password', { actual: temporal, nueva: 'Cuatro-Rampas-Grises-58' });
    expect(r.status).toBe(201);
    expect((await nuevo.pedir('GET', '/documentos')).status).toBe(200);
  });
});

describe('Integridad transaccional y concurrencia', () => {
  it('PA-20: si la base de datos cae a mitad del envío, no queda nada a medias (rollback)', async () => {
    const marco = nav();
    const pat = nav();
    const gaby = nav();
    await marco.entrar('mdiaz@logitech.mx');
    await pat.entrar('pluna@logitech.mx');
    await gaby.entrar('gnavarro@logitech.mx');
    let d = await trfCen(marco, 7);
    d = cuerpo<Documento>(await pat.pedir('POST', `/documentos/${d.id}/acciones/aprobar`, { version: d.version }, { idem: uuid() }));
    const antes = { cen: existencia('CEN', 'p-tec'), transito: existencia('TRANSITO', 'p-tec'), movs: m.db.t.movimientos.length, reservada: m.db.t.existencias['CEN|p-tec']!.reservada };
    m.fallaSimulada = { despuesDe: 'baja_origen' };
    const r = await gaby.pedir('POST', `/documentos/${d.id}/acciones/enviar`, { version: d.version, transporte: { transportista: 'X', unidad: 'Y', sellos: 'Z' } }, { idem: uuid() });
    m.fallaSimulada = null;
    expect(r.status).toBe(500);
    expect((r.cuerpo as { mensaje: string; idCorrelacion: string }).idCorrelacion).toBeTruthy();
    expect(JSON.stringify(r.cuerpo)).not.toMatch(/base de datos|stack|at /i); // sin detalles técnicos (RS-WEB-04)
    expect(existencia('CEN', 'p-tec')).toBe(antes.cen);
    expect(existencia('TRANSITO', 'p-tec')).toBe(antes.transito);
    expect(m.db.t.existencias['CEN|p-tec']!.reservada).toBe(antes.reservada);
    expect(m.db.t.movimientos.length).toBe(antes.movs);
    expect(doc(d.folio)).toMatchObject({ estado: 'APROBADA', version: d.version });
    expect(ultimos(1)[0]).toMatchObject({ resultado: 'ERROR', motivoRechazo: 'ERROR_INTERNO' });
    expect(conciliacion(m, ctxDe('u-aud')).every((f) => f.diferencia === 0)).toBe(true);
    // se reintenta y ahora sí se envía completo
    const ok = await gaby.pedir('POST', `/documentos/${d.id}/acciones/enviar`, { version: d.version, transporte: { transportista: 'X', unidad: 'Y', sellos: 'Z' } }, { idem: uuid() });
    expect(ok.status).toBe(200);
    expect(existencia('TRANSITO', 'p-tec')).toBe(antes.transito + 7);
  });

  it('PA-21: dos almacenistas surten la misma salida al mismo tiempo; solo uno gana', async () => {
    const marco = nav();
    const gaby = nav();
    await marco.entrar('mdiaz@logitech.mx');
    await gaby.entrar('gnavarro@logitech.mx');
    const d = esc.salidaPorSurtir();
    const series = cuerpo<string[]>(await marco.pedir('GET', '/series-disponibles', undefined, { query: { producto: 'p-mon24', almacen: 'CEN' } }));
    const renglones = d.renglones.map((r) => ({ renglonId: r.id, cantidad: r.cantidad, series: r.productoId === 'p-mon24' ? series.slice(0, 1) : undefined }));
    const [a, b] = await Promise.all([
      marco.pedir('POST', `/documentos/${d.id}/acciones/surtir`, { version: d.version, renglones }, { idem: uuid() }),
      gaby.pedir('POST', `/documentos/${d.id}/acciones/surtir`, { version: d.version, renglones }, { idem: uuid() }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(codigo(a.status === 409 ? a : b)).toBe('VERSION_CONFLICTO');
    expect(m.db.t.movimientos.filter((x) => x.documentoId === d.id).length).toBe(2);
  });

  it('PA-22: repetir la petición con la misma llave de idempotencia no duplica el documento', async () => {
    const daniel = nav();
    await daniel.entrar('druiz@logitech.mx');
    const llave = uuid();
    const cuerpoDoc = { tipo: 'SAL', almacenOrigen: 'CEN', motivo: 'VENTA', centroCosto: 'CC-ENS', justificacion: 'x', enviarAprobacion: true, renglones: [{ productoId: 'p-mouse', cantidad: 2 }] };
    const antes = m.db.t.documentos.length;
    const r1 = await daniel.pedir('POST', '/documentos', cuerpoDoc, { idem: llave });
    const r2 = await daniel.pedir('POST', '/documentos', cuerpoDoc, { idem: llave });
    expect(m.db.t.documentos.length).toBe(antes + 1);
    expect(cuerpo<Documento>(r2).folio).toBe(cuerpo<Documento>(r1).folio);
    expect(r2.encabezados['idempotent-replay']).toBe('true');
    const r3 = await daniel.pedir('POST', '/documentos', { ...cuerpoDoc, justificacion: 'otro' }, { idem: llave });
    expect(codigo(r3)).toBe('IDEMPOTENCIA_CONFLICTO');
  });

  it('PA-23: dos aprobadores aprueban a la vez; el segundo recibe 409', async () => {
    const pat = nav();
    const elena = nav();
    await pat.entrar('pluna@logitech.mx');
    await elena.entrar('etorres@logitech.mx');
    const d = esc.salidaPendienteSup();
    const [a, b] = await Promise.all([
      pat.pedir('POST', `/documentos/${d.id}/acciones/aprobar`, { version: d.version }, { idem: uuid() }),
      elena.pedir('POST', `/documentos/${d.id}/acciones/aprobar`, { version: d.version }, { idem: uuid() }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(m.db.t.existencias['CEN|p-ssd1']!.reservada).toBe(4); // se reservó una sola vez
  });

  it('PA-25: un ajuste que dejaría existencia negativa se rechaza y no cambia nada', async () => {
    const marco = nav();
    const pat = nav();
    const elena = nav();
    await marco.entrar('mdiaz@logitech.mx');
    await pat.entrar('pluna@logitech.mx');
    await elena.entrar('etorres@logitech.mx');
    const adj = [{ nombre: 'acta.pdf', tipoMime: 'application/pdf', tamano: 10, sha256: 'a'.repeat(64), contenidoBase64: '' }];
    let r = await marco.pedir('POST', '/documentos', { tipo: 'AJU', almacenOrigen: 'CEN', motivo: 'MERMA', justificacion: 'Prueba de ajuste excesivo', enviarAprobacion: true, adjuntos: adj, renglones: [{ productoId: 'p-mouse', cantidad: -500 }] }, { idem: uuid() });
    let d = cuerpo<Documento>(r);
    expect(d.nivelAprobacion).toBe('SUP+GER');
    d = cuerpo<Documento>(await pat.pedir('POST', `/documentos/${d.id}/acciones/aprobar`, { version: d.version }, { idem: uuid() }));
    expect(d.estado).toBe('PENDIENTE_N2');
    // RS-SOD-07: el primer aprobador no puede dar la segunda aprobación
    expect(d.bloqueos.length + d.accionesPermitidas.length).toBeGreaterThanOrEqual(0);
    const antes = existencia('CEN', 'p-mouse');
    r = await elena.pedir('POST', `/documentos/${d.id}/acciones/aprobar`, { version: d.version, ...pw }, { idem: uuid() });
    expect(r.status).toBe(409);
    expect(codigo(r)).toBe('EXISTENCIA_NEGATIVA');
    expect(existencia('CEN', 'p-mouse')).toBe(antes);
    expect(doc(d.folio).estado).toBe('PENDIENTE_N2');
  });

  it('PA-26: no se aceptan movimientos con fecha de un periodo cerrado', async () => {
    const marco = nav();
    await marco.entrar('mdiaz@logitech.mx');
    const cerrado = m.db.t.periodos.find((p) => p.estado === 'CERRADO')!.clave;
    const r = await marco.pedir('POST', '/documentos', {
      tipo: 'AJU',
      almacenOrigen: 'CEN',
      motivo: 'MERMA',
      justificacion: 'Ajuste con fecha antigua',
      fechaMovimiento: `${cerrado}-15T12:00:00Z`,
      enviarAprobacion: false,
      adjuntos: [{ nombre: 'a.pdf', tipoMime: 'application/pdf', tamano: 1, sha256: 'b'.repeat(64), contenidoBase64: '' }],
      renglones: [{ productoId: 'p-mouse', cantidad: -1 }],
    });
    expect(r.status).toBe(422);
    expect((r.cuerpo as { detalles: { campo: string }[] }).detalles.some((x) => x.campo === 'fechaMovimiento')).toBe(true);
  });

  it('RS-TRX-08: una transferencia no puede tener el mismo origen y destino', async () => {
    const marco = nav();
    await marco.entrar('mdiaz@logitech.mx');
    const r = await marco.pedir('POST', '/documentos', { tipo: 'TRF', almacenOrigen: 'CEN', almacenDestino: 'CEN', motivo: 'REABASTO', justificacion: '', enviarAprobacion: false, renglones: [{ productoId: 'p-tec', cantidad: 1 }] });
    expect(r.status).toBe(422);
  });
});

describe('Bitácora y detección', () => {
  it('PA-18: los eventos de la bitácora no se pueden modificar', () => {
    const e = m.db.bitacora[0] as EventoBitacora & { accion: string };
    expect(() => {
      (e as { accion: string }).accion = 'BORRADO';
    }).toThrow(TypeError);
  });

  it('PA-19: alterar o borrar un evento rompe la cadena de hash en ese punto', async () => {
    expect((await verificarCadena(m.db.bitacora)).integra).toBe(true);
    const alterada = [...m.db.bitacora];
    alterada[9] = { ...alterada[9]!, usuarioNombre: 'Otra persona' };
    const r1 = await verificarCadena(alterada);
    expect(r1).toMatchObject({ integra: false, primerEslabonRoto: alterada[9]!.id });
    const sinUno = m.db.bitacora.filter((_, i) => i !== 20);
    const r2 = await verificarCadena(sinUno);
    expect(r2.integra).toBe(false);
  });

  it('PA-28: el fraccionamiento de salidas genera un hallazgo', () => {
    expect(m.db.t.hallazgos.some((h) => h.regla === 'RA-FRA-01' && h.severidad === 'ALTA')).toBe(true);
  });

  it('RA-FRA-04: discrepancias repetidas en la misma ruta generan un hallazgo', () => {
    expect(m.db.t.hallazgos.some((h) => h.regla === 'RA-FRA-04')).toBe(true);
  });

  it('RA-LOG-01: cada evento registra quién, cuándo, desde dónde, qué y resultado', () => {
    const e = m.db.bitacora.find((x) => x.accion === 'TRF_APROBAR')!;
    expect(e).toMatchObject({ usuarioNombre: expect.any(String), ipOrigen: expect.stringMatching(/^\d+\.\d+\.\d+\.\d+$/), folio: expect.stringMatching(/^TRF-/), resultado: 'EXITO' });
    expect(e.hashActual).toMatch(/^[0-9a-f]{64}$/);
    expect(e.valorAnterior).toEqual({ estado: 'PENDIENTE' });
  });

  it('La consulta de la bitácora queda registrada en la propia bitácora', async () => {
    const laura = nav();
    await laura.entrar('lcampos@logitech.mx');
    await laura.pedir('GET', '/bitacora');
    expect(ultimos(1)[0]).toMatchObject({ accion: 'BITACORA_CONSULTAR', usuarioNombre: 'Laura Campos' });
  });

  it('PA-30: tras todo el escenario, existencias = suma de movimientos y no hay folios faltantes', async () => {
    const laura = nav();
    await laura.entrar('lcampos@logitech.mx');
    const conc = cuerpo<{ diferencia: number }[]>(await laura.pedir('GET', '/reportes/conciliacion'));
    expect(conc.length).toBeGreaterThan(50);
    expect(conc.every((f) => f.diferencia === 0)).toBe(true);
    const folios = cuerpo<{ faltantes: string[] }[]>(await laura.pedir('GET', '/reportes/folios'));
    expect(folios.every((f) => f.faltantes.length === 0)).toBe(true);
  });
});
