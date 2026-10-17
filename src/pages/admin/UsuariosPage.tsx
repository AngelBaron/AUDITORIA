import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { KeyRound, Lock, ShieldCheck, Unlock, UserPlus, UserX } from 'lucide-react';
import { api } from '@/api/cliente';
import { ApiError } from '@/api/http';
import type { AlmacenClave, AsignacionDetalle, RolClave, UsuarioAdmin, UsuarioNuevo } from '@/api/types';
import { useUsuario } from '@/auth/AuthContext';
import { useAvisos } from '@/components/Avisos';
import { BandaError, Dialogo, DialogoConfirmacion } from '@/components/Dialogo';
import { BotonExportarCsv } from '@/components/Exportar';
import { Boton, Cabecera, Campo, Cargando, ErrorCarga, Estado, Pestanas, Vacio } from '@/components/ui';
import { ESTADO_USUARIO } from '@/domain/estados';
import { ALMACEN_NOMBRE, fmtFecha, fmtFechaHora } from '@/domain/formato';
import { evaluarCombinacionRoles, puede, ROL_NOMBRE, ROLES_GLOBALES } from '@/domain/permisos';
import { useConsulta } from '@/hooks/useConsulta';

type Vista = 'usuarios' | 'pendientes' | 'recertificacion' | 'matriz';
const ROLES: RolClave[] = ['ALM', 'SUP', 'GER', 'SOL', 'CMP', 'CON', 'AUD', 'ADM', 'SEG'];
const ALMACENES: AlmacenClave[] = ['CEN', 'NTE', 'CTR', 'SUR'];

const textoAlmacenes = (a: AlmacenClave[] | 'TODOS') => (a === 'TODOS' ? 'Todos' : a.join(', '));

