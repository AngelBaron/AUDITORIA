import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import type { Producto } from '@/api/types';

/**
 * Buscador de productos accesible (patrón combobox). Compatible con lector de código
 * de barras: el lector "teclea" el SKU y envía Enter; si coincide exacto se agrega.
 */
export function SelectorProducto({
  productos,
  excluir,
  alElegir,
  etiqueta = 'Agregar producto',
}: {
  productos: Producto[];
  excluir: string[];
  alElegir: (p: Producto) => void;
  etiqueta?: string;
}) {
  const id = useId();
  const [texto, setTexto] = useState('');
  const [activo, setActivo] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const sugerencias = useMemo(() => {
    const t = texto.trim().toLowerCase();
    if (!t) return [];
    return productos.filter((p) => p.activo && !excluir.includes(p.id) && (p.sku.toLowerCase().includes(t) || p.descripcion.toLowerCase().includes(t))).slice(0, 8);
  }, [texto, productos, excluir]);

  const elegir = (p: Producto) => {
    alElegir(p);
    setTexto('');
    setAbierto(false);
    setActivo(0);
    setAviso(`${p.sku} agregado`);
  };

  const teclas = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAbierto(true);
      setActivo((a) => Math.min(a + 1, sugerencias.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActivo((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const exacto = productos.find((p) => p.sku.toLowerCase() === texto.trim().toLowerCase());
      if (exacto && excluir.includes(exacto.id)) setAviso(`${exacto.sku} ya está en la lista; ajusta su cantidad.`);
      else if (exacto && exacto.activo) elegir(exacto);
      else if (sugerencias[activo]) elegir(sugerencias[activo]!);
    } else if (e.key === 'Escape') {
      setAbierto(false);
    }
  };

  return (
    <div className="campo selector" style={{ position: 'relative' }}>
      <label className="campo__etiqueta" htmlFor={id}>
        {etiqueta}
      </label>
      <div className="busqueda">
        <Search aria-hidden />
        <input
          id={id}
          className="entrada"
          role="combobox"
          aria-expanded={abierto && sugerencias.length > 0}
          aria-controls={`${id}-lista`}
          aria-autocomplete="list"
          aria-activedescendant={abierto && sugerencias[activo] ? `${id}-op-${activo}` : undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={60}
          placeholder="Escribe o escanea SKU o descripción"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setAbierto(true);
            setActivo(0);
            setAviso(null);
          }}
          onKeyDown={teclas}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
        />
      </div>
      <span className="sr-only" aria-live="polite">
        {aviso}
      </span>
      {aviso && aviso.includes('ya está') && <span className="campo__ayuda">{aviso}</span>}
      {abierto && sugerencias.length > 0 && (
        <ul id={`${id}-lista`} role="listbox" className="selector__lista">
          {sugerencias.map((p, i) => (
            <li
              key={p.id}
              id={`${id}-op-${i}`}
              role="option"
              aria-selected={i === activo}
              className="selector__opcion"
              onMouseDown={(e) => {
                e.preventDefault();
                elegir(p);
              }}
            >
              <Plus size={14} aria-hidden />
              <span className="codigo">{p.sku}</span>
              <span className="suave">{p.descripcion}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
