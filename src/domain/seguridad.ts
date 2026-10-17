/**
 * Utilidades de seguridad del lado del cliente.
 * Ninguna sustituye la validación del servidor: dan retroalimentación inmediata
 * y evitan enviar datos que de todos modos serían rechazados.
 */

/* ───────────── Contraseñas (RS-AUT-01) ───────────── */

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** Muestra de las contraseñas más comunes; el servidor valida contra 10,000. */
const COMUNES = new Set(
  [
    '123456789012', 'password1234', 'contraseña123', 'contrasena123', 'qwertyuiop12', 'administrador',
    'admin1234567', 'bienvenido123', 'bienvenido2026', 'mexico123456', 'cambiame1234', 'iloveyou1234',
    'abc123456789', 'passw0rd1234', 'p@ssw0rd1234', '111111111111', '000000000000', 'qwerty123456',
    '1q2w3e4r5t6y', 'zaq12wsxcde3', 'superman1234', 'monkey123456', 'dragon123456', 'football1234',
    'letmein12345', 'trustno12345', 'sunshine1234', 'princesa1234', 'tequila12345', 'america12345',
    'chivas123456', 'almacen12345', 'inventario12', 'inventario2026', 'temporal1234', 'usuario12345',
  ].map((s) => s.toLowerCase()),
);

export interface ResultadoPassword {
  valida: boolean;
  nivel: 0 | 1 | 2 | 3 | 4;
  reglas: { clave: string; texto: string; ok: boolean }[];
}

export function evaluarPassword(
  password: string,
  contexto: { nombre?: string; correo?: string; numEmpleado?: string } = {},
): ResultadoPassword {
  const p = password;
  const bajo = p.toLowerCase();
  const tokensPersonales = [
    'logitech',
    'sicil',
    ...(contexto.nombre ?? '').toLowerCase().split(/\s+/).filter((t) => t.length >= 3),
    (contexto.correo ?? '').toLowerCase().split('@')[0] ?? '',
    (contexto.numEmpleado ?? '').toLowerCase(),
  ].filter((t) => t.length >= 3);

  const reglas = [
    { clave: 'longitud', texto: `Al menos ${PASSWORD_MIN} caracteres`, ok: p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX },
    { clave: 'comun', texto: 'No es una contraseña común', ok: p.length > 0 && !COMUNES.has(bajo) },
    {
      clave: 'personal',
      texto: 'No contiene tu nombre, usuario ni el nombre de la empresa',
      ok: p.length > 0 && !tokensPersonales.some((t) => bajo.includes(t)),
    },
    { clave: 'repeticion', texto: 'Sin el mismo carácter 4 veces seguidas', ok: p.length > 0 && !/(.)\1{3,}/.test(p) },
  ];

  const valida = reglas.every((r) => r.ok);
  let nivel: ResultadoPassword['nivel'] = 0;
  if (p.length > 0) {
    const variedad = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
    const puntos = (p.length >= 12 ? 1 : 0) + (p.length >= 16 ? 1 : 0) + (variedad >= 3 ? 1 : 0) + (valida ? 1 : 0);
    nivel = Math.max(1, Math.min(4, puntos)) as ResultadoPassword['nivel'];
    if (!valida) nivel = 1;
  }
  return { valida, nivel, reglas };
}

/* ───────────── Exportación CSV (RS-VAL-06) ───────────── */

/**
 * Neutraliza la inyección de fórmulas: una celda que empieza con = + - @ (o tabulador/retorno)
 * se antepone con apóstrofo para que Excel la trate como texto.
 */
export function celdaCsvSegura(valor: unknown): string {
  let s = valor == null ? '' : String(valor);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function generarCsv(encabezados: string[], filas: unknown[][]): string {
  const lineas = [encabezados.map(celdaCsvSegura).join(','), ...filas.map((f) => f.map(celdaCsvSegura).join(','))];
  // BOM para que Excel respete UTF-8 (acentos)
  return `\uFEFF${lineas.join('\r\n')}`;
}

export function descargarArchivo(nombre: string, contenido: BlobPart, tipo: string): void {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre.replace(/[^\w.-]+/g, '_');
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ───────────── Archivos adjuntos (RS-VAL-05) ───────────── */

export const ADJUNTO_MAX_BYTES = 5 * 1024 * 1024;

const FIRMAS: { mime: string; ext: string[]; bytes: number[] }[] = [
  { mime: 'application/pdf', ext: ['pdf'], bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { mime: 'image/png', ext: ['png'], bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', ext: ['jpg', 'jpeg'], bytes: [0xff, 0xd8, 0xff] },
];

export type ResultadoArchivo = { ok: true; mime: string } | { ok: false; error: string };

/** Valida tamaño, extensión y la firma real del contenido (no confía en la extensión). */
export function validarArchivo(nombre: string, tamano: number, cabecera: Uint8Array): ResultadoArchivo {
  if (tamano === 0) return { ok: false, error: 'El archivo está vacío.' };
  if (tamano > ADJUNTO_MAX_BYTES) return { ok: false, error: 'El archivo supera 5 MB. Comprime la imagen o el PDF.' };
  const ext = nombre.split('.').pop()?.toLowerCase() ?? '';
  const firma = FIRMAS.find((f) => f.bytes.every((b, i) => cabecera[i] === b));
  if (!firma) return { ok: false, error: 'Solo se aceptan PDF, JPG o PNG. El contenido del archivo no corresponde a ninguno de esos formatos.' };
  if (!firma.ext.includes(ext)) {
    return { ok: false, error: `La extensión .${ext || '?'} no coincide con el contenido real del archivo (${firma.ext[0]?.toUpperCase()}).` };
  }
  return { ok: true, mime: firma.mime };
}

export async function sha256Hex(datos: ArrayBuffer | Uint8Array | string): Promise<string> {
  const buffer =
    typeof datos === 'string' ? new TextEncoder().encode(datos) : datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  const hash = await crypto.subtle.digest('SHA-256', buffer as BufferSource);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function aBase64(bytes: Uint8Array): string {
  let bin = '';
  const paso = 0x8000;
  for (let i = 0; i < bytes.length; i += paso) bin += String.fromCharCode(...bytes.subarray(i, i + paso));
  return btoa(bin);
}

/* ───────────── Texto libre (RS-VAL-04) ───────────── */

/** Elimina caracteres de control (salvo salto de línea) y recorta. React ya escapa al mostrar. */
export function limpiarTexto(s: string, max = 500): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function nuevaLlaveIdempotencia(): string {
  return crypto.randomUUID();
}

/** Comparación en tiempo constante (evita ataques de temporización al comparar secretos). */
export function igualSeguro(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let dif = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) dif |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return dif === 0;
}

/** Número decimal positivo con límite de enteros y decimales, sin expresiones regulares anidadas. */
export function esDecimal(v: string, maxEnteros = 7, maxDecimales = 4): boolean {
  const partes = v.trim().split('.');
  if (partes.length > 2) return false;
  const [ent = '', dec] = partes;
  const soloDigitos = (x: string) => x.length > 0 && [...x].every((c) => c >= '0' && c <= '9');
  if (!soloDigitos(ent) || ent.length > maxEnteros) return false;
  if (dec !== undefined && (!soloDigitos(dec) || dec.length > maxDecimales)) return false;
  return true;
}
