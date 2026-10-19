import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './context/AppContext';
import { GarcomApp } from './garcom/GarcomApp';
import { pathParts } from './lib/api';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* /garcom é o app do garçom; qualquer outro caminho é o slug da loja */}
    {pathParts()[0] === 'garcom' ? (
      <GarcomApp />
    ) : (
      <AppProvider>
        <App />
      </AppProvider>
    )}
  </React.StrictMode>,
);
