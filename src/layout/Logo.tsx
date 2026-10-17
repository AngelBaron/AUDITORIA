/** Marca de SICIL: una caja de almacén con la franja de marcaje de piso. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" role="img" aria-label="SICIL">
      <rect width="36" height="36" rx="8" fill="#223040" />
      <path d="M8 13h20v14H8z" fill="none" stroke="#F2B705" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M8 13l3.5-5h13L28 13" fill="none" stroke="#F2B705" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M15 19h6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
