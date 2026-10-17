import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CircleAlert, Inbox, LoaderCircle, RotateCw } from 'lucide-react';
import type { ApiError } from '@/api/http';
import type { Tono } from '@/domain/estados';

/* ───────────── Botón ───────────── */

interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: 'primario' | 'secundario' | 'peligro' | 'fantasma';
  tamano?: 'normal' | 'sm';
  cargando?: boolean;
  icono?: ReactNode;
}

export function Boton({ variante = 'secundario', tamano = 'normal', cargando = false, icono, children, className, disabled, type = 'button', ...resto }: BotonProps) {
  return (
    <button
      type={type}
      className={['btn', `btn--${variante}`, tamano === 'sm' ? 'btn--sm' : '', className ?? ''].join(' ').trim()}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      {...resto}
    >
      {cargando ? <LoaderCircle className="girando" aria-hidden /> : icono}
      {children}
    </button>
  );
}

/* ───────────── Campo de formulario ───────────── */

interface CampoProps {
  etiqueta: string;
  error?: string | null;
  ayuda?: ReactNode;
  requerido?: boolean;
  className?: string;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined; required: boolean }) => ReactNode;
}

export function Campo({ etiqueta, error, ayuda, requerido = false, className, children }: CampoProps) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  const idError = `${id}-error`;
  const describe = [ayuda ? idAyuda : null, error ? idError : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`campo ${className ?? ''}`}>
      <label className="campo__etiqueta" htmlFor={id}>
        {etiqueta}
        {requerido && (
          <span className="campo__requerido" aria-hidden>
            *
          </span>
        )}
      </label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describe, required: requerido })}
      {ayuda && (
        <span id={idAyuda} className="campo__ayuda">
          {ayuda}
        </span>
      )}
      {error && (
        <span id={idError} className="campo__error">
          <CircleAlert size={14} aria-hidden />
          {error}
        </span>
      )}
    </div>
  );
}

/* ───────────── Estado (pastilla) ───────────── */

export function Estado({ tono, children }: { tono: Tono; children: ReactNode }) {
  return (
    <span className="estado" data-tono={tono}>
      {children}
    </span>
  );
}

/* ───────────── Folio (etiqueta de envío) ───────────── */

export function Folio({ folio, a, grande = false }: { folio: string; a?: string; grande?: boolean }) {
  const clase = `folio${grande ? ' folio--grande' : ''}`;
  return a ? (
    <Link to={a} className={clase}>
      {folio}
    </Link>
  ) : (
    <span className={clase}>{folio}</span>
  );
}

/* ───────────── Cabecera de página ───────────── */

export function Cabecera({
  titulo,
  descripcion,
  acciones,
  migas,
}: {
  titulo: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
  migas?: { texto: string; a: string }[];
}) {
  return (
    <header className="pagina__cabecera">
      <div>
        {migas && migas.length > 0 && (
          <nav aria-label="Ruta de navegación" className="pagina__migas">
            {migas.map((m, i) => (
              <span key={m.a}>
                <Link to={m.a}>{m.texto}</Link>
                {i < migas.length - 1 && <span aria-hidden> / </span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="pagina__titulo">{titulo}</h1>
        {descripcion && <p className="pagina__desc">{descripcion}</p>}
      </div>
      {acciones && <div className="pagina__acciones">{acciones}</div>}
    </header>
  );
}

/* ───────────── Estados de carga ───────────── */

export function Cargando({ filas = 5, etiqueta = 'Cargando información' }: { filas?: number; etiqueta?: string }) {
  return (
    <div className="panel__cuerpo pila pila--estrecha" role="status" aria-label={etiqueta}>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="esqueleto" style={{ width: `${90 - ((i * 13) % 40)}%` }} />
      ))}
    </div>
  );
}

export function ErrorCarga({ error, reintentar }: { error: ApiError; reintentar?: () => void }) {
  return (
    <div className="panel__cuerpo">
      <div className="banda banda--error" role="alert">
        <CircleAlert aria-hidden />
        <div>
          <strong>No se pudo cargar la información</strong>
          {error.message}
          {error.idCorrelacion && <span className="tabla__secundario">Referencia para soporte: {error.idCorrelacion}</span>}
          {reintentar && (
            <div style={{ marginTop: 8 }}>
              <Boton tamano="sm" icono={<RotateCw aria-hidden />} onClick={reintentar}>
                Reintentar
              </Boton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Vacio({ titulo, children, accion }: { titulo: string; children?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="vacio">
      <Inbox aria-hidden />
      <p className="vacio__titulo">{titulo}</p>
      {children && <p className="suave">{children}</p>}
      {accion}
    </div>
  );
}

/* ───────────── Paginación ───────────── */

export function Paginacion({ pagina, porPagina, total, cambiar }: { pagina: number; porPagina: number; total: number; cambiar: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const desde = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const hasta = Math.min(total, pagina * porPagina);
  return (
    <nav className="paginacion" aria-label="Paginación">
      <span>
        {desde}–{hasta} de {total}
      </span>
      <div className="fila">
        <Boton tamano="sm" disabled={pagina <= 1} onClick={() => cambiar(pagina - 1)}>
          Anterior
        </Boton>
        <span aria-current="page">
          Página {pagina} de {paginas}
        </span>
        <Boton tamano="sm" disabled={pagina >= paginas} onClick={() => cambiar(pagina + 1)}>
          Siguiente
        </Boton>
      </div>
    </nav>
  );
}

/* ───────────── Pestañas ───────────── */

export function Pestanas<T extends string>({ opciones, actual, cambiar, etiqueta }: { opciones: { valor: T; texto: string; contador?: number }[]; actual: T; cambiar: (v: T) => void; etiqueta: string }) {
  return (
    <div className="pestanas" role="tablist" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="tab"
          aria-selected={o.valor === actual}
          tabIndex={o.valor === actual ? 0 : -1}
          onClick={() => cambiar(o.valor)}
          onKeyDown={(e) => {
            const i = opciones.findIndex((x) => x.valor === actual);
            if (e.key === 'ArrowRight') cambiar(opciones[(i + 1) % opciones.length]!.valor);
            if (e.key === 'ArrowLeft') cambiar(opciones[(i - 1 + opciones.length) % opciones.length]!.valor);
          }}
        >
          {o.texto}
          {o.contador != null && o.contador > 0 && <span className="etiqueta" style={{ marginLeft: 6 }}>{o.contador}</span>}
        </button>
      ))}
    </div>
  );
}
