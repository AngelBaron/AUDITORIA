import type { AlmacenClave, ClaseAbc, RolClave, UnidadMedida } from '@/api/types';

/**
 * Datos ficticios de LogiTech Soluciones S.A. de C.V. para el modo demostración.
 * Contraseña común de las cuentas demo (solo modo mock): ver DEMO_PASSWORD.
 */
export const DEMO_PASSWORD = 'Montacargas.Azul26';
export const DEMO_TOTP = '482913';

export interface UsuarioSemilla {
  id: string;
  correo: string;
  nombre: string;
  numEmpleado: string;
  puesto: string;
  centroCosto: string | null;
  roles: { rol: RolClave; almacenes: AlmacenClave[] | 'TODOS'; excepcion?: { justificacion: string; vence: string } }[];
  ip: string;
}

export const USUARIOS: UsuarioSemilla[] = [
  { id: 'u-alm-cen', correo: 'mdiaz@logitech.mx', nombre: 'Marco Díaz', numEmpleado: 'LT-1042', puesto: 'Almacenista', centroCosto: null, roles: [{ rol: 'ALM', almacenes: ['CEN'] }], ip: '10.20.1.15' },
  { id: 'u-alm-nte', correo: 'rmendez@logitech.mx', nombre: 'Rosa Méndez', numEmpleado: 'LT-1187', puesto: 'Almacenista', centroCosto: null, roles: [{ rol: 'ALM', almacenes: ['NTE'] }], ip: '10.20.2.21' },
  { id: 'u-alm-sur', correo: 'icruz@logitech.mx', nombre: 'Iván Cruz', numEmpleado: 'LT-1230', puesto: 'Almacenista', centroCosto: null, roles: [{ rol: 'ALM', almacenes: ['SUR'] }], ip: '10.20.4.33' },
  { id: 'u-alm-cen2', correo: 'gnavarro@logitech.mx', nombre: 'Gabriela Navarro', numEmpleado: 'LT-1311', puesto: 'Almacenista', centroCosto: null, roles: [{ rol: 'ALM', almacenes: ['CEN'] }], ip: '10.20.1.18' },
  { id: 'u-sup-cen', correo: 'pluna@logitech.mx', nombre: 'Patricia Luna', numEmpleado: 'LT-0815', puesto: 'Supervisora de almacén', centroCosto: null, roles: [{ rol: 'SUP', almacenes: ['CEN'] }], ip: '10.20.1.40' },
  { id: 'u-sup-nte', correo: 'jsalas@logitech.mx', nombre: 'Jorge Salas', numEmpleado: 'LT-0902', puesto: 'Supervisor de almacén', centroCosto: null, roles: [{ rol: 'SUP', almacenes: ['NTE', 'SUR'] }], ip: '10.20.2.40' },
  {
    id: 'u-mixto-ctr',
    correo: 'rparedes@logitech.mx',
    nombre: 'Raúl Paredes',
    numEmpleado: 'LT-0977',
    puesto: 'Encargado de almacén Centro',
    centroCosto: null,
    roles: [
      { rol: 'ALM', almacenes: ['CTR'] },
      { rol: 'SUP', almacenes: ['CTR'], excepcion: { justificacion: 'Almacén Centro opera con una sola persona en turno vespertino; control compensatorio: revisión semanal de bitácora por GER.', vence: '2027-01-31' } },
    ],
    ip: '10.20.3.12',
  },
  { id: 'u-ger', correo: 'etorres@logitech.mx', nombre: 'Elena Torres', numEmpleado: 'LT-0301', puesto: 'Gerente de logística', centroCosto: null, roles: [{ rol: 'GER', almacenes: 'TODOS' }], ip: '10.20.0.10' },
  { id: 'u-sol', correo: 'druiz@logitech.mx', nombre: 'Daniel Ruiz', numEmpleado: 'LT-1520', puesto: 'Líder de ensamble', centroCosto: 'CC-ENS', roles: [{ rol: 'SOL', almacenes: ['CEN', 'NTE'] }], ip: '10.20.5.71' },
  { id: 'u-sol2', correo: 'mfuentes@logitech.mx', nombre: 'Mariana Fuentes', numEmpleado: 'LT-1544', puesto: 'Ejecutiva de ventas', centroCosto: 'CC-VTA', roles: [{ rol: 'SOL', almacenes: ['CEN', 'SUR'] }], ip: '10.20.5.88' },
  { id: 'u-cmp', correo: 'svega@logitech.mx', nombre: 'Sofía Vega', numEmpleado: 'LT-0640', puesto: 'Comprador', centroCosto: null, roles: [{ rol: 'CMP', almacenes: 'TODOS' }], ip: '10.20.0.31' },
  { id: 'u-con', correo: 'hramirez@logitech.mx', nombre: 'Hugo Ramírez', numEmpleado: 'LT-0512', puesto: 'Contador de costos', centroCosto: null, roles: [{ rol: 'CON', almacenes: 'TODOS' }], ip: '10.20.0.52' },
  { id: 'u-aud', correo: 'lcampos@logitech.mx', nombre: 'Laura Campos', numEmpleado: 'LT-0204', puesto: 'Auditora interna', centroCosto: null, roles: [{ rol: 'AUD', almacenes: 'TODOS' }], ip: '10.20.0.77' },
  { id: 'u-adm', correo: 'therrera@logitech.mx', nombre: 'Tomás Herrera', numEmpleado: 'LT-0733', puesto: 'Administrador de sistemas', centroCosto: null, roles: [{ rol: 'ADM', almacenes: 'TODOS' }], ip: '10.20.0.90' },
  { id: 'u-seg', correo: 'amolina@logitech.mx', nombre: 'Andrea Molina', numEmpleado: 'LT-0688', puesto: 'Oficial de seguridad de la información', centroCosto: null, roles: [{ rol: 'SEG', almacenes: 'TODOS' }], ip: '10.20.0.95' },
];

