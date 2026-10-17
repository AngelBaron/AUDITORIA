/**
 * Carga el escenario de demostración ejecutando el propio motor (no se insertan datos "a mano"),
 * de modo que documentos, movimientos, existencias y bitácora sean coherentes entre sí
 * y la conciliación dé cero diferencias.
 */
import type { AccionDocumento, AlmacenClave, CuerpoAccion, DocumentoNuevo } from '@/api/types';
import { ROLES_CON_MFA } from '@/domain/permisos';
import { Motor, type Ctx } from './motor';
import { login } from './autenticacion';
import { proponerParametro, solicitarAsignacion, crearUsuario } from './administracion';
import { accionConteo, crearOc, programarConteo } from './inventario';
import { ALMACENES, DEMO_PASSWORD, PARAMETROS, PRODUCTOS, PROVEEDORES, USUARIOS } from './semilla';
import type { ConteoDB, DocumentoDB } from './estado';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HORA = 3600 * 1000;
const DIA = 24 * HORA;

export async function crearMotorSembrado(ahoraReal: Date = new Date()): Promise<Motor> {
  const m = new Motor();
  m.proveedores = PROVEEDORES;
  const T = ahoraReal.getTime();
  const inicio = new Date(T - 45 * DIA);

  /** Fecha relativa; si se da horaLocal, se fija esa hora de Ciudad de México (UTC-6). */
  const hace = (dias: number, horaLocal?: number, minuto = 0): Date => {
    const d = new Date(T - dias * DIA);
    if (horaLocal == null) return d;
    const dia = new Date(d.getTime() - 6 * HORA).toISOString().slice(0, 10);
    return new Date(`${dia}T${String(horaLocal).padStart(2, '0')}:${String(minuto).padStart(2, '0')}:00-06:00`);
  };

  const ctx = (uid: string | null, fecha: Date): Ctx => {
    const u = uid ? m.usuario(uid)! : null;
    return { usuario: u, sesion: null, ip: u?.ipHabitual ?? '127.0.0.1', userAgent: UA, correlacion: `seed-${crypto.randomUUID().slice(0, 8)}`, ahora: fecha };
  };

  /* ── Usuarios, roles y parámetros ── */
  for (const s of USUARIOS) {
    const necesitaMfa = s.roles.some((r) => ROLES_CON_MFA.includes(r.rol));
    m.db.t.usuarios.push({
      id: s.id,
      correo: s.correo,
      nombre: s.nombre,
      numEmpleado: s.numEmpleado,
      puesto: s.puesto,
      centroCosto: s.centroCosto,
      password: DEMO_PASSWORD,
      historialPasswords: [],
      estado: 'ACTIVO',
      intentosFallidos: 0,
      bloqueadoHasta: null,
      mfaActivo: necesitaMfa,
      debeCambiarPassword: false,
      passwordTemporalExpira: null,
      ultimoAcceso: null,
      ultimoAccesoAnterior: null,
      fallidosDesdeUltimoAcceso: 0,
      fallidosPendientes: 0,
      ipHabitual: s.ip,
      creadoPor: 'u-adm',
      creadoEn: inicio.toISOString(),
    });
    s.roles.forEach((r, i) =>
      m.db.t.asignaciones.push({
        id: `asg-${s.id}-${i}`,
        usuarioId: s.id,
        rol: r.rol,
        almacenes: r.almacenes,
        estado: 'VIGENTE',
        solicitadoPor: 'u-adm',
        aprobadoPor: 'u-seg',
        fechaSolicitud: inicio.toISOString(),
        ultimaRecertificacion: new Date(T - 70 * DIA).toISOString(),
        excepcionSod: r.excepcion ?? null,
      }),
    );
  }
  m.db.t.parametros = PARAMETROS.map((p) => ({ ...p, modificadoPor: null, modificadoEn: null, solicitud: null }));
  m.db.t.productos = PRODUCTOS.map((p) => ({
    id: p.id,
    sku: p.sku,
    descripcion: p.descripcion,
    categoria: p.categoria,
    unidad: p.unidad,
    costoEstandar: p.costo,
    costoPromedio: p.costo,
    stockMinimo: p.min,
    stockMaximo: p.max,
    puntoReorden: p.reorden,
    claseAbc: p.clase,
    serializado: p.serializado,
    sensible: p.sensible,
    activo: true,
    version: 1,
    historialCosto: [{ fecha: inicio.toISOString(), anterior: 0, nuevo: p.costo, motivo: 'Alta del producto', usuarioId: 'u-cmp' }],
  }));

  await m.registrarSuelto(ctx('u-adm', inicio), { accion: 'SISTEMA_INSTALAR', entidad: 'sistema', valorNuevo: { version: '1.0.0', almacenes: ALMACENES.map((a) => a.clave) }, severidad: 'MEDIA' });

  /* ── Utilidades de escenario ── */
  const crear = (uid: string, fecha: Date, datos: DocumentoNuevo) =>
    m.transaccion(ctx(uid, fecha), { accion: `${datos.tipo}_CREAR`, entidad: 'documento' }, () => m.crearDocumento(ctx(uid, fecha), datos));
  const accion = (uid: string, fecha: Date, doc: DocumentoDB, a: AccionDocumento, extra: Omit<CuerpoAccion, 'version'> = {}) =>
    m.transaccion(ctx(uid, fecha), { accion: `${doc.tipo}_${a.toUpperCase()}`, entidad: 'documento', idEntidad: doc.id, folio: doc.folio, almacen: doc.almacenOrigen ?? doc.almacenDestino }, () =>
      m.ejecutarAccion(ctx(uid, fecha), doc, a, { version: doc.version, reautenticacion: { password: DEMO_PASSWORD }, ...extra }),
    );
  const seriesDe = (productoId: string, almacen: AlmacenClave, n: number, excluir: string[] = []) =>
    Object.entries(m.db.t.series)
      .filter(([k, v]) => v.productoId === productoId && v.ubicacion === almacen && !excluir.includes(k))
      .map(([k]) => k)
      .sort()
      .slice(0, n);
  const ren = (doc: DocumentoDB, cantidades?: Record<string, number>, quitarSerie?: Record<string, number>) =>
    doc.renglones.map((r) => {
      const p = m.producto(r.productoId);
      const cant = cantidades?.[p.sku] ?? r.cantidadEnviada ?? r.cantidad;
      const series = p.serializado ? r.series.slice(0, Math.max(0, r.series.length - (quitarSerie?.[p.sku] ?? 0))) : undefined;
      return { renglonId: r.id, cantidad: p.serializado ? (series?.length ?? 0) : cant, series };
    });
  const surtidoCon = (doc: DocumentoDB) =>
    doc.renglones.map((r) => {
      const p = m.producto(r.productoId);
      return { renglonId: r.id, cantidad: r.cantidad, series: p.serializado ? seriesDe(p.id, doc.almacenOrigen!, r.cantidad) : undefined };
    });

  /* ── Inventario inicial por almacén (entrada extraordinaria autorizada) ── */
  const contador: Record<string, number> = {};
  const almacenistas: Record<AlmacenClave, [string, string]> = {
    CEN: ['u-alm-cen', 'u-sup-cen'],
    NTE: ['u-alm-nte', 'u-sup-nte'],
    CTR: ['u-mixto-ctr', 'u-ger'],
    SUR: ['u-alm-sur', 'u-sup-nte'],
  };
  for (const [i, alm] of (['CEN', 'NTE', 'CTR', 'SUR'] as AlmacenClave[]).entries()) {
    const f = new Date(inicio.getTime() + i * 3 * HORA + 9 * HORA);
    const [capturista, autoriza] = almacenistas[alm];
    const doc = await crear(capturista, f, {
      tipo: 'ENT',
      almacenDestino: alm,
      proveedorId: 'prov-1',
      justificacion: 'Inventario inicial de arranque de SICIL, conciliado contra el conteo físico de cierre del sistema anterior.',
      enviarAprobacion: false,
      renglones: PRODUCTOS.filter((p) => (p.inicial[alm] ?? 0) > 0).map((p) => {
        const n = p.inicial[alm]!;
        return {
          productoId: p.id,
          cantidad: n,
          costoUnitario: p.costo,
          series: p.serializado
            ? Array.from({ length: n }, () => {
                contador[p.sku] = (contador[p.sku] ?? 0) + 1;
                return `${p.sku}-${String(contador[p.sku]).padStart(5, '0')}`;
              })
            : undefined,
        };
      }),
    });
    await accion(capturista, new Date(f.getTime() + 20 * 60 * 1000), doc, 'confirmar_recepcion');
    await accion(autoriza, new Date(f.getTime() + 2 * HORA), doc, 'aprobar');
  }

  /*
   * Escenario. Cada paso lleva su fecha y se ejecuta en orden cronológico, para que la
   * secuencia de la bitácora y de los movimientos coincida con las fechas (como en producción).
   */
  const pasos: { t: number; orden: number; fn: () => Promise<unknown> }[] = [];
  const en = (fecha: Date, fn: () => Promise<unknown>) => pasos.push({ t: fecha.getTime(), orden: pasos.length, fn });
  const mas = (f: Date, minutos: number) => new Date(f.getTime() + minutos * 60 * 1000);
  const docs: Record<string, DocumentoDB> = {};
  const ocs: Record<string, string> = {};
  const transporte = (transportista: string, unidad: string, sellos: string) => ({ transportista, unidad, sellos });

  /* ── Compras y recepciones ── */
  en(hace(12, 10), () =>
    m.transaccion(ctx('u-cmp', hace(12, 10)), { accion: 'OC_CREAR', entidad: 'orden_compra' }, () => {
      ocs.oc1 = crearOc(m, ctx('u-cmp', hace(12, 10)), {
        proveedorId: 'prov-2',
        almacenDestino: 'CEN',
        renglones: [
          { productoId: 'p-ram16', cantidad: 40, costoUnitario: 860 },
          { productoId: 'p-psu650', cantidad: 12, costoUnitario: 1310 },
        ],
      }).id;
    }),
  );
  en(hace(10, 11), async () => {
    docs.recep1 = await crear('u-alm-cen', hace(10, 11), {
      tipo: 'ENT',
      almacenDestino: 'CEN',
      ordenCompraId: ocs.oc1,
      justificacion: 'Factura A-48211',
      enviarAprobacion: false,
      renglones: [
        { productoId: 'p-ram16', cantidad: 40 },
        { productoId: 'p-psu650', cantidad: 12 },
      ],
    });
  });
  en(hace(10, 11, 25), () => accion('u-alm-cen', hace(10, 11, 25), docs.recep1!, 'confirmar_recepcion'));

  en(hace(4, 9), () =>
    m.transaccion(ctx('u-cmp', hace(4, 9)), { accion: 'OC_CREAR', entidad: 'orden_compra' }, () => {
      ocs.oc2 = crearOc(m, ctx('u-cmp', hace(4, 9)), {
        proveedorId: 'prov-3',
        almacenDestino: 'NTE',
        renglones: [
          { productoId: 'p-ups', cantidad: 4, costoUnitario: 3050 },
          { productoId: 'p-utp', cantidad: 6, costoUnitario: 2350 },
        ],
      }).id;
    }),
  );
  en(hace(1, 16), () =>
    m.transaccion(ctx('u-cmp', hace(1, 16)), { accion: 'OC_CREAR', entidad: 'orden_compra' }, () =>
      crearOc(m, ctx('u-cmp', hace(1, 16)), {
        proveedorId: 'prov-2',
        almacenDestino: 'CEN',
        renglones: [
          { productoId: 'p-ssd1', cantidad: 20, costoUnitario: 1150 },
          { productoId: 'p-ram32', cantidad: 15, costoUnitario: 1690 },
        ],
      }),
    ),
  );
  en(hace(0.3), async () => {
    docs.recep2 = await crear('u-alm-nte', hace(0.3), {
      tipo: 'ENT',
      almacenDestino: 'NTE',
      ordenCompraId: ocs.oc2,
      justificacion: 'Remisión R-9932. Llegó una caja de cable menos.',
      enviarAprobacion: false,
      renglones: [
        { productoId: 'p-ups', cantidad: 4, series: ['UPS-1500-90001', 'UPS-1500-90002', 'UPS-1500-90003', 'UPS-1500-90004'] },
        { productoId: 'p-utp', cantidad: 5 },
      ],
    });
  });
  en(mas(hace(0.3), 10), () => accion('u-alm-nte', mas(hace(0.3), 10), docs.recep2!, 'confirmar_recepcion'));

  /* ── Salidas ── */
  en(hace(9, 9), async () => {
    docs.s1 = await crear('u-sol', hace(9, 9), {
      tipo: 'SAL',
      almacenOrigen: 'CEN',
      motivo: 'CONSUMO_PRODUCCION',
      centroCosto: 'CC-ENS',
      justificacion: 'Ensamble de 4 equipos para pedido PV-2231',
      enviarAprobacion: true,
      renglones: [
        { productoId: 'p-ram16', cantidad: 8 },
        { productoId: 'p-gab', cantidad: 4 },
        { productoId: 'p-psu650', cantidad: 4 },
      ],
    });
  });
  en(hace(9, 10, 40), () => accion('u-sup-cen', hace(9, 10, 40), docs.s1!, 'aprobar'));
  en(hace(9, 12), () => accion('u-alm-cen2', hace(9, 12), docs.s1!, 'surtir', { renglones: surtidoCon(docs.s1!) }));
  en(hace(9, 13), () => accion('u-sol', hace(9, 13), docs.s1!, 'confirmar_entrega'));

  // Fraccionamiento: tres salidas el mismo día, cada una bajo el umbral de GER (RA-FRA-01)
  for (const [k, hora] of [
    [0, 9],
    [1, 12],
    [2, 15],
  ] as const) {
    const clave = `frac${k}`;
    en(hace(6, hora), async () => {
      docs[clave] = await crear('u-sol2', hace(6, hora), {
        tipo: 'SAL',
        almacenOrigen: 'CEN',
        motivo: 'VENTA',
        centroCosto: 'CC-VTA',
        justificacion: `Pedido de cliente corporativo, entrega parcial ${k + 1}`,
        enviarAprobacion: true,
        renglones: [{ productoId: 'p-ram32', cantidad: 8 }],
      });
    });
    if (k < 2) {
      en(hace(6, hora + 1), () => accion('u-sup-cen', hace(6, hora + 1), docs[clave]!, 'aprobar'));
      en(hace(6, hora + 2), () => accion('u-alm-cen', hace(6, hora + 2), docs[clave]!, 'surtir', { renglones: surtidoCon(docs[clave]!) }));
      en(hace(6, hora + 2, 40), () => accion('u-sol2', hace(6, hora + 2, 40), docs[clave]!, 'confirmar_entrega'));
    } else {
      en(hace(6, hora + 1), () => accion('u-sup-cen', hace(6, hora + 1), docs[clave]!, 'rechazar', { motivo: 'Se detectó posible fraccionamiento; solicitar en un solo documento.' }));
    }
  }

  en(hace(1.5), async () => {
    docs.s5 = await crear('u-sol', hace(1.5), {
      tipo: 'SAL',
      almacenOrigen: 'NTE',
      motivo: 'CONSUMO_PRODUCCION',
      centroCosto: 'CC-ENS',
      justificacion: 'Kit de herramientas y consumibles para ensamble foráneo',
      enviarAprobacion: true,
      renglones: [
        { productoId: 'p-pasta', cantidad: 4 },
        { productoId: 'p-torn', cantidad: 10 },
      ],
    });
  });
  en(hace(1.45), () => accion('u-sup-nte', hace(1.45), docs.s5!, 'aprobar'));
  en(hace(1.4), () => accion('u-alm-nte', hace(1.4), docs.s5!, 'surtir', { renglones: surtidoCon(docs.s5!) }));

  en(hace(0.9), () =>
    crear('u-sol', hace(0.9), {
      tipo: 'SAL',
      almacenOrigen: 'CEN',
      motivo: 'CONSUMO_PRODUCCION',
      centroCosto: 'CC-ENS',
      justificacion: 'Reposición de componentes para línea de ensamble 2',
      enviarAprobacion: true,
      renglones: [
        { productoId: 'p-ssd1', cantidad: 4 },
        { productoId: 'p-ram16', cantidad: 8 },
        { productoId: 'p-torn', cantidad: 20 },
      ],
    }),
  );
  en(hace(0.85), async () => {
    docs.s4 = await crear('u-sol', hace(0.85), {
      tipo: 'SAL',
      almacenOrigen: 'CEN',
      motivo: 'GARANTIA',
      centroCosto: 'CC-SOP',
      justificacion: 'Reposición en garantía del ticket SOP-1188',
      enviarAprobacion: true,
      renglones: [
        { productoId: 'p-mon24', cantidad: 1 },
        { productoId: 'p-hdmi', cantidad: 2 },
      ],
    });
  });
  en(hace(0.8), () => accion('u-sup-cen', hace(0.8), docs.s4!, 'aprobar'));
  en(hace(0.2), () =>
    crear('u-sol2', hace(0.2), {
      tipo: 'SAL',
      almacenOrigen: 'CEN',
      motivo: 'VENTA',
      centroCosto: 'CC-VTA',
      justificacion: 'Venta de 2 laptops a cliente Grupo Industrial Ayala',
      enviarAprobacion: true,
      renglones: [{ productoId: 'p-lap', cantidad: 2 }],
    }),
  );

  /* ── Transferencias ── */
  en(hace(14, 9), async () => {
    docs.t1 = await crear('u-alm-cen', hace(14, 9), {
      tipo: 'TRF',
      almacenOrigen: 'CEN',
      almacenDestino: 'NTE',
      motivo: 'REABASTO',
      justificacion: 'Reabasto quincenal Norte',
      enviarAprobacion: true,
      renglones: [
        { productoId: 'p-tec', cantidad: 20 },
        { productoId: 'p-mouse', cantidad: 20 },
        { productoId: 'p-ssd2', cantidad: 3 },
      ],
    });
  });
  en(hace(14, 10), () => accion('u-sup-cen', hace(14, 10), docs.t1!, 'aprobar'));
  en(hace(14, 13), () =>
    accion('u-alm-cen', hace(14, 13), docs.t1!, 'enviar', { transporte: transporte('Transportes del Bajío', 'Camioneta 3.5 t placas NLA-4421', 'S-77810, S-77811'), renglones: surtidoCon(docs.t1!) }),
  );
  en(hace(12, 11), () => accion('u-alm-nte', hace(12, 11), docs.t1!, 'recibir', { renglones: ren(docs.t1!) }));

  en(hace(9, 8), async () => {
    docs.t2 = await crear('u-alm-cen', hace(9, 8), {
      tipo: 'TRF',
      almacenOrigen: 'CEN',
      almacenDestino: 'SUR',
      motivo: 'REABASTO',
      justificacion: 'Reabasto mensual Sur',
      enviarAprobacion: true,
      renglones: [
        { productoId: 'p-ram16', cantidad: 10 },
        { productoId: 'p-hdmi', cantidad: 20 },
      ],
    });
  });
  en(hace(9, 9, 30), () => accion('u-sup-cen', hace(9, 9, 30), docs.t2!, 'aprobar'));
  en(hace(9, 15), () =>
    accion('u-alm-cen2', hace(9, 15), docs.t2!, 'enviar', { transporte: transporte('Fletes Rápidos del Sureste', 'Tractocamión placas YUC-1187', 'S-80211'), renglones: surtidoCon(docs.t2!) }),
  );
  en(hace(7, 10), () => accion('u-alm-sur', hace(7, 10), docs.t2!, 'recibir', { renglones: ren(docs.t2!, { 'RAM-D5-16': 8 }) }));
  en(hace(6, 12, 30), () =>
    accion('u-ger', hace(6, 12, 30), docs.t2!, 'resolver_incidencia', {
      tipoResolucion: 'FALTANTE_IMPUTABLE',
      motivo: 'Sello íntegro pero faltan 2 memorias; se levantó acta con el transportista y se reclamará el costo.',
    }),
  );

  en(hace(4, 9, 30), async () => {
    docs.t3 = await crear('u-alm-cen', hace(4, 9, 30), {
      tipo: 'TRF',
      almacenOrigen: 'CEN',
      almacenDestino: 'SUR',
      motivo: 'REABASTO',
      justificacion: 'Reabasto de almacenamiento para Sur',
      enviarAprobacion: true,
      renglones: [
        { productoId: 'p-ssd1', cantidad: 4 },
        { productoId: 'p-gab', cantidad: 5 },
      ],
    });
  });
  en(hace(4, 10), () => accion('u-sup-cen', hace(4, 10), docs.t3!, 'aprobar'));
  en(hace(4, 14), () =>
    accion('u-alm-cen2', hace(4, 14), docs.t3!, 'enviar', { transporte: transporte('Fletes Rápidos del Sureste', 'Tractocamión placas YUC-1187', 'S-80377'), renglones: surtidoCon(docs.t3!) }),
  );
  en(hace(2, 11), () => accion('u-alm-sur', hace(2, 11), docs.t3!, 'recibir', { renglones: ren(docs.t3!, undefined, { 'SSD-NV1T': 1 }) }));

  en(hace(1.2), async () => {
    docs.t4 = await crear('u-alm-cen', hace(1.2), {
      tipo: 'TRF',
      almacenOrigen: 'CEN',
      almacenDestino: 'NTE',
      motivo: 'BALANCEO',
      justificacion: 'Balanceo de memorias hacia Norte por alta demanda',
      enviarAprobacion: true,
      renglones: [
        { productoId: 'p-ram16', cantidad: 15 },
        { productoId: 'p-cpu5', cantidad: 2 },
      ],
    });
  });
  en(hace(1.1), () => accion('u-sup-cen', hace(1.1), docs.t4!, 'aprobar'));
  en(hace(1.0), () =>
    accion('u-alm-cen2', hace(1.0), docs.t4!, 'enviar', { transporte: transporte('Transportes del Bajío', 'Camioneta 3.5 t placas NLA-4421', 'S-81002'), renglones: surtidoCon(docs.t4!) }),
  );
  en(hace(0.25), async () => {
    docs.trfRaul = await crear('u-mixto-ctr', hace(0.25), {
      tipo: 'TRF',
      almacenOrigen: 'CTR',
      almacenDestino: 'CEN',
      motivo: 'BALANCEO',
      justificacion: 'Regreso de memorias sin rotación a Central',
      enviarAprobacion: true,
      renglones: [{ productoId: 'p-ram32', cantidad: 3 }],
    });
  });
  // Intento de autoaprobación registrado en bitácora (PA-01)
  en(hace(0.24), () => accion('u-mixto-ctr', hace(0.24), docs.trfRaul!, 'aprobar').catch(() => undefined));
  en(hace(0.18), () =>
    crear('u-alm-cen', hace(0.18), {
      tipo: 'TRF',
      almacenOrigen: 'CEN',
      almacenDestino: 'NTE',
      motivo: 'REABASTO',
      justificacion: 'Procesadores para armado de equipos en Norte',
      enviarAprobacion: true,
      renglones: [{ productoId: 'p-cpu7', cantidad: 10 }],
    }),
  );
  en(hace(0.1), () =>
    crear('u-alm-nte', hace(0.1), {
      tipo: 'TRF',
      almacenOrigen: 'NTE',
      almacenDestino: 'CTR',
      motivo: 'REABASTO',
      justificacion: 'Reabasto de periféricos para Centro',
      enviarAprobacion: true,
      renglones: [
        { productoId: 'p-tec', cantidad: 10 },
        { productoId: 'p-mouse', cantidad: 10 },
      ],
    }),
  );

  /* ── Ajustes ── */
  en(hace(15, 23, 10), async () => {
    docs.a1 = await crear('u-alm-nte', hace(15, 23, 10), {
      tipo: 'AJU',
      almacenOrigen: 'NTE',
      motivo: 'DANIO',
      justificacion: 'Dos mouse con cable dañado por humedad en rack B-3',
      enviarAprobacion: true,
      adjuntos: [{ nombre: 'foto_mouse_danados.jpg', tipoMime: 'image/jpeg', tamano: 284112, sha256: 'b1946ac92492d2347c6235b4d2611184f0a7c2d2e3b9b8f1c3d4e5f60718293a', contenidoBase64: '' }],
      renglones: [{ productoId: 'p-mouse', cantidad: -2 }],
    });
  });
  en(hace(14, 8, 30), () => accion('u-sup-nte', hace(14, 8, 30), docs.a1!, 'aprobar'));
  en(hace(1.25), () =>
    crear('u-alm-cen', hace(1.25), {
      tipo: 'AJU',
      almacenOrigen: 'CEN',
      motivo: 'ROBO',
      justificacion: 'Faltante de una unidad SSD detectado en revisión de rack A-1; se levantó reporte interno RI-0042.',
      enviarAprobacion: true,
      adjuntos: [{ nombre: 'acta_RI-0042.pdf', tipoMime: 'application/pdf', tamano: 128440, sha256: '5d41402abc4b2a76b9719d911017c592ae2b9f6c3a7d8e9f00112233445566ff', contenidoBase64: '' }],
      renglones: [{ productoId: 'p-ssd1', cantidad: -1, series: seriesDe('p-ssd1', 'CEN', 1) }],
    }),
  );
  en(hace(1.05), async () => {
    docs.a3 = await crear('u-alm-cen2', hace(1.05), {
      tipo: 'AJU',
      almacenOrigen: 'CEN',
      motivo: 'MERMA',
      justificacion: 'Memorias con daño electrostático detectadas en control de calidad',
      enviarAprobacion: true,
      adjuntos: [{ nombre: 'reporte_calidad_QC-311.pdf', tipoMime: 'application/pdf', tamano: 96220, sha256: '9e107d9d372bb6826bd81d3542a419d6e277d4d731479571562f82f74494341e', contenidoBase64: '' }],
      renglones: [{ productoId: 'p-ram32', cantidad: -6 }],
    });
  });
  en(hace(0.95), () => accion('u-sup-cen', hace(0.95), docs.a3!, 'aprobar'));

  /* ── Conteos ── */
  let c1: ConteoDB | null = null;
  en(hace(11, 8), async () => {
    c1 = await m.transaccion(ctx('u-sup-nte', hace(11, 8)), { accion: 'CNT_PROGRAMAR', entidad: 'conteo' }, () =>
      programarConteo(m, ctx('u-sup-nte', hace(11, 8)), { almacen: 'NTE', tipo: 'CICLICO', clase: 'C' }),
    );
  });
  en(hace(11, 8, 30), () => m.transaccion(ctx('u-sup-nte', hace(11, 8, 30)), { accion: 'CNT_INICIAR', entidad: 'conteo' }, () => accionConteo(m, ctx('u-sup-nte', hace(11, 8, 30)), c1!, 'iniciar', { version: c1!.version })));
  en(hace(11, 11), () =>
    m.transaccion(ctx('u-alm-nte', hace(11, 11)), { accion: 'CNT_CAPTURAR_PRIMERO', entidad: 'conteo' }, () =>
      accionConteo(m, ctx('u-alm-nte', hace(11, 11)), c1!, 'capturar_primero', {
        version: c1!.version,
        renglones: c1!.renglones.map((r) => ({ productoId: r.productoId, cantidad: r.existenciaSistema - (m.producto(r.productoId).sku === 'CAB-HDMI-2M' ? 1 : 0) })),
      }),
    ),
  );
  en(hace(11, 13), () => m.transaccion(ctx('u-sup-nte', hace(11, 13)), { accion: 'CNT_CERRAR', entidad: 'conteo' }, () => accionConteo(m, ctx('u-sup-nte', hace(11, 13)), c1!, 'cerrar', { version: c1!.version })));
  en(hace(10, 10), async () => {
    const ajusteConteo = m.db.t.documentos.find((d) => d.id === c1!.ajustesGenerados[0]);
    if (ajusteConteo) await accion('u-ger', hace(10, 10), ajusteConteo, 'aprobar');
  });
  en(hace(0.6), () =>
    m.transaccion(ctx('u-sup-cen', hace(0.6)), { accion: 'CNT_PROGRAMAR', entidad: 'conteo' }, () => programarConteo(m, ctx('u-sup-cen', hace(0.6)), { almacen: 'CEN', tipo: 'CICLICO', clase: 'B' })),
  );

  /* ── Accesos y parámetros pendientes ── */
  en(hace(0.4), () =>
    m.transaccion(ctx('u-adm', hace(0.4)), { accion: 'USUARIO_CREAR', entidad: 'usuario' }, () =>
      crearUsuario(
        m,
        ctx('u-adm', hace(0.4)),
        { nombre: 'Lucía Herrera Pineda', correo: 'lherrera@logitech.mx', numEmpleado: 'LT-1602', puesto: 'Almacenista', centroCosto: null, rol: 'ALM', almacenes: ['SUR'] },
        DEMO_PASSWORD,
      ),
    ),
  );
  en(hace(0.35), () =>
    m.transaccion(ctx('u-adm', hace(0.35)), { accion: 'ROL_SOLICITAR', entidad: 'asignacion' }, () =>
      solicitarAsignacion(
        m,
        ctx('u-adm', hace(0.35)),
        'u-alm-sur',
        { rol: 'SUP', almacenes: ['SUR'], excepcionSod: { justificacion: 'Cobertura temporal de supervisión en Sur durante vacaciones de Jorge Salas; revisión diaria de bitácora por GER.', vence: new Date(T + 20 * DIA).toISOString().slice(0, 10) } },
        DEMO_PASSWORD,
      ),
    ),
  );
  en(hace(0.3), () =>
    m.transaccion(ctx('u-adm', hace(0.3)), { accion: 'PARAMETRO_PROPONER', entidad: 'parametro' }, () =>
      proponerParametro(m, ctx('u-adm', hace(0.3)), 'umbral_salida_ger', 25000, 'Ajuste por inflación de costos de componentes en el último trimestre.', DEMO_PASSWORD),
    ),
  );

  /* ── Intentos de acceso fallidos desde una IP externa (alerta RA-ALR-01) ── */
  en(hace(1, 2, 14), async () => {
    for (let i = 0; i < 5; i++) {
      const c = { ...ctx(null, new Date(hace(1, 2, 14).getTime() + i * 40 * 1000)), ip: '189.203.44.17', userAgent: 'python-requests/2.32' };
      await login(m, c, 'druiz@logitech.mx', `intento${i}`).catch(() => undefined);
    }
    const daniel = m.usuario('u-sol')!;
    daniel.bloqueadoHasta = null; // el bloqueo de 15 min ya expiró
    daniel.intentosFallidos = 0;
  });

  pasos.sort((x, y) => x.t - y.t || x.orden - y.orden);
  for (const p of pasos) await p.fn();

  /* ── Cierre del periodo de hace dos meses ── */
  const dosMeses = new Date(Date.UTC(ahoraReal.getUTCFullYear(), ahoraReal.getUTCMonth() - 2, 1)).toISOString().slice(0, 7);
  m.db.t.periodos.push({ clave: dosMeses, estado: 'CERRADO', cerradoPor: { usuarioId: 'u-con', fecha: hace(15, 18).toISOString() }, solicitudReapertura: null });

  // Últimos accesos realistas
  const accesos: Record<string, number> = { 'u-alm-cen': 0.5, 'u-alm-nte': 0.2, 'u-alm-sur': 2, 'u-alm-cen2': 1, 'u-sup-cen': 0.6, 'u-sup-nte': 1.4, 'u-mixto-ctr': 0.24, 'u-ger': 2, 'u-sol': 0.9, 'u-sol2': 0.2, 'u-cmp': 1, 'u-con': 3, 'u-aud': 5, 'u-adm': 0.3, 'u-seg': 1 };
  for (const [id, dias] of Object.entries(accesos)) {
    const u = m.usuario(id);
    if (u) u.ultimoAcceso = hace(dias).toISOString();
  }
  return m;
}
