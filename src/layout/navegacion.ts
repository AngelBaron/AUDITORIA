import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  Boxes,
  ChartColumn,
  ClipboardCheck,
  FileText,
  Inbox,
  LayoutDashboard,
  Package,
  PackageMinus,
  PackagePlus,
  ScrollText,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import type { Permiso } from '@/api/types';

export interface EnlaceNav {
  a: string;
  texto: string;
  icono: LucideIcon;
  /** Basta con tener uno de estos permisos; vacío = cualquier usuario autenticado */
  permisos: Permiso[];
  contador?: 'bandeja';
}

export const NAVEGACION: { titulo: string; enlaces: EnlaceNav[] }[] = [
  {
    titulo: 'Operación',
    enlaces: [
      { a: '/', texto: 'Inicio', icono: LayoutDashboard, permisos: [] },
      { a: '/bandeja', texto: 'Mis pendientes', icono: Inbox, permisos: [], contador: 'bandeja' },
      { a: '/existencias', texto: 'Existencias', icono: Boxes, permisos: ['existencias.ver'] },
    ],
  },
  {
    titulo: 'Movimientos',
    enlaces: [
      { a: '/recepciones', texto: 'Recepciones', icono: PackagePlus, permisos: ['recepcion.ver'] },
      { a: '/salidas', texto: 'Salidas', icono: PackageMinus, permisos: ['salida.ver'] },
      { a: '/transferencias', texto: 'Transferencias', icono: ArrowLeftRight, permisos: ['transferencia.ver'] },
      { a: '/ajustes', texto: 'Ajustes', icono: SlidersHorizontal, permisos: ['ajuste.ver'] },
      { a: '/conteos', texto: 'Conteos físicos', icono: ClipboardCheck, permisos: ['conteo.ver'] },
    ],
  },
  {
    titulo: 'Abastecimiento',
    enlaces: [
      { a: '/productos', texto: 'Productos', icono: Package, permisos: ['catalogo.ver'] },
      { a: '/ordenes-compra', texto: 'Órdenes de compra', icono: FileText, permisos: ['oc.ver'] },
    ],
  },
  {
    titulo: 'Control',
    enlaces: [
      { a: '/reportes', texto: 'Reportes', icono: ChartColumn, permisos: ['reportes.ver', 'valuacion.ver'] },
      { a: '/hallazgos', texto: 'Hallazgos y alertas', icono: ShieldAlert, permisos: ['hallazgos.ver'] },
      { a: '/bitacora', texto: 'Bitácora de auditoría', icono: ScrollText, permisos: ['bitacora.ver'] },
    ],
  },
  {
    titulo: 'Administración',
    enlaces: [
      { a: '/usuarios', texto: 'Usuarios y accesos', icono: Users, permisos: ['usuarios.ver'] },
      { a: '/parametros', texto: 'Parámetros de control', icono: Settings2, permisos: ['parametros.ver'] },
    ],
  },
];