export const ALMACENES = [
  { clave: 'CEN' as const, nombre: 'Planta / Almacén Central', ciudad: 'Santiago Tianguistenco, Méx.', responsable: 'Patricia Luna' },
  { clave: 'NTE' as const, nombre: 'Almacén Regional Norte', ciudad: 'Monterrey, N.L.', responsable: 'Jorge Salas' },
  { clave: 'CTR' as const, nombre: 'Almacén Regional Centro', ciudad: 'Querétaro, Qro.', responsable: 'Raúl Paredes' },
  { clave: 'SUR' as const, nombre: 'Almacén Regional Sur', ciudad: 'Mérida, Yuc.', responsable: 'Jorge Salas' },
];

export interface ProductoSemilla {
  id: string;
  sku: string;
  descripcion: string;
  categoria: string;
  unidad: UnidadMedida;
  costo: number;
  min: number;
  max: number;
  reorden: number;
  clase: ClaseAbc;
  serializado: boolean;
  sensible: boolean;
  /** existencia inicial por almacén */
  inicial: Partial<Record<AlmacenClave, number>>;
}

export const PRODUCTOS: ProductoSemilla[] = [
  { id: 'p-ssd1', sku: 'SSD-NV1T', descripcion: 'Unidad SSD NVMe 1 TB PCIe 4.0', categoria: 'Almacenamiento', unidad: 'PZA', costo: 1180, min: 20, max: 120, reorden: 30, clase: 'A', serializado: true, sensible: true, inicial: { CEN: 24, NTE: 10, CTR: 6, SUR: 5 } },
  { id: 'p-ssd2', sku: 'SSD-SA512', descripcion: 'Unidad SSD SATA 512 GB 2.5"', categoria: 'Almacenamiento', unidad: 'PZA', costo: 640, min: 15, max: 80, reorden: 20, clase: 'B', serializado: true, sensible: true, inicial: { CEN: 18, NTE: 8, SUR: 4 } },
  { id: 'p-ram16', sku: 'RAM-D5-16', descripcion: 'Memoria RAM DDR5 16 GB 5600 MHz', categoria: 'Memoria', unidad: 'PZA', costo: 890, min: 30, max: 200, reorden: 40, clase: 'A', serializado: false, sensible: true, inicial: { CEN: 86, NTE: 32, CTR: 20, SUR: 14 } },
  { id: 'p-ram32', sku: 'RAM-D5-32', descripcion: 'Memoria RAM DDR5 32 GB 5600 MHz', categoria: 'Memoria', unidad: 'PZA', costo: 1720, min: 10, max: 80, reorden: 15, clase: 'A', serializado: false, sensible: true, inicial: { CEN: 34, NTE: 12, CTR: 6 } },
  { id: 'p-cpu7', sku: 'CPU-R7-7700', descripcion: 'Procesador Ryzen 7 7700, 8 núcleos', categoria: 'Procesadores', unidad: 'PZA', costo: 5480, min: 6, max: 40, reorden: 8, clase: 'A', serializado: true, sensible: true, inicial: { CEN: 12, NTE: 4, CTR: 3 } },
  { id: 'p-cpu5', sku: 'CPU-I5-14400', descripcion: 'Procesador Core i5-14400, 10 núcleos', categoria: 'Procesadores', unidad: 'PZA', costo: 4320, min: 6, max: 40, reorden: 8, clase: 'A', serializado: true, sensible: true, inicial: { CEN: 10, NTE: 3, SUR: 2 } },
  { id: 'p-mb650', sku: 'MB-B650M', descripcion: 'Tarjeta madre B650M micro-ATX', categoria: 'Tarjetas madre', unidad: 'PZA', costo: 2890, min: 6, max: 40, reorden: 10, clase: 'B', serializado: true, sensible: false, inicial: { CEN: 14, NTE: 5, CTR: 4 } },
  { id: 'p-psu650', sku: 'PSU-650G', descripcion: 'Fuente de poder 650 W 80+ Gold', categoria: 'Energía', unidad: 'PZA', costo: 1340, min: 10, max: 60, reorden: 14, clase: 'B', serializado: false, sensible: false, inicial: { CEN: 26, NTE: 9, CTR: 7, SUR: 6 } },
  { id: 'p-gab', sku: 'GAB-MATX', descripcion: 'Gabinete micro-ATX con ventilación frontal', categoria: 'Gabinetes', unidad: 'PZA', costo: 780, min: 10, max: 60, reorden: 12, clase: 'C', serializado: false, sensible: false, inicial: { CEN: 31, NTE: 12, CTR: 8, SUR: 9 } },
  { id: 'p-mon24', sku: 'MON-24FHD', descripcion: 'Monitor 24" Full HD IPS', categoria: 'Monitores', unidad: 'PZA', costo: 2150, min: 8, max: 50, reorden: 10, clase: 'B', serializado: true, sensible: false, inicial: { CEN: 15, NTE: 6, SUR: 4 } },
  { id: 'p-tec', sku: 'TEC-USB-ES', descripcion: 'Teclado USB español latino', categoria: 'Periféricos', unidad: 'PZA', costo: 165, min: 20, max: 150, reorden: 30, clase: 'C', serializado: false, sensible: false, inicial: { CEN: 92, NTE: 40, CTR: 25, SUR: 30 } },
  { id: 'p-mouse', sku: 'MOU-OPT', descripcion: 'Mouse óptico USB 1600 dpi', categoria: 'Periféricos', unidad: 'PZA', costo: 95, min: 20, max: 150, reorden: 30, clase: 'C', serializado: false, sensible: false, inicial: { CEN: 110, NTE: 44, CTR: 28, SUR: 27 } },
  { id: 'p-utp', sku: 'UTP-C6-305', descripcion: 'Cable UTP Cat 6, bobina 305 m', categoria: 'Redes', unidad: 'CAJA', costo: 2380, min: 4, max: 30, reorden: 6, clase: 'B', serializado: false, sensible: false, inicial: { CEN: 14, NTE: 5, CTR: 3 } },
  { id: 'p-sw24', sku: 'SW-24G-POE', descripcion: 'Switch administrable 24 puertos Gigabit PoE', categoria: 'Redes', unidad: 'PZA', costo: 6890, min: 3, max: 20, reorden: 4, clase: 'A', serializado: true, sensible: false, inicial: { CEN: 7, NTE: 2 } },
  { id: 'p-ap', sku: 'AP-WIFI6', descripcion: 'Punto de acceso Wi-Fi 6 de techo', categoria: 'Redes', unidad: 'PZA', costo: 2460, min: 5, max: 30, reorden: 6, clase: 'B', serializado: true, sensible: false, inicial: { CEN: 11, NTE: 4, CTR: 3 } },
  { id: 'p-ups', sku: 'UPS-1500', descripcion: 'No-break UPS 1500 VA interactivo', categoria: 'Energía', unidad: 'PZA', costo: 3120, min: 3, max: 20, reorden: 4, clase: 'B', serializado: true, sensible: false, inicial: { CEN: 6, NTE: 2, SUR: 2 } },
  { id: 'p-hdmi', sku: 'CAB-HDMI-2M', descripcion: 'Cable HDMI 2.1 de 2 m', categoria: 'Cables', unidad: 'PZA', costo: 85, min: 30, max: 200, reorden: 40, clase: 'C', serializado: false, sensible: false, inicial: { CEN: 140, NTE: 60, CTR: 35, SUR: 38 } },
  { id: 'p-usbc', sku: 'ADP-USBC-HUB', descripcion: 'Adaptador USB-C multipuerto 7 en 1', categoria: 'Periféricos', unidad: 'PZA', costo: 410, min: 10, max: 80, reorden: 15, clase: 'B', serializado: false, sensible: true, inicial: { CEN: 38, NTE: 12, SUR: 9 } },
  { id: 'p-pasta', sku: 'PST-TERM-4G', descripcion: 'Pasta térmica 4 g', categoria: 'Consumibles', unidad: 'PZA', costo: 120, min: 20, max: 150, reorden: 25, clase: 'C', serializado: false, sensible: false, inicial: { CEN: 64, NTE: 18, CTR: 12 } },
  { id: 'p-torn', sku: 'KIT-TORN-ATX', descripcion: 'Kit de tornillería para ensamble ATX', categoria: 'Consumibles', unidad: 'KIT', costo: 48, min: 30, max: 300, reorden: 50, clase: 'C', serializado: false, sensible: false, inicial: { CEN: 180, NTE: 40, CTR: 32, SUR: 28 } },
  { id: 'p-lap', sku: 'LAP-14-R5', descripcion: 'Laptop 14" Ryzen 5, 16 GB, 512 GB', categoria: 'Equipos', unidad: 'PZA', costo: 11900, min: 3, max: 25, reorden: 4, clase: 'A', serializado: true, sensible: true, inicial: { CEN: 8, NTE: 3, SUR: 2 } },
  { id: 'p-gpu', sku: 'GPU-RTX4060', descripcion: 'Tarjeta de video 8 GB GDDR6', categoria: 'Video', unidad: 'PZA', costo: 6450, min: 3, max: 20, reorden: 4, clase: 'A', serializado: true, sensible: true, inicial: { CEN: 5, NTE: 2 } },
];

