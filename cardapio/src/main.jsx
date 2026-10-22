import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './context/AppContext';
import { GarcomApp } from './garcom/GarcomApp';
import { MotoboyApp } from './motoboy/MotoboyApp';
import { pathParts } from './lib/api';
import './index.css';

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
