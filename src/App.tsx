import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import type { Permiso } from '@/api/types';
import { ProveedorAuth } from '@/auth/AuthContext';
import { PantallaCarga, RequierePermiso, RequiereSesion } from '@/auth/Guardias';
import { ProveedorAvisos } from '@/components/Avisos';
import { AppShell } from '@/layout/AppShell';
import { AccesoPage } from '@/pages/auth/AccesoPage';
import { NoEncontradoPage } from '@/pages/errores/ErroresPage';

// Carga diferida por módulo: cada rol descarga solo lo que usa
const InicioPage = lazy(() => import('@/pages/InicioPage').then((m) => ({ default: m.InicioPage })));
const BandejaPage = lazy(() => import('@/pages/BandejaPage').then((m) => ({ default: m.BandejaPage })));
const ExistenciasPage = lazy(() => import('@/pages/inventario/ExistenciasPage').then((m) => ({ default: m.ExistenciasPage })));
const KardexPage = lazy(() => import('@/pages/inventario/KardexPage').then((m) => ({ default: m.KardexPage })));
const SeriesPage = lazy(() => import('@/pages/inventario/SeriesPage').then((m) => ({ default: m.SeriesPage })));
const ListaDocumentosPage = lazy(() => import('@/pages/documentos/ListaDocumentosPage').then((m) => ({ default: m.ListaDocumentosPage })));
const DetalleDocumentoPage = lazy(() => import('@/pages/documentos/DetalleDocumentoPage').then((m) => ({ default: m.DetalleDocumentoPage })));
const NuevoDocumentoPage = lazy(() => import('@/pages/documentos/NuevoDocumentoPage').then((m) => ({ default: m.NuevoDocumentoPage })));
const ConteosPage = lazy(() => import('@/pages/conteos/ConteosPage').then((m) => ({ default: m.ConteosPage })));
const ConteoDetallePage = lazy(() => import('@/pages/conteos/ConteoDetallePage').then((m) => ({ default: m.ConteoDetallePage })));
const ProductosPage = lazy(() => import('@/pages/catalogo/ProductosPage').then((m) => ({ default: m.ProductosPage })));
const OrdenesCompraPage = lazy(() => import('@/pages/catalogo/OrdenesCompraPage').then((m) => ({ default: m.OrdenesCompraPage })));
const ReportesPage = lazy(() => import('@/pages/control/ReportesPage').then((m) => ({ default: m.ReportesPage })));
const HallazgosPage = lazy(() => import('@/pages/control/HallazgosPage').then((m) => ({ default: m.HallazgosPage })));
const BitacoraPage = lazy(() => import('@/pages/control/BitacoraPage').then((m) => ({ default: m.BitacoraPage })));
const UsuariosPage = lazy(() => import('@/pages/admin/UsuariosPage').then((m) => ({ default: m.UsuariosPage })));
const ParametrosPage = lazy(() => import('@/pages/admin/ParametrosPage').then((m) => ({ default: m.ParametrosPage })));
const SesionesPage = lazy(() => import('@/pages/cuenta/SesionesPage').then((m) => ({ default: m.SesionesPage })));
const CambioPasswordPage = lazy(() => import('@/pages/auth/CambioPasswordPage').then((m) => ({ default: m.CambioPasswordPage })));

function P({ permisos, children }: { permisos: Permiso[]; children: ReactNode }) {
  return <RequierePermiso permisos={permisos}>{children}</RequierePermiso>;
}

const DOCS = [
  { ruta: 'recepciones', tipo: 'ENT', ver: 'recepcion.ver', crear: 'recepcion.crear' },
  { ruta: 'salidas', tipo: 'SAL', ver: 'salida.ver', crear: 'salida.solicitar' },
  { ruta: 'transferencias', tipo: 'TRF', ver: 'transferencia.ver', crear: 'transferencia.crear' },
  { ruta: 'ajustes', tipo: 'AJU', ver: 'ajuste.ver', crear: 'ajuste.crear' },
] as const;

export function App() {
  return (
    <ProveedorAvisos>
      <ProveedorAuth>
        <BrowserRouter>
          <Suspense fallback={<PantallaCarga />}>
            <Routes>
              <Route path="/acceso" element={<AccesoPage />} />
              <Route element={<RequiereSesion />}>
                <Route element={<AppShell />}>
                  <Route index element={<InicioPage />} />
                  <Route path="bandeja" element={<BandejaPage />} />
                  <Route path="existencias" element={<P permisos={['existencias.ver']}><ExistenciasPage /></P>} />
                  <Route path="existencias/kardex" element={<P permisos={['existencias.ver']}><KardexPage /></P>} />
                  <Route path="existencias/series" element={<P permisos={['existencias.ver']}><SeriesPage /></P>} />
                  {DOCS.map((d) => [
                    <Route key={`${d.tipo}-l`} path={d.ruta} element={<P permisos={[d.ver]}><ListaDocumentosPage tipo={d.tipo} /></P>} />,
                    <Route key={`${d.tipo}-n`} path={`${d.ruta}/nueva`} element={<P permisos={[d.crear]}><NuevoDocumentoPage tipo={d.tipo} /></P>} />,
                    <Route key={`${d.tipo}-d`} path={`${d.ruta}/:id`} element={<P permisos={[d.ver]}><DetalleDocumentoPage tipo={d.tipo} /></P>} />,
                  ])}
                  <Route path="conteos" element={<P permisos={['conteo.ver']}><ConteosPage /></P>} />
                  <Route path="conteos/:id" element={<P permisos={['conteo.ver']}><ConteoDetallePage /></P>} />
                  <Route path="productos" element={<P permisos={['catalogo.ver']}><ProductosPage /></P>} />
                  <Route path="ordenes-compra" element={<P permisos={['oc.ver']}><OrdenesCompraPage /></P>} />
                  <Route path="reportes" element={<P permisos={['reportes.ver', 'valuacion.ver']}><ReportesPage /></P>} />
                  <Route path="hallazgos" element={<P permisos={['hallazgos.ver']}><HallazgosPage /></P>} />
                  <Route path="bitacora" element={<P permisos={['bitacora.ver']}><BitacoraPage /></P>} />
                  <Route path="usuarios" element={<P permisos={['usuarios.ver']}><UsuariosPage /></P>} />
                  <Route path="parametros" element={<P permisos={['parametros.ver']}><ParametrosPage /></P>} />
                  <Route path="cuenta/sesiones" element={<SesionesPage />} />
                  <Route path="cuenta/contrasena" element={<CambioPasswordPage />} />
                  <Route path="*" element={<NoEncontradoPage />} />
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ProveedorAuth>
    </ProveedorAvisos>
  );
}
