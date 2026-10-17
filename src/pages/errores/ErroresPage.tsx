import { Link } from 'react-router';
import { Lock, MapPin } from 'lucide-react';

export function NoAutorizadoPage() {
  return (
    <div className="vacio" role="alert">
      <Lock aria-hidden />
      <h1 className="vacio__titulo">Tu rol no tiene acceso a esta sección</h1>
      <p className="suave">Si lo necesitas para tu trabajo, pide al administrador de sistemas una asignación de rol; Seguridad de la información la revisa y aprueba.</p>
      <Link to="/" className="btn btn--secundario">
        Ir al inicio
      </Link>
    </div>
  );
}

export function NoEncontradoPage() {
  return (
    <div className="vacio">
      <MapPin aria-hidden />
      <h1 className="vacio__titulo">Esta página no existe</h1>
      <p className="suave">Revisa la dirección o vuelve al inicio.</p>
      <Link to="/" className="btn btn--secundario">
        Ir al inicio
      </Link>
    </div>
  );
}