export const PROVEEDORES = [
  { id: 'prov-1', nombre: 'Componentes del Bajío S.A. de C.V.', rfc: 'CBA180322KL7' },
  { id: 'prov-2', nombre: 'Distribuidora Tecnológica del Norte S.A.', rfc: 'DTN090615HJ2' },
  { id: 'prov-3', nombre: 'Redes y Energía Mayoristas S.A. de C.V.', rfc: 'REM150901QW4' },
];

export const CENTROS_COSTO = [
  { clave: 'CC-ENS', nombre: 'Línea de ensamble' },
  { clave: 'CC-VTA', nombre: 'Ventas corporativas' },
  { clave: 'CC-SOP', nombre: 'Soporte y garantías' },
  { clave: 'CC-ADM', nombre: 'Administración' },
];

export const MOTIVOS = [
  { clave: 'CONSUMO_PRODUCCION', nombre: 'Consumo de producción', aplicaA: ['SAL'], requiereJustificacionExtendida: false },
  { clave: 'VENTA', nombre: 'Venta a cliente', aplicaA: ['SAL'], requiereJustificacionExtendida: false },
  { clave: 'GARANTIA', nombre: 'Reposición por garantía', aplicaA: ['SAL'], requiereJustificacionExtendida: false },
  { clave: 'MUESTRA', nombre: 'Muestra comercial', aplicaA: ['SAL'], requiereJustificacionExtendida: true },
  { clave: 'REABASTO', nombre: 'Reabasto de almacén regional', aplicaA: ['TRF'], requiereJustificacionExtendida: false },
  { clave: 'BALANCEO', nombre: 'Balanceo de inventario', aplicaA: ['TRF'], requiereJustificacionExtendida: false },
  { clave: 'MERMA', nombre: 'Merma', aplicaA: ['AJU'], requiereJustificacionExtendida: false },
  { clave: 'DANIO', nombre: 'Producto dañado', aplicaA: ['AJU'], requiereJustificacionExtendida: false },
  { clave: 'ROBO', nombre: 'Robo o extravío', aplicaA: ['AJU'], requiereJustificacionExtendida: true },
  { clave: 'ERROR_CAPTURA', nombre: 'Error de captura', aplicaA: ['AJU'], requiereJustificacionExtendida: false },
  { clave: 'DIFERENCIA_CONTEO', nombre: 'Diferencia de conteo físico', aplicaA: ['AJU'], requiereJustificacionExtendida: false },
  { clave: 'OTRO', nombre: 'Otro (justificar)', aplicaA: ['SAL', 'TRF', 'AJU'], requiereJustificacionExtendida: true },
] as const;

