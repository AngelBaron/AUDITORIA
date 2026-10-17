import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/archivo/wdth.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { App } from './App';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('No se encontró el contenedor #root');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
