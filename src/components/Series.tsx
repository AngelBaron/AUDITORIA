import { useId, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

/** Captura de números de serie: se escanean uno por uno (Enter) o se pegan varios. */
export function CapturaSeries({ series, cambiar, esperadas, etiqueta = 'Números de serie', ocultarEsperadas = false }: { series: string[]; cambiar: (s: string[]) => void; esperadas?: number; etiqueta?: string; ocultarEsperadas?: boolean }) {
  const id = useId();
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  const agregar = (crudo: string) => {
    const nuevas = crudo
      .split(/[\s,;]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const invalida = nuevas.find((s) => !/^[A-Z0-9-]{4,40}$/.test(s));
    if (invalida) {
      setAviso(`"${invalida.slice(0, 40)}" no es una serie válida (letras, números y guiones).`);
      return;
    }
    const repetida = nuevas.find((s) => series.includes(s));
    if (repetida) setAviso(`${repetida} ya está capturada.`);
    else setAviso(null);
    cambiar([...series, ...nuevas.filter((s) => !series.includes(s))].slice(0, 500));
    setTexto('');
  };

  const teclas = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (texto.trim()) agregar(texto);
    }
  };

  return (
    <div className="campo">
      <label className="campo__etiqueta" htmlFor={id}>
        {etiqueta}
        {esperadas != null && !ocultarEsperadas && (
          <span className="suave" style={{ fontWeight: 400 }}>
            {' '}
            ({series.length} de {esperadas})
          </span>
        )}
        {ocultarEsperadas && (
          <span className="suave" style={{ fontWeight: 400 }}>
            {' '}
            ({series.length} capturadas)
          </span>
        )}
      </label>
      <input
        id={id}
        className="entrada codigo"
        autoComplete="off"
        spellCheck={false}
        maxLength={400}
        placeholder="Escanea y presiona Enter"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={teclas}
        onPaste={(e) => {
          e.preventDefault();
          agregar(e.clipboardData.getData('text'));
        }}
      />
      {aviso && <span className="campo__error">{aviso}</span>}
      {series.length > 0 && (
        <div className="series-lista">
          {series.map((s) => (
            <span key={s} className="serie">
              {s}
              <button type="button" className="btn--fantasma" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex' }} aria-label={`Quitar ${s}`} onClick={() => cambiar(series.filter((x) => x !== s))}>
                <X size={12} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Selección de series disponibles en el almacén (para surtir, enviar o dar de baja). */
export function EleccionSeries({ disponibles, elegidas, cambiar, requeridas }: { disponibles: string[]; elegidas: string[]; cambiar: (s: string[]) => void; requeridas: number }) {
  const [escaneo, setEscaneo] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const alternar = (s: string) => {
    if (elegidas.includes(s)) cambiar(elegidas.filter((x) => x !== s));
    else if (elegidas.length < requeridas) cambiar([...elegidas, s]);
  };
  return (
    <div className="pila pila--estrecha">
      <div className="fila pequeno">
        <strong>
          {elegidas.length} de {requeridas} series
        </strong>
        <input
          className="entrada codigo"
          style={{ maxWidth: 240, minHeight: 32 }}
          aria-label="Escanear serie"
          placeholder="Escanea para marcar"
          value={escaneo}
          maxLength={40}
          onChange={(e) => setEscaneo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const s = escaneo.trim().toUpperCase();
            if (!disponibles.includes(s)) setAviso(`${s} no está disponible en este almacén.`);
            else {
              setAviso(null);
              if (!elegidas.includes(s)) alternar(s);
            }
            setEscaneo('');
          }}
        />
      </div>
      {aviso && <span className="campo__error">{aviso}</span>}
      <div className="series-lista" role="group" aria-label="Series disponibles">
        {disponibles.length === 0 && <span className="suave pequeno">No hay series disponibles.</span>}
        {disponibles.map((s) => (
          <label key={s} className="serie serie--seleccionable">
            <input type="checkbox" checked={elegidas.includes(s)} onChange={() => alternar(s)} disabled={!elegidas.includes(s) && elegidas.length >= requeridas} />
            {s}
          </label>
        ))}
      </div>
    </div>
  );
}
