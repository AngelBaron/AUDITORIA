import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, RotateCw } from 'lucide-react';
import { api } from '@/api/cliente';
import type { ElementoBandeja } from '@/api/types';
import { Boton, Cabecera, Cargando, ErrorCarga, Estado, Folio, Pestanas, Vacio } from '@/components/ui';
import { fmtFechaHora, fmtRelativo } from '@/domain/formato';
import { useConsulta } from '@/hooks/useConsulta';

type Filtro = 'todo' | 'documentos' | 'control';

export function BandejaPage() {
  const { datos, error, cargando, recargar } = useConsulta(() => api.bandeja(), []);
  const [filtro, setFiltro] = useState<Filtro>('todo');

  const lista = useMemo(() => {
    const todos = datos ?? [];
    if (filtro === 'documentos') return todos.filter((b) => b.tipo === 'DOCUMENTO' || b.tipo === 'CONTEO');
    if (filtro === 'control') return todos.filter((b) => b.tipo !== 'DOCUMENTO' && b.tipo !== 'CONTEO');
    return todos;
  }, [datos, filtro]);

  const contar = (f: (b: ElementoBandeja) => boolean) => (datos ?? []).filter(f).length;

  return (
    <>
      <Cabecera
        titulo="Mis pendientes"
        descripcion="Todo lo que espera una acción tuya. Solo aparecen las tareas que tu rol puede hacer y que la segregación de funciones te permite."
        acciones={
          <Boton icono={<RotateCw aria-hidden />} onClick={() => void recargar()} cargando={cargando}>
            Actualizar
          </Boton>
        }
      />
      <section className="panel">
        <Pestanas<Filtro>
          etiqueta="Filtrar pendientes"
          actual={filtro}
          cambiar={setFiltro}
          opciones={[
            { valor: 'todo', texto: 'Todo', contador: datos?.length },
            { valor: 'documentos', texto: 'Movimientos y conteos', contador: contar((b) => b.tipo === 'DOCUMENTO' || b.tipo === 'CONTEO') },
            { valor: 'control', texto: 'Accesos, parámetros y hallazgos', contador: contar((b) => b.tipo !== 'DOCUMENTO' && b.tipo !== 'CONTEO') },
          ]}
        />
        {error && <ErrorCarga error={error} reintentar={recargar} />}
        {cargando && !datos ? (
          <Cargando />
        ) : lista.length === 0 ? (
          <Vacio titulo="No tienes pendientes">Cuando alguien te asigne una aprobación, un surtido o una recepción, aparecerá aquí.</Vacio>
        ) : (
          <ul className="lista-limpia">
            {lista.map((b) => (
              <li key={`${b.tipo}-${b.id}`}>
                <Link to={b.ruta} className="pendiente">
                  <span className="pendiente__titulo">
                    {b.titulo}
                    {b.urgente && <Estado tono="error">Prioritario</Estado>}
                  </span>
                  <span className="pendiente__detalle">
                    {b.folio && <Folio folio={b.folio} />} {b.detalle}
                  </span>
                  <span className="pendiente__fecha" title={fmtFechaHora(b.fecha)}>
                    {fmtRelativo(b.fecha)}
                  </span>
                  <ArrowRight size={16} className="pendiente__flecha" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
