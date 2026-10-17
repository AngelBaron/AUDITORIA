import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { api } from '@/api/cliente';
import { useUsuario } from '@/auth/AuthContext';
import { fmtFechaHoraSeg } from '@/domain/formato';
import { descargarArchivo, generarCsv, sha256Hex } from '@/domain/seguridad';
import { useAvisos } from './Avisos';
import { Boton } from './ui';

/**
 * RF-REP-07: la exportación queda en bitácora con el hash del archivo;
 * el CSV neutraliza fórmulas (RS-VAL-06).
 */
export function BotonExportarCsv({ reporte, nombreArchivo, encabezados, filas, deshabilitado }: { reporte: string; nombreArchivo: string; encabezados: string[]; filas: unknown[][]; deshabilitado?: boolean }) {
  const { avisar, avisarError } = useAvisos();
  const [ocupado, setOcupado] = useState(false);
  const exportar = async () => {
    setOcupado(true);
    try {
      const csv = generarCsv(encabezados, filas);
      const hash = await sha256Hex(csv);
      await api.reportes.registrarExportacion(reporte, 'CSV', filas.length, hash);
      const fecha = new Date().toISOString().slice(0, 10);
      descargarArchivo(`${nombreArchivo}_${fecha}.csv`, csv, 'text/csv;charset=utf-8');
      avisar('exito', `Exportaste ${filas.length} filas. La exportación quedó registrada en la bitácora.`);
    } catch (e) {
      avisarError(e);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <Boton icono={<Download aria-hidden />} onClick={exportar} cargando={ocupado} disabled={deshabilitado || filas.length === 0}>
      Exportar CSV
    </Boton>
  );
}

/** Impresión a PDF con marca de usuario, fecha y hash del contenido (RS-DAT-04, RF-REP-07). */
export function BotonImprimir({ reporte, contenidoParaHash }: { reporte: string; contenidoParaHash: string }) {
  const usuario = useUsuario();
  const { avisarError } = useAvisos();
  const [marca, setMarca] = useState<string | null>(null);
  const imprimir = async () => {
    try {
      const hash = await sha256Hex(contenidoParaHash);
      await api.reportes.registrarExportacion(reporte, 'PDF', 0, hash);
      setMarca(`Documento confidencial. Generado por ${usuario.nombre} (${usuario.numEmpleado}) el ${fmtFechaHoraSeg(new Date().toISOString())}. SHA-256: ${hash}`);
      requestAnimationFrame(() => window.print());
    } catch (e) {
      avisarError(e);
    }
  };
  return (
    <>
      <Boton icono={<Printer aria-hidden />} onClick={imprimir}>
        Imprimir o guardar PDF
      </Boton>
      {marca && <MarcaImpresion texto={marca} />}
    </>
  );
}

function MarcaImpresion({ texto }: { texto: string }) {
  return <p className="marca-agua-impresion">{texto}</p>;
}