export function UsuariosPage() {
  const yo = useUsuario();
  const [params, setParams] = useSearchParams();
  const esAdm = puede(yo, 'usuarios.gestionar');
  const esSeg = puede(yo, 'usuarios.aprobar');
  const usuarios = useConsulta(() => api.usuarios.listar(), []);
  const pendientes = useConsulta(() => api.usuarios.pendientes(), []);
  const vistas: { valor: Vista; texto: string; contador?: number }[] = [
    { valor: 'usuarios', texto: 'Usuarios' },
    { valor: 'pendientes', texto: 'Solicitudes de acceso', contador: pendientes.datos?.length },
    ...(esSeg ? [{ valor: 'recertificacion' as const, texto: 'Recertificación' }] : []),
    { valor: 'matriz', texto: 'Quién puede qué' },
  ];
  const vista = (vistas.find((v) => v.valor === params.get('pestana'))?.valor ?? 'usuarios') as Vista;
  const [alta, setAlta] = useState(false);
  const [rolPara, setRolPara] = useState<UsuarioAdmin | null>(null);
  const [estadoPara, setEstadoPara] = useState<{ u: UsuarioAdmin; accion: 'baja' | 'bloquear' | 'desbloquear' } | null>(null);
  const [temporal, setTemporal] = useState<{ nombre: string; password: string } | null>(null);
  const { avisar } = useAvisos();

  const recargarTodo = () => {
    void usuarios.recargar();
    void pendientes.recargar();
  };

  return (
    <>
      <Cabecera
        titulo="Usuarios y accesos"
        descripcion="El administrador de sistemas solicita altas y roles; Seguridad de la información los aprueba. Nadie se asigna permisos a sí mismo y las combinaciones de riesgo exigen excepción con fecha de vencimiento."
        acciones={
          esAdm && (
            <Boton variante="primario" icono={<UserPlus aria-hidden />} onClick={() => setAlta(true)}>
              Dar de alta usuario
            </Boton>
          )
        }
      />
      <section className="panel">
        <Pestanas<Vista> etiqueta="Secciones" actual={vista} cambiar={(v) => setParams({ pestana: v }, { replace: true })} opciones={vistas} />
        {vista === 'usuarios' && (
          <TablaUsuarios
            consulta={usuarios}
            yoId={yo.id}
            esAdm={esAdm}
            alSolicitarRol={setRolPara}
            alCambiarEstado={(u, accion) => setEstadoPara({ u, accion })}
            alRetirar={async (a, motivo) => {
              await api.usuarios.retirarAsignacion(a.id, motivo);
              avisar('exito', `Se retiró el rol ${ROL_NOMBRE[a.rol]} a ${a.usuarioNombre}. Sus sesiones se cerraron.`);
              recargarTodo();
            }}
            puedeRetirar={esAdm || esSeg}
          />
        )}
        {vista === 'pendientes' && <Pendientes consulta={pendientes} esSeg={esSeg} yoId={yo.id} yoNombre={yo.nombre} alResolver={recargarTodo} />}
        {vista === 'recertificacion' && <Recertificacion usuarios={usuarios.datos ?? []} yoId={yo.id} alCambiar={recargarTodo} />}
        {vista === 'matriz' && <Matriz />}
      </section>

      <AltaUsuario
        abierto={alta}
        alCerrar={() => setAlta(false)}
        alCrear={(nombre, password) => {
          setAlta(false);
          setTemporal({ nombre, password });
          recargarTodo();
        }}
      />
      <SolicitarRol usuario={rolPara} alCerrar={() => setRolPara(null)} alGuardar={() => { setRolPara(null); avisar('exito', 'Solicitud enviada a Seguridad de la información.'); recargarTodo(); }} />
      <DialogoConfirmacion
        abierto={!!estadoPara}
        titulo={estadoPara ? `${{ baja: 'Dar de baja a', bloquear: 'Bloquear a', desbloquear: 'Desbloquear a' }[estadoPara.accion]} ${estadoPara.u.nombre}` : ''}
        descripcion={
          estadoPara?.accion === 'baja'
            ? 'Se retiran todos sus roles y se cierran sus sesiones de inmediato. Su nombre se conserva en documentos y bitácora. No se puede reactivar.'
            : estadoPara?.accion === 'bloquear'
              ? 'Se cierran sus sesiones y no podrá entrar hasta que lo desbloquees.'
              : 'Podrá volver a iniciar sesión con su contraseña actual.'
        }
        textoConfirmar={estadoPara ? { baja: 'Dar de baja', bloquear: 'Bloquear', desbloquear: 'Desbloquear' }[estadoPara.accion] : ''}
        peligro={estadoPara?.accion !== 'desbloquear'}
        motivoMinimo={15}
        alCerrar={() => setEstadoPara(null)}
        alConfirmar={async (v) => {
          await api.usuarios.cambiarEstado(estadoPara!.u.id, estadoPara!.accion, v.motivo);
          avisar('exito', 'Estado del usuario actualizado.');
          setEstadoPara(null);
          recargarTodo();
        }}
      />
      <Dialogo abierto={!!temporal} titulo="Usuario creado: pendiente de aprobación" alCerrar={() => setTemporal(null)} pie={<Boton variante="primario" onClick={() => setTemporal(null)}>Ya la entregué</Boton>}>
        <p>
          La cuenta de <strong>{temporal?.nombre}</strong> quedó pendiente. Cuando Seguridad apruebe el acceso, la contraseña temporal será válida 24 horas y se pedirá cambiarla en el primer inicio de sesión.
        </p>
        <div className="banda banda--accion">
          <KeyRound aria-hidden />
          <div>
            <strong>Contraseña temporal (se muestra una sola vez)</strong>
            <span className="codigo" style={{ fontSize: 'var(--t-lg)' }}>{temporal?.password}</span>
          </div>
        </div>
        <p className="pequeno suave">Entrégala en persona o por un canal separado del correo. No la guardes.</p>
      </Dialogo>
    </>
  );
}

/* ───────────── Pestaña: usuarios ───────────── */

