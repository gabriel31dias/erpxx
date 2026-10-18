import React, { useState } from 'react';
import { CleanScreen } from './CleanScreen';
import { useApp } from '../context/AppContext';
import { Screen01Splash } from '../screens/Screen01Splash';
import { Screen02Onboarding } from '../screens/Screen02Onboarding';
import { Screen03Home } from '../screens/Screen03Home';
import { Screen04Categoria } from '../screens/Screen04Categoria';
import { Screen05DetalheProduto } from '../screens/Screen05DetalheProduto';
import { Screen06Carrinho } from '../screens/Screen06Carrinho';
import { Screen07Endereco } from '../screens/Screen07Endereco';
import { Screen08Pagamento } from '../screens/Screen08Pagamento';
import { Screen09PedidoRealizado } from '../screens/Screen09PedidoRealizado';
import { Screen10MeusPedidos } from '../screens/Screen10MeusPedidos';
import { Screen11Rastreamento } from '../screens/Screen11Rastreamento';
import { Screen12Perfil } from '../screens/Screen12Perfil';
import { Screen13Favoritos } from '../screens/Screen13Favoritos';
import { Screen14Promocoes } from '../screens/Screen14Promocoes';
import { Screen15Sobre } from '../screens/Screen15Sobre';
import { Screen16Suporte } from '../screens/Screen16Suporte';
import { Screen17Configuracoes } from '../screens/Screen17Configuracoes';

export function ScreenGridOverview() {
  const { navigateTo, setViewMode } = useApp();
  const [zoomScale, setZoomScale] = useState(1);

  const row1 = [
    { num: 1, key: 'splash', label: 'Splash', component: <Screen01Splash /> },
    { num: 2, key: 'onboarding', label: 'Onboarding', component: <Screen02Onboarding /> },
    { num: 3, key: 'home', label: 'Home', component: <Screen03Home /> },
    { num: 4, key: 'categoria', label: 'Categoria', component: <Screen04Categoria /> },
    { num: 5, key: 'detalhe', label: 'Detalhe do produto', component: <Screen05DetalheProduto /> },
    { num: 6, key: 'carrinho', label: 'Carrinho', component: <Screen06Carrinho /> },
  ];

  const row2 = [
    { num: 7, key: 'endereco', label: 'Endereço', component: <Screen07Endereco /> },
    { num: 8, key: 'pagamento', label: 'Pagamento', component: <Screen08Pagamento /> },
    { num: 9, key: 'pedido_realizado', label: 'Pedido realizado', component: <Screen09PedidoRealizado /> },
    { num: 10, key: 'meus_pedidos', label: 'Meus pedidos', component: <Screen10MeusPedidos /> },
    { num: 11, key: 'rastreamento', label: 'Rastreamento', component: <Screen11Rastreamento /> },
  ];

  const row3 = [
    { num: 12, key: 'perfil', label: 'Perfil', component: <Screen12Perfil /> },
    { num: 13, key: 'favoritos', label: 'Favoritos', component: <Screen13Favoritos /> },
    { num: 14, key: 'promocoes', label: 'Promoções', component: <Screen14Promocoes /> },
    { num: 15, key: 'sobre', label: 'Sobre o restaurante', component: <Screen15Sobre /> },
    { num: 16, key: 'suporte', label: 'Suporte', component: <Screen16Suporte /> },
    { num: 17, key: 'configuracoes', label: 'Configurações', component: <Screen17Configuracoes /> },
  ];

  const handleScreenClick = (screenKey) => {
    navigateTo(screenKey);
    setViewMode('device');
  };

  return (
    <div className="w-full min-h-screen bg-[#0A0A0C] py-10 px-4 flex flex-col items-center select-none overflow-x-auto">
      {/* Zoom Control Bar */}
      <div className="fixed bottom-6 right-6 z-50 bg-[#16161A]/95 backdrop-blur-md border border-[#28282E] rounded-2xl px-3.5 py-1.5 flex items-center space-x-2.5 shadow-2xl">
        <span className="text-[11px] font-semibold text-zinc-400">Zoom:</span>
        <button
          onClick={() => setZoomScale(s => Math.max(0.6, Number((s - 0.1).toFixed(2))))}
          className="w-6 h-6 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-xs font-bold flex items-center justify-center transition-colors"
        >
          -
        </button>
        <span className="text-[11px] font-mono font-bold text-white min-w-[35px] text-center">
          {Math.round(zoomScale * 100)}%
        </span>
        <button
          onClick={() => setZoomScale(s => Math.min(1.4, Number((s + 0.1).toFixed(2))))}
          className="w-6 h-6 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-xs font-bold flex items-center justify-center transition-colors"
        >
          +
        </button>
        <button
          onClick={() => setZoomScale(1)}
          className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[10px] font-medium transition-colors"
        >
          100%
        </button>
      </div>

      {/* 17 PURE SCREENS MATRIX: EXACT 3-ROW LAYOUT */}
      <div 
        style={{ transform: `scale(${zoomScale})`, transformOrigin: 'top center' }}
        className="flex flex-col space-y-12 transition-transform duration-150"
      >
        {/* Row 1 (6 Pure Screens) */}
        <div className="flex items-start justify-center space-x-4">
          {row1.map(screen => (
            <CleanScreen
              key={screen.key}
              label={screen.label}
              number={screen.num}
              onClick={() => handleScreenClick(screen.key)}
              width={200}
              height={440}
            >
              {screen.component}
            </CleanScreen>
          ))}
        </div>

        {/* Row 2 (5 Pure Screens) */}
        <div className="flex items-start justify-center space-x-8">
          {row2.map(screen => (
            <CleanScreen
              key={screen.key}
              label={screen.label}
              number={screen.num}
              onClick={() => handleScreenClick(screen.key)}
              width={200}
              height={440}
            >
              {screen.component}
            </CleanScreen>
          ))}
        </div>

        {/* Row 3 (6 Pure Screens) */}
        <div className="flex items-start justify-center space-x-4">
          {row3.map(screen => (
            <CleanScreen
              key={screen.key}
              label={screen.label}
              number={screen.num}
              onClick={() => handleScreenClick(screen.key)}
              width={200}
              height={440}
            >
              {screen.component}
            </CleanScreen>
          ))}
        </div>
      </div>
    </div>
  );
}
