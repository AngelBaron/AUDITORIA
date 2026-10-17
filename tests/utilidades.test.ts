import { celdaCsvSegura, esDecimal, evaluarPassword, generarCsv, igualSeguro, limpiarTexto, sha256Hex, validarArchivo } from '@/domain/seguridad';
import { destinoSeguro } from '@/pages/auth/AccesoPage';
import { sanearDetalle } from '@/api/mock/bitacora';
import { fmtMoneda, redondear } from '@/domain/formato';

describe('Política de contraseñas (RS-AUT-01)', () => {
  it('rechaza contraseñas cortas', () => {
    expect(evaluarPassword('Corta.1').valida).toBe(false);
  });
  it('rechaza contraseñas comunes aunque cumplan la longitud', () => {
    expect(evaluarPassword('password1234').valida).toBe(false);
  });
  it('rechaza el nombre de la empresa o datos personales', () => {
    expect(evaluarPassword('Logitech.Segura.2026').valida).toBe(false);
    expect(evaluarPassword('Marcodiaz.Bodega9', { nombre: 'Marco Díaz', correo: 'mdiaz@logitech.mx' }).valida).toBe(false);
  });
  it('rechaza repeticiones largas', () => {
    expect(evaluarPassword('aaaaBodega.Norte9').valida).toBe(false);
  });
  it('acepta una frase larga y no común', () => {
    const r = evaluarPassword('Tres-Cajas-Azules-71', { nombre: 'Marco Díaz' });
    expect(r.valida).toBe(true);
    expect(r.nivel).toBeGreaterThanOrEqual(3);
  });
});

describe('Exportación CSV segura (RS-VAL-06, PA-15)', () => {
  it.each(['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)'])('neutraliza la fórmula %s', (v) => {
    expect(celdaCsvSegura(v).replace(/^"/, '')).toMatch(/^'/);
  });
  it('escapa comillas y comas', () => {
    expect(celdaCsvSegura('a,"b"')).toBe('"a,""b"""');
  });
  it('incluye BOM para que Excel respete los acentos', () => {
    expect(generarCsv(['Almacén'], [['Sur']]).charCodeAt(0)).toBe(0xfeff);
  });
});

describe('Validación de adjuntos por firma real (RS-VAL-05, PA-14)', () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  it('acepta un PDF real', () => expect(validarArchivo('acta.pdf', 1000, pdf)).toEqual({ ok: true, mime: 'application/pdf' }));
  it('rechaza un ejecutable renombrado a .pdf', () => expect(validarArchivo('acta.pdf', 1000, exe).ok).toBe(false));
  it('rechaza un PNG con extensión .pdf', () => expect(validarArchivo('acta.pdf', 1000, png).ok).toBe(false));
  it('rechaza archivos de más de 5 MB', () => expect(validarArchivo('foto.png', 6 * 1024 * 1024, png).ok).toBe(false));
  it('rechaza archivos vacíos', () => expect(validarArchivo('foto.png', 0, png).ok).toBe(false));
});

describe('Entradas y redirecciones', () => {
  it('valida cantidades decimales sin regex vulnerables', () => {
    expect(esDecimal('12')).toBe(true);
    expect(esDecimal('12.5')).toBe(true);
    expect(esDecimal('12.12345')).toBe(false);
    expect(esDecimal('1e5')).toBe(false);
    expect(esDecimal('-3')).toBe(false);
    expect(esDecimal('1.2.3')).toBe(false);
    expect(esDecimal('12345678')).toBe(false);
  });
  it('elimina caracteres de control del texto libre', () => {
    expect(limpiarTexto('hola\u0000\u0007 mundo\nok ')).toBe('hola mundo\nok');
  });
  it('evita redirecciones abiertas tras el login', () => {
    expect(destinoSeguro('/salidas?estado=PENDIENTE')).toBe('/salidas?estado=PENDIENTE');
    expect(destinoSeguro('//evil.com')).toBe('/');
    expect(destinoSeguro('https://evil.com')).toBe('/');
    expect(destinoSeguro('/acceso')).toBe('/');
    expect(destinoSeguro('javascript:alert(1)')).toBe('/');
    expect(destinoSeguro(undefined)).toBe('/');
  });
  it('compara secretos en tiempo constante', () => {
    expect(igualSeguro('abc', 'abc')).toBe(true);
    expect(igualSeguro('abc', 'abd')).toBe(false);
    expect(igualSeguro('abc', 'abcd')).toBe(false);
  });
});

describe('Bitácora: saneamiento del detalle (RA-LOG-05, RA-LOG-11)', () => {
  it('nunca guarda contraseñas ni tokens', () => {
    const r = sanearDetalle({ password: 'x', reautenticacion: { password: 'y' }, csrfToken: 'z', ok: 1 }) as Record<string, unknown>;
    expect(JSON.stringify(r)).not.toMatch(/"x"|"y"|"z"/);
    expect(r.ok).toBe(1);
  });
  it('quita saltos de línea (inyección de logs) y enmascara correos', () => {
    expect(sanearDetalle('linea1\nFALSO EVENTO')).toBe('linea1 FALSO EVENTO');
    expect(sanearDetalle('contacto mdiaz@logitech.mx')).toBe('contacto md***@logitech.mx');
  });
});

describe('Formatos', () => {
  it('redondea centavos sin errores de punto flotante', () => {
    expect(redondear(0.1 + 0.2)).toBe(0.3);
    expect(redondear(1.005)).toBe(1.01);
  });
  it('muestra moneda en MXN', () => {
    expect(fmtMoneda(1234.5)).toMatch(/1,234\.50/);
  });
  it('calcula SHA-256 conocido', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
