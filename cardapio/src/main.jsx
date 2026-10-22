import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './context/AppContext';
import { GarcomApp } from './garcom/GarcomApp';
import { MotoboyApp } from './motoboy/MotoboyApp';
import { BASE, pathParts } from './lib/api';
import './index.css';

/**
 * Cada app instala com nome, ícone e abertura próprios. Sem manifesto, o celular com o ERP instalado
 * abria garçom/motoboy/delivery dentro do app do ERP (escopo "/" do domínio), com a abertura dele.
 */
function installAs() {
  const [app, slug] = pathParts();
  const manifest = app === 'garcom' || app === 'motoboy'
    ? `/cardapio/manifest-${app}.webmanifest`
    : app === 'delivery' && slug ? `${BASE}/api/public/stores/${encodeURIComponent(slug)}/manifest.webmanifest` : null;
  if (!manifest) return; // cardápio da mesa: não é para instalar
  const icon = app === 'delivery' ? 'delivery' : app;
  const add = (attrs) => document.head.append(Object.assign(document.createElement('link'), attrs));
  add({ rel: 'manifest', href: manifest });
  add({ rel: 'apple-touch-icon', href: `/cardapio/icons/${icon}-192.png` });
}
installAs();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* /garcom é o app do garçom, /motoboy o do motoboy; qualquer outro caminho é o slug da loja */}
    {pathParts()[0] === 'garcom' ? (
      <GarcomApp />
    ) : pathParts()[0] === 'motoboy' ? (
      <MotoboyApp />
    ) : (
      <AppProvider>
        <App />
      </AppProvider>
    )}
  </React.StrictMode>,
);
