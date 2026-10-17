import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { api } from '@/api/cliente';
import { usarServidorMock } from '@/api/http';
import { ServidorMock } from '@/api/mock/servidor';
import { crearMotorSembrado } from '@/api/mock/sembrar';
import { DEMO_PASSWORD, DEMO_TOTP } from '@/api/mock/semilla';
import { DialogoConfirmacion } from '@/components/Dialogo';

async function iniciarApp(ruta = '/') {
  const motor = await crearMotorSembrado(new Date());
  usarServidorMock(new ServidorMock({ motor, latencia: [0, 0] }));
  window.history.pushState({}, '', ruta);
  render(<App />);
  return motor;
}

async function entrar(correo: string, password = DEMO_PASSWORD) {
  const u = userEvent.setup();
  await u.type(await screen.findByLabelText(/correo laboral/i), correo);
  await u.type(screen.getByLabelText(/^contraseña/i), password);
  await u.click(screen.getByRole('button', { name: /entrar/i }));
  return u;
}

describe('Acceso', () => {
  it('sin sesión redirige al inicio de sesión y conserva la ruta pedida', async () => {
    await iniciarApp('/salidas');
    expect(await screen.findByRole('heading', { name: /inicia sesión/i })).toBeInTheDocument();
  });

  it('muestra un error genérico con credenciales incorrectas (RS-AUT-03)', async () => {
    await iniciarApp('/acceso');
    await entrar('druiz@logitech.mx', 'incorrecta-123');
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/usuario o contraseña incorrectos/i);
    // la contraseña se borra del formulario
    expect(screen.getByLabelText(/^contraseña/i)).toHaveValue('');
  });

  it('un solicitante entra sin MFA y solo ve las secciones de su rol', async () => {
    await iniciarApp('/acceso');
    await entrar('druiz@logitech.mx');
    expect(await screen.findByRole('heading', { name: /hola, daniel/i })).toBeInTheDocument();
    const menu = screen.getByRole('complementary', { name: /menú principal/i });
    expect(within(menu).getByRole('link', { name: /salidas/i })).toBeInTheDocument();
    expect(within(menu).queryByRole('link', { name: /bitácora/i })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('link', { name: /usuarios y accesos/i })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('link', { name: /transferencias/i })).not.toBeInTheDocument();
  });

  it('un supervisor debe capturar el segundo factor (RS-AUT-04)', async () => {
    await iniciarApp('/acceso');
    const u = await entrar('pluna@logitech.mx');
    const otp = await screen.findByLabelText(/código de verificación/i);
    await u.type(otp, '000000');
    await u.click(screen.getByRole('button', { name: /verificar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/código incorrecto/i);
    await u.type(screen.getByLabelText(/código de verificación/i), DEMO_TOTP);
    await u.click(screen.getByRole('button', { name: /verificar/i }));
    expect(await screen.findByRole('heading', { name: /hola, patricia/i })).toBeInTheDocument();
  });

  it('una ruta sin permiso muestra "sin acceso" aunque se escriba la URL a mano', async () => {
    await iniciarApp('/acceso');
    await entrar('druiz@logitech.mx');
    await screen.findByRole('heading', { name: /hola, daniel/i });
    window.history.pushState({}, '', '/usuarios');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await screen.findByText(/tu rol no tiene acceso a esta sección/i)).toBeInTheDocument();
  });
});

describe('Cliente HTTP', () => {
  it('renueva el token de acceso de forma transparente y sin intervención del usuario (RS-SES-01)', async () => {
    let ahora = Date.now();
    const motor = await crearMotorSembrado(new Date());
    usarServidorMock(new ServidorMock({ motor, latencia: [0, 0], reloj: () => new Date(ahora) }));
    await api.auth.login('hramirez@logitech.mx', DEMO_PASSWORD);
    ahora += 10 * 60 * 1000;
    await api.auth.yo();
    ahora += 10 * 60 * 1000; // el token de acceso (15 min) ya expiró, pero hubo actividad
    const u = await api.auth.yo();
    expect(u.nombre).toBe('Hugo Ramírez');
    expect(motor.db.bitacora.some((e) => e.accion === 'SESION_RENOVAR')).toBe(false); // la renovación exitosa no es un evento de negocio
  });

  it('traduce los errores con su código de correlación para soporte', async () => {
    const motor = await crearMotorSembrado(new Date());
    usarServidorMock(new ServidorMock({ motor, latencia: [0, 0] }));
    await api.auth.login('druiz@logitech.mx', DEMO_PASSWORD);
    await expect(api.usuarios.listar()).rejects.toMatchObject({ status: 403, codigo: 'SIN_PERMISO', idCorrelacion: expect.stringMatching(/^req-/) });
  });
});

describe('Confirmación de acciones sensibles', () => {
  it('no permite rechazar sin un motivo suficiente', async () => {
    const confirmar = vi.fn().mockResolvedValue(undefined);
    const u = userEvent.setup();
    render(<DialogoConfirmacion abierto titulo="Rechazar" descripcion="x" textoConfirmar="Rechazar" peligro motivoMinimo={15} alCerrar={() => undefined} alConfirmar={confirmar} />);
    await u.click(screen.getByRole('button', { name: 'Rechazar' }));
    expect(confirmar).not.toHaveBeenCalled();
    expect(screen.getByText(/al menos 15 caracteres/i)).toBeInTheDocument();
    await u.type(screen.getByLabelText(/motivo/i), 'No hay presupuesto este mes');
    await u.click(screen.getByRole('button', { name: 'Rechazar' }));
    expect(confirmar).toHaveBeenCalledWith({ motivo: 'No hay presupuesto este mes', password: '' });
  });

  it('pide la contraseña en operaciones de alto impacto y la borra si falla', async () => {
    const confirmar = vi.fn().mockRejectedValue(new Error('x'));
    const u = userEvent.setup();
    render(<DialogoConfirmacion abierto titulo="Aprobar" descripcion="x" textoConfirmar="Aprobar" pedirPassword alCerrar={() => undefined} alConfirmar={confirmar} />);
    await u.click(screen.getByRole('button', { name: 'Aprobar' }));
    expect(confirmar).not.toHaveBeenCalled();
    await u.type(screen.getByLabelText(/tu contraseña/i), 'secreto');
    await u.click(screen.getByRole('button', { name: 'Aprobar' }));
    await waitFor(() => expect(screen.getByLabelText(/tu contraseña/i)).toHaveValue(''));
  });
});
