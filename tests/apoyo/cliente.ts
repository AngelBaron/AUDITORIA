/**
 * Cliente de pruebas: cada instancia es un "navegador" con su propio tarro de cookies,
 * conectado al mismo motor (la misma "base de datos").
 */
import { ServidorMock, type RespuestaMock } from '@/api/mock/servidor';
import type { Motor } from '@/api/mock/motor';
import { DEMO_PASSWORD, DEMO_TOTP } from '@/api/mock/semilla';

export class Navegador {
  readonly servidor: ServidorMock;
  private csrf: string | null = null;

  constructor(motor: Motor, reloj?: () => Date) {
    this.servidor = new ServidorMock({ motor, latencia: [0, 0], reloj });
  }

  async pedir(metodo: string, ruta: string, cuerpo?: unknown, opciones: { idem?: string; sinCsrf?: boolean; query?: Record<string, string> } = {}): Promise<RespuestaMock> {
    if (metodo !== 'GET' && !this.csrf && !opciones.sinCsrf) {
      const r = await this.servidor.manejar({ metodo: 'GET', ruta: '/auth/csrf', query: new URLSearchParams(), cuerpo: undefined, encabezados: {} });
      this.csrf = (r.cuerpo as { token: string }).token;
    }
    const encabezados: Record<string, string> = {};
    if (metodo !== 'GET' && !opciones.sinCsrf && this.csrf) encabezados['x-csrf-token'] = this.csrf;
    if (opciones.idem) encabezados['idempotency-key'] = opciones.idem;
    const r = await this.servidor.manejar({
      metodo,
      ruta,
      query: new URLSearchParams(opciones.query ?? {}),
      cuerpo: cuerpo === undefined ? undefined : JSON.parse(JSON.stringify(cuerpo)),
      encabezados,
      userAgent: 'vitest',
    });
    // el servidor rota el token CSRF al iniciar sesión
    if (ruta === '/auth/login' || ruta === '/auth/mfa') this.csrf = null;
    return r;
  }

  async entrar(correo: string, password = DEMO_PASSWORD): Promise<RespuestaMock> {
    let r = await this.pedir('POST', '/auth/login', { usuario: correo, password });
    if (r.status === 201 && (r.cuerpo as { estado: string }).estado === 'MFA_REQUERIDO') {
      r = await this.pedir('POST', '/auth/mfa', { desafioId: (r.cuerpo as { desafioId: string }).desafioId, codigo: DEMO_TOTP });
    }
    return r;
  }
}

export const codigo = (r: RespuestaMock) => (r.cuerpo as { codigo?: string } | null)?.codigo;
export const cuerpo = <T>(r: RespuestaMock) => r.cuerpo as T;