function TablaUsuarios({
  consulta,
  yoId,
  esAdm,
  puedeRetirar,
  alSolicitarRol,
  alCambiarEstado,
  alRetirar,
}: {
  consulta: ReturnType<typeof useConsulta<UsuarioAdmin[]>>;
  yoId: string;
  esAdm: boolean;
  puedeRetirar: boolean;
  alSolicitarRol: (u: UsuarioAdmin) => void;
  alCambiarEstado: (u: UsuarioAdmin, a: 'baja' | 'bloquear' | 'desbloquear') => void;
  alRetirar: (a: AsignacionDetalle, motivo: string) => Promise<void>;
}) {
  const [retiro, setRetiro] = useState<AsignacionDetalle | null>(null);
  if (consulta.error) return <ErrorCarga error={consulta.error} reintentar={consulta.recargar} />;
  if (!consulta.datos) return <Cargando />;
  return (
    <>
      <div className="tabla-contenedor">
        <table className="tabla">
          <thead>
            <tr>
              <th scope="col">Usuario</th>
              <th scope="col">Estado</th>
              <th scope="col">Roles y alcance</th>
              <th scope="col">MFA</th>
              <th scope="col">Último acceso</th>
              {esAdm && <th scope="col" className="acciones"><span className="sr-only">Acciones</span></th>}
            </tr>
          </thead>
          <tbody>
            {consulta.datos.map((u) => {
              const e = ESTADO_USUARIO[u.estado];
              const inactivo = (u.diasSinUso ?? 0) >= 60;
              return (
                <tr key={u.id}>
                  <td>
                    <strong>{u.nombre}</strong>
                    <span className="tabla__secundario">
                      {u.numEmpleado}, {u.puesto}
                    </span>
                    <span className="tabla__secundario">{u.correo}</span>
                  </td>
                  <td>
                    <Estado tono={e.tono}>{e.texto}</Estado>
                  </td>
                  <td>
                    <div className="pila pila--estrecha">
                      {u.asignaciones.map((a) => (
                        <span key={a.id} className="fila" style={{ gap: 6 }}>
                          <span className="etiqueta">{a.rol}</span>
                          <span className="pequeno">{textoAlmacenes(a.almacenes)}</span>
                          {a.estado === 'PENDIENTE' && <Estado tono="alerta">Pendiente</Estado>}
                          {a.estado === 'RETIRADA' && <Estado tono="neutro">Retirado</Estado>}
                          {a.excepcionSod && <Estado tono="error">Excepción SoD hasta {fmtFecha(a.excepcionSod.vence)}</Estado>}
                          {puedeRetirar && a.estado === 'VIGENTE' && u.id !== yoId && (
                            <button type="button" className="btn btn--fantasma btn--sm" onClick={() => setRetiro(a)}>
                              Retirar
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{u.mfaActivo ? <Estado tono="ok">Activo</Estado> : <span className="suave">No requerido</span>}</td>
                  <td>
                    {fmtFechaHora(u.ultimoAcceso)}
                    {inactivo && <span className="tabla__secundario" style={{ color: 'var(--error-700)' }}>{u.diasSinUso} días sin uso</span>}
                  </td>
                  {esAdm && (
                    <td className="acciones">
                      {u.id !== yoId && u.estado !== 'BAJA' && (
                        <div className="fila" style={{ justifyContent: 'flex-end', gap: 4 }}>
                          <Boton tamano="sm" variante="fantasma" icono={<ShieldCheck aria-hidden />} onClick={() => alSolicitarRol(u)}>
                            Solicitar rol
                          </Boton>
                          {u.estado === 'BLOQUEADO' ? (
                            <Boton tamano="sm" variante="fantasma" icono={<Unlock aria-hidden />} onClick={() => alCambiarEstado(u, 'desbloquear')}>
                              Desbloquear
                            </Boton>
                          ) : (
                            u.estado === 'ACTIVO' && (
                              <Boton tamano="sm" variante="fantasma" icono={<Lock aria-hidden />} onClick={() => alCambiarEstado(u, 'bloquear')}>
                                Bloquear
                              </Boton>
                            )
                          )}
                          <Boton tamano="sm" variante="fantasma" icono={<UserX aria-hidden />} onClick={() => alCambiarEstado(u, 'baja')}>
                            Baja
                          </Boton>
                        </div>
                      )}
                      {u.id === yoId && <span className="suave pequeno">Tu cuenta la gestiona otra persona</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <DialogoConfirmacion
        abierto={!!retiro}
        titulo={retiro ? `Retirar ${ROL_NOMBRE[retiro.rol]} a ${retiro.usuarioNombre}` : ''}
        descripcion="El retiro es inmediato y cierra sus sesiones. Para volver a darle el rol hará falta una nueva solicitud aprobada por Seguridad."
        textoConfirmar="Retirar rol"
        peligro
        motivoMinimo={15}
        alCerrar={() => setRetiro(null)}
        alConfirmar={async (v) => {
          await alRetirar(retiro!, v.motivo);
          setRetiro(null);
        }}
      />
    </>
  );
}

/* ───────────── Pestaña: solicitudes pendientes ───────────── */

function Pendientes({ consulta, esSeg, yoId, yoNombre, alResolver }: { consulta: ReturnType<typeof useConsulta<AsignacionDetalle[]>>; esSeg: boolean; yoId: string; yoNombre: string; alResolver: () => void }) {
  const { avisar } = useAvisos();
  const [decision, setDecision] = useState<{ a: AsignacionDetalle; aprobar: boolean } | null>(null);
  if (consulta.error) return <ErrorCarga error={consulta.error} reintentar={consulta.recargar} />;
  if (!consulta.datos) return <Cargando />;
  if (!consulta.datos.length) return <Vacio titulo="No hay solicitudes pendientes" />;
  return (
    <>
      <div className="tabla-contenedor">
        <table className="tabla">
          <thead>
            <tr>
              <th scope="col">Usuario</th>
              <th scope="col">Rol solicitado</th>
              <th scope="col">Alcance</th>
              <th scope="col">Solicitó</th>
              <th scope="col">Excepción de segregación</th>
              {esSeg && <th scope="col" className="acciones"><span className="sr-only">Acciones</span></th>}
            </tr>
          </thead>
          <tbody>
            {consulta.datos.map((a) => {
              const propia = a.usuarioId === yoId || a.solicitadoPor === yoNombre;
              return (
                <tr key={a.id}>
                  <td>{a.usuarioNombre}</td>
                  <td>{ROL_NOMBRE[a.rol]}</td>
                  <td>{textoAlmacenes(a.almacenes)}</td>
                  <td>
                    {a.solicitadoPor}
                    <span className="tabla__secundario">{fmtFechaHora(a.fechaSolicitud)}</span>
                  </td>
                  <td>
                    {a.excepcionSod ? (
                      <>
                        <Estado tono="error">Vence {fmtFecha(a.excepcionSod.vence)}</Estado>
                        <span className="tabla__secundario">{a.excepcionSod.justificacion}</span>
                      </>
                    ) : (
                      <span className="suave">No aplica</span>
                    )}
                  </td>
                  {esSeg && (
                    <td className="acciones">
                      {propia ? (
                        <span className="suave pequeno">Te involucra: la resuelve otra persona</span>
                      ) : (
                        <div className="fila" style={{ justifyContent: 'flex-end', gap: 4 }}>
                          <Boton tamano="sm" variante="primario" onClick={() => setDecision({ a, aprobar: true })}>
                            Aprobar
                          </Boton>
                          <Boton tamano="sm" onClick={() => setDecision({ a, aprobar: false })}>
                            Rechazar
                          </Boton>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <DialogoConfirmacion
        abierto={!!decision}
        titulo={decision ? `${decision.aprobar ? 'Aprobar' : 'Rechazar'} ${ROL_NOMBRE[decision.a.rol]} para ${decision.a.usuarioNombre}` : ''}
        descripcion={decision?.aprobar ? 'El usuario obtendrá los permisos del rol en el alcance indicado. Sus sesiones abiertas se cerrarán para aplicar el cambio.' : 'La solicitud se cierra sin dar acceso.'}
        textoConfirmar={decision?.aprobar ? 'Aprobar acceso' : 'Rechazar solicitud'}
        peligro={decision ? !decision.aprobar : false}
        motivoMinimo={decision?.aprobar ? 0 : 15}
        pedirPassword
        alCerrar={() => setDecision(null)}
        alConfirmar={async (v) => {
          await api.usuarios.resolverAsignacion(decision!.a.id, decision!.aprobar, v.motivo, v.password);
          avisar('exito', decision!.aprobar ? 'Acceso aprobado.' : 'Solicitud rechazada.');
          setDecision(null);
          alResolver();
        }}
      />
    </>
  );
}

/* ───────────── Pestaña: recertificación ───────────── */

function Recertificacion({ usuarios, yoId, alCambiar }: { usuarios: UsuarioAdmin[]; yoId: string; alCambiar: () => void }) {
  const { avisar, avisarError } = useAvisos();
  const [retiro, setRetiro] = useState<AsignacionDetalle | null>(null);
  const vigentes = usuarios.flatMap((u) => u.asignaciones.filter((a) => a.estado === 'VIGENTE' && u.estado !== 'BAJA')).sort((a, b) => (a.ultimaRecertificacion ?? '').localeCompare(b.ultimaRecertificacion ?? ''));
  const [ahora] = useState(() => Date.now());
  const vencida = (f: string | null) => !f || ahora - new Date(f).getTime() > 90 * 86400000;
  return (
    <>
      <p className="panel__cuerpo suave" style={{ maxWidth: '72ch' }}>
        Cada trimestre confirma que cada persona sigue necesitando sus roles. Lo que no se confirme debe retirarse (RF-USR-04).
      </p>
      <div className="tabla-contenedor">
        <table className="tabla">
          <thead>
            <tr>
              <th scope="col">Usuario</th>
              <th scope="col">Rol</th>
              <th scope="col">Alcance</th>
              <th scope="col">Última recertificación</th>
              <th scope="col" className="acciones"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {vigentes.map((a) => (
              <tr key={a.id}>
                <td>{a.usuarioNombre}</td>
                <td>{ROL_NOMBRE[a.rol]}</td>
                <td>{textoAlmacenes(a.almacenes)}</td>
                <td>
                  {fmtFecha(a.ultimaRecertificacion)}
                  {vencida(a.ultimaRecertificacion) && <span className="tabla__secundario" style={{ color: 'var(--error-700)' }}>Vencida (más de 90 días)</span>}
                </td>
                <td className="acciones">
                  {a.usuarioId === yoId ? (
                    <span className="suave pequeno">Tu acceso lo recertifica otra persona</span>
                  ) : (
                    <div className="fila" style={{ justifyContent: 'flex-end', gap: 4 }}>
                      <Boton
                        tamano="sm"
                        onClick={async () => {
                          try {
                            await api.usuarios.recertificar(a.id, true);
                            avisar('exito', `Rol de ${a.usuarioNombre} confirmado.`);
                            alCambiar();
                          } catch (e) {
                            avisarError(e);
                          }
                        }}
                      >
                        Confirmar
                      </Boton>
                      <Boton tamano="sm" variante="fantasma" onClick={() => setRetiro(a)}>
                        Retirar
                      </Boton>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DialogoConfirmacion
        abierto={!!retiro}
        titulo={retiro ? `Retirar ${ROL_NOMBRE[retiro.rol]} a ${retiro.usuarioNombre}` : ''}
        descripcion="El rol se retira de inmediato y se cierran sus sesiones."
        textoConfirmar="Retirar rol"
        peligro
        motivoMinimo={15}
        alCerrar={() => setRetiro(null)}
        alConfirmar={async (v) => {
          await api.usuarios.recertificar(retiro!.id, false, v.motivo);
          avisar('exito', 'Rol retirado.');
          setRetiro(null);
          alCambiar();
        }}
      />
    </>
  );
}

/* ───────────── Pestaña: matriz de permisos ───────────── */

function Matriz() {
  const { datos, error, cargando, recargar } = useConsulta(() => api.usuarios.matriz(), []);
  if (error) return <ErrorCarga error={error} reintentar={recargar} />;
  if (cargando || !datos) return <Cargando />;
  return (
    <>
      <div className="panel__cuerpo fila fila--entre">
        <p className="suave" style={{ maxWidth: '72ch' }}>
          Evidencia para el auditor (RS-ACC-11): cada usuario con sus roles vigentes, alcance y permisos efectivos.
        </p>
        <BotonExportarCsv reporte="matriz_permisos" nombreArchivo="quien_puede_que" encabezados={['Usuario', 'Rol', 'Almacenes', 'Permisos']} filas={datos.map((f) => [f.usuario, f.rol, f.almacenes, f.permisos.join(' ')])} />
      </div>
      <div className="tabla-contenedor">
        <table className="tabla">
          <thead>
            <tr>
              <th scope="col">Usuario</th>
              <th scope="col">Rol</th>
              <th scope="col">Almacenes</th>
              <th scope="col">Permisos</th>
            </tr>
          </thead>
          <tbody>
            {datos.map((f, i) => (
              <tr key={i}>
                <td>{f.usuario}</td>
                <td>{ROL_NOMBRE[f.rol]}</td>
                <td>{f.almacenes}</td>
                <td>
                  <div className="series-lista" style={{ marginTop: 0 }}>
                    {f.permisos.map((p) => (
                      <span key={p} className="serie">
                        {p}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ───────────── Formularios ───────────── */

function SelectorAlcance({ rol, almacenes, cambiar }: { rol: RolClave; almacenes: AlmacenClave[]; cambiar: (a: AlmacenClave[]) => void }) {
  if (ROLES_GLOBALES.includes(rol)) return <p className="pequeno suave">Este rol aplica a todos los almacenes.</p>;
  return (
    <fieldset className="pila pila--estrecha" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="campo__etiqueta">Almacenes</legend>
      <div className="fila">
        {ALMACENES.map((a) => (
          <label key={a} className="casilla">
            <input type="checkbox" checked={almacenes.includes(a)} onChange={(e) => cambiar(e.target.checked ? [...almacenes, a] : almacenes.filter((x) => x !== a))} />
            {ALMACEN_NOMBRE[a]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AltaUsuario({ abierto, alCerrar, alCrear }: { abierto: boolean; alCerrar: () => void; alCrear: (nombre: string, password: string) => void }) {
  const [d, setD] = useState<UsuarioNuevo>({ nombre: '', correo: '', numEmpleado: '', puesto: '', centroCosto: null, rol: 'ALM', almacenes: [] });
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const err = error?.erroresPorCampo() ?? {};

  useEffect(() => {
    if (abierto) {
      setD({ nombre: '', correo: '', numEmpleado: '', puesto: '', centroCosto: null, rol: 'ALM', almacenes: [] });
      setPassword('');
      setError(null);
    }
  }, [abierto]);

  const guardar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const r = await api.usuarios.crear({ ...d, almacenes: ROLES_GLOBALES.includes(d.rol) ? 'TODOS' : d.almacenes }, password);
      alCrear(d.nombre, r.passwordTemporal);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setPassword('');
      setEnviando(false);
    }
  };

  return (
    <Dialogo
      abierto={abierto}
      ancho
      titulo="Dar de alta usuario"
      alCerrar={alCerrar}
      alEnviar={() => void guardar()}
      pie={
        <>
          <Boton onClick={alCerrar}>Volver</Boton>
          <Boton type="submit" variante="primario" cargando={enviando}>
            Crear y enviar a aprobación
          </Boton>
        </>
      }
    >
      <p className="suave">La cuenta queda pendiente hasta que Seguridad de la información apruebe el rol. No se permiten cuentas compartidas ni genéricas.</p>
      {error && <BandaError error={error} />}
      <div className="rejilla-form">
        <Campo etiqueta="Nombre completo" requerido error={err.nombre}>
          {(p) => <input {...p} className="entrada" maxLength={80} autoComplete="off" value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} />}
        </Campo>
        <Campo etiqueta="Correo laboral" requerido error={err.correo}>
          {(p) => <input {...p} className="entrada" type="email" maxLength={120} autoComplete="off" placeholder="nombre@logitech.mx" value={d.correo} onChange={(e) => setD({ ...d, correo: e.target.value })} />}
        </Campo>
        <Campo etiqueta="Número de empleado" requerido error={err.numEmpleado} ayuda="Formato LT-0000">
          {(p) => <input {...p} className="entrada codigo" maxLength={7} value={d.numEmpleado} onChange={(e) => setD({ ...d, numEmpleado: e.target.value.toUpperCase() })} />}
        </Campo>
        <Campo etiqueta="Puesto" requerido error={err.puesto}>
          {(p) => <input {...p} className="entrada" maxLength={60} value={d.puesto} onChange={(e) => setD({ ...d, puesto: e.target.value })} />}
        </Campo>
        <Campo etiqueta="Rol inicial" requerido error={err.rol}>
          {(p) => (
            <select {...p} className="entrada" value={d.rol} onChange={(e) => setD({ ...d, rol: e.target.value as RolClave })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROL_NOMBRE[r]}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <div className="rejilla-form__ancho">
          <SelectorAlcance rol={d.rol} almacenes={d.almacenes === 'TODOS' ? [] : d.almacenes} cambiar={(a) => setD({ ...d, almacenes: a })} />
          {err.almacenes && <span className="campo__error">{err.almacenes}</span>}
        </div>
        <Campo etiqueta="Tu contraseña" requerido className="rejilla-form__ancho" ayuda="Confirma tu identidad: crear accesos es una operación de alto impacto.">
          {(p) => <input {...p} className="entrada" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Campo>
      </div>
    </Dialogo>
  );
}

function SolicitarRol({ usuario, alCerrar, alGuardar }: { usuario: UsuarioAdmin | null; alCerrar: () => void; alGuardar: () => void }) {
  const [rol, setRol] = useState<RolClave>('ALM');
  const [almacenes, setAlmacenes] = useState<AlmacenClave[]>([]);
  const [justificacion, setJustificacion] = useState('');
  const [vence, setVence] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    setRol('ALM');
    setAlmacenes([]);
    setJustificacion('');
    setVence('');
    setPassword('');
    setError(null);
  }, [usuario]);

  const existentes = (usuario?.asignaciones ?? []).filter((a) => a.estado === 'VIGENTE' || a.estado === 'PENDIENTE');
  const evaluacion = evaluarCombinacionRoles(existentes, { rol, almacenes: ROLES_GLOBALES.includes(rol) ? 'TODOS' : almacenes });
  const [maxVence] = useState(() => new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10));

  const guardar = async () => {
    if (!usuario || evaluacion?.tipo === 'prohibida') return;
    setEnviando(true);
    setError(null);
    try {
      await api.usuarios.solicitarRol(
        usuario.id,
        { rol, almacenes: ROLES_GLOBALES.includes(rol) ? 'TODOS' : almacenes, excepcionSod: evaluacion?.tipo === 'excepcion' ? { justificacion, vence } : null },
        password,
      );
      alGuardar();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setPassword('');
      setEnviando(false);
    }
  };

  return (
    <Dialogo
      abierto={!!usuario}
      ancho
      titulo={`Solicitar rol para ${usuario?.nombre ?? ''}`}
      alCerrar={alCerrar}
      alEnviar={() => void guardar()}
      pie={
        <>
          <Boton onClick={alCerrar}>Volver</Boton>
          <Boton type="submit" variante="primario" cargando={enviando} disabled={evaluacion?.tipo === 'prohibida'}>
            Enviar solicitud
          </Boton>
        </>
      }
    >
      {error && <BandaError error={error} />}
      <p className="pequeno suave">Roles actuales: {existentes.map((a) => `${ROL_NOMBRE[a.rol]} (${textoAlmacenes(a.almacenes)})`).join('; ') || 'ninguno'}.</p>
      <Campo etiqueta="Rol" requerido>
        {(p) => (
          <select {...p} className="entrada" value={rol} onChange={(e) => setRol(e.target.value as RolClave)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROL_NOMBRE[r]}
              </option>
            ))}
          </select>
        )}
      </Campo>
      <SelectorAlcance rol={rol} almacenes={almacenes} cambiar={setAlmacenes} />
      {evaluacion?.tipo === 'prohibida' && (
        <div className="banda banda--bloqueo" role="alert">
          <Lock aria-hidden />
          <div>
            <strong>Combinación prohibida ({evaluacion.codigo})</strong>
            {evaluacion.mensaje}
          </div>
        </div>
      )}
      {evaluacion?.tipo === 'excepcion' && (
        <>
          <div className="banda banda--accion" role="status">
            <div>
              <strong>Requiere excepción ({evaluacion.codigo})</strong>
              {evaluacion.mensaje}
            </div>
          </div>
          <Campo etiqueta="Justificación y control compensatorio" requerido ayuda="Mínimo 40 caracteres.">
            {(p) => <textarea {...p} className="entrada" maxLength={500} value={justificacion} onChange={(e) => setJustificacion(e.target.value)} />}
          </Campo>
          <Campo etiqueta="La excepción vence el" requerido ayuda="Máximo 180 días.">
            {(p) => <input {...p} type="date" className="entrada" min={new Date().toISOString().slice(0, 10)} max={maxVence} value={vence} onChange={(e) => setVence(e.target.value)} />}
          </Campo>
        </>
      )}
      <Campo etiqueta="Tu contraseña" requerido ayuda="Asignar roles es una operación de alto impacto.">
        {(p) => <input {...p} className="entrada" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Campo>
    </Dialogo>
  );
}