export const PARAMETROS = [
  { clave: 'umbral_salida_ger', nombre: 'Umbral de salida para Gerencia', descripcion: 'Salidas con importe mayor requieren aprobación de GER (RF-SAL-02).', valor: 20000, unidad: 'MXN' as const },
  { clave: 'umbral_transferencia_ger', nombre: 'Umbral de transferencia para Gerencia', descripcion: 'Transferencias con importe mayor requieren aprobación de GER (RF-TRF-02).', valor: 50000, unidad: 'MXN' as const },
  { clave: 'umbral_ajuste_n2', nombre: 'Umbral de ajuste con doble aprobación', descripcion: 'Ajustes mayores requieren SUP y GER (RF-AJU-02).', valor: 5000, unidad: 'MXN' as const },
  { clave: 'umbral_ajuste_aud', nombre: 'Umbral de ajuste con aviso a Auditoría', descripcion: 'Ajustes mayores se notifican a AUD (RF-AJU-02).', valor: 50000, unidad: 'MXN' as const },
  { clave: 'tolerancia_conteo_pct', nombre: 'Tolerancia de conteo (%)', descripcion: 'Diferencia mayor exige segundo conteo (RF-CNT-04).', valor: 2, unidad: '%' as const },
  { clave: 'tolerancia_conteo_mxn', nombre: 'Tolerancia de conteo (importe)', descripcion: 'Diferencia mayor exige segundo conteo (RF-CNT-04).', valor: 1000, unidad: 'MXN' as const },
  { clave: 'dias_transito_alerta', nombre: 'Días en tránsito para alerta', descripcion: 'Transferencias en tránsito más tiempo generan alerta (RF-TRF-07).', valor: 5, unidad: 'días' as const },
  { clave: 'horas_vencimiento_aprobacion', nombre: 'Vencimiento de aprobaciones', descripcion: 'Aprobaciones pendientes vencen y regresan al solicitante (RN-09).', valor: 48, unidad: 'horas' as const },
  { clave: 'horas_vencimiento_salida', nombre: 'Vencimiento de salidas sin surtir', descripcion: 'Salidas aprobadas sin surtir liberan la reserva (RF-SAL-06).', valor: 72, unidad: 'horas' as const },
  { clave: 'minutos_inactividad', nombre: 'Cierre por inactividad', descripcion: 'Minutos sin actividad antes de cerrar la sesión (RS-SES-03).', valor: 15, unidad: 'minutos' as const },
];
