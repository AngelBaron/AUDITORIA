import { useId, useState } from 'react';
import { Paperclip, Trash2 } from 'lucide-react';
import type { AdjuntoNuevo } from '@/api/types';
import { aBase64, ADJUNTO_MAX_BYTES, sha256Hex, validarArchivo } from '@/domain/seguridad';
import { Boton } from './ui';

/**
 * RS-VAL-05: valida tipo por la firma real del archivo, tamaño máximo 5 MB y calcula su SHA-256
 * (el hash viaja con el archivo para que el servidor verifique su integridad).
 */
export function SelectorAdjuntos({
  adjuntos,
  cambiar,
  etiqueta,
  ayuda,
  requerido,
  error,
  maximo = 3,
}: {
  adjuntos: AdjuntoNuevo[];
  cambiar: (a: AdjuntoNuevo[]) => void;
  etiqueta: string;
  ayuda?: string;
  requerido?: boolean;
  error?: string | null;
  maximo?: number;
}) {
  const id = useId();
  const [problema, setProblema] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);

  const agregar = async (lista: FileList | null) => {
    if (!lista?.length) return;
    setProblema(null);
    setLeyendo(true);
    const nuevos: AdjuntoNuevo[] = [];
    try {
      for (const archivo of Array.from(lista)) {
        if (adjuntos.length + nuevos.length >= maximo) {
          setProblema(`Máximo ${maximo} archivos.`);
          break;
        }
        if (archivo.size > ADJUNTO_MAX_BYTES) {
          setProblema(`${archivo.name}: supera 5 MB.`);
          continue;
        }
        const bytes = new Uint8Array(await archivo.arrayBuffer());
        const r = validarArchivo(archivo.name, archivo.size, bytes.subarray(0, 16));
        if (!r.ok) {
          setProblema(`${archivo.name}: ${r.error}`);
          continue;
        }
        nuevos.push({ nombre: archivo.name.slice(0, 120), tipoMime: r.mime, tamano: archivo.size, sha256: await sha256Hex(bytes), contenidoBase64: aBase64(bytes) });
      }
      if (nuevos.length) cambiar([...adjuntos, ...nuevos]);
    } finally {
      setLeyendo(false);
    }
  };

  return (
    <div className="campo">
      <span className="campo__etiqueta" id={`${id}-etq`}>
        {etiqueta}
        {requerido && (
          <span className="campo__requerido" aria-hidden>
            *
          </span>
        )}
      </span>
      {adjuntos.length > 0 && (
        <ul className="lista-limpia pila pila--estrecha" aria-labelledby={`${id}-etq`}>
          {adjuntos.map((a, i) => (
            <li key={a.sha256 + i} className="fila fila--entre pequeno" style={{ padding: '6px 10px', border: '1px solid var(--linea)', borderRadius: 6 }}>
              <span className="fila" style={{ gap: 6 }}>
                <Paperclip size={14} aria-hidden />
                {a.nombre}
                <span className="suave">
                  {(a.tamano / 1024).toFixed(0)} KB · SHA-256 {a.sha256.slice(0, 10)}…
                </span>
              </span>
              <Boton tamano="sm" variante="fantasma" aria-label={`Quitar ${a.nombre}`} onClick={() => cambiar(adjuntos.filter((_, j) => j !== i))} icono={<Trash2 aria-hidden />} />
            </li>
          ))}
        </ul>
      )}
      <label className="btn btn--secundario" style={{ alignSelf: 'flex-start' }} htmlFor={id} aria-busy={leyendo || undefined}>
        <Paperclip size={16} aria-hidden /> {leyendo ? 'Revisando archivo…' : 'Adjuntar archivo'}
      </label>
      <input
        id={id}
        type="file"
        className="sr-only"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        multiple
        aria-describedby={`${id}-ayuda`}
        aria-invalid={!!(error || problema)}
        onChange={(e) => {
          void agregar(e.target.files);
          e.target.value = '';
        }}
      />
      <span id={`${id}-ayuda`} className="campo__ayuda">
        {ayuda ?? 'PDF, JPG o PNG de máximo 5 MB.'}
      </span>
      {(problema || error) && <span className="campo__error">{problema ?? error}</span>}
    </div>
  );
}
