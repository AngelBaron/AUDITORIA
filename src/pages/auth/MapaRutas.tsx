/**
 * Ilustración de la pantalla de acceso: los cuatro almacenes como nodos de una red
 * de transferencias. El único movimiento automático de la app: el trazo de las rutas.
 */
export function MapaRutas({ className }: { className?: string }) {
  const nodos = [
    { id: 'NTE', x: 400, y: 150, texto: 'Norte' },
    { id: 'CTR', x: 270, y: 330, texto: 'Centro' },
    { id: 'CEN', x: 420, y: 430, texto: 'Central' },
    { id: 'SUR', x: 620, y: 330, texto: 'Sur' },
  ];
  const rutas = [
    'M420 430 C 470 340, 460 230, 400 150',
    'M420 430 C 360 420, 300 390, 270 330',
    'M420 430 C 520 450, 600 410, 620 330',
    'M270 330 C 280 250, 330 190, 400 150',
  ];
  return (
    <svg className={className} viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" aria-hidden focusable="false">
      <defs>
        <pattern id="reticula" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="#2e3e51" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="800" height="600" fill="url(#reticula)" opacity="0.55" />
      {rutas.map((d) => (
        <path key={d} d={d} fill="none" stroke="#5b6878" strokeWidth="1.5" />
      ))}
      {rutas.map((d) => (
        <path key={`${d}-a`} d={d} fill="none" stroke="#F2B705" strokeWidth="2.5" strokeDasharray="6 10" className="ruta-animada" />
      ))}
      {nodos.map((n) => (
        <g key={n.id}>
          <rect x={n.x - 22} y={n.y - 22} width="44" height="44" rx="6" fill="#18222e" stroke={n.id === 'CEN' ? '#F2B705' : '#a7b1bd'} strokeWidth="2" />
          <text x={n.x} y={n.y + 5} textAnchor="middle" fill="#f4f6f8" fontSize="13" fontWeight="700" fontFamily="inherit">
            {n.id}
          </text>
          <text x={n.x + 32} y={n.y + 5} fill="#a7b1bd" fontSize="13" fontFamily="inherit">
            {n.texto}
          </text>
        </g>
      ))}
    </svg>
  );
}
