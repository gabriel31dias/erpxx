import React, { useState } from 'react';
import { SCREENS_INFO } from '../data/mockData';
import { CleanScreen } from './CleanScreen';
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

export function ComparisonViewer() {
  const [selectedScreen, setSelectedScreen] = useState('3');
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);

  const screenMap = {
    '1': { comp: <Screen01Splash />, crop: '/assets/tight_screens/1_splash.png', title: '1. Splash' },
    '2': { comp: <Screen02Onboarding />, crop: '/assets/tight_screens/2_onboarding.png', title: '2. Onboarding' },
    '3': { comp: <Screen03Home />, crop: '/assets/tight_screens/3_home.png', title: '3. Home' },
    '4': { comp: <Screen04Categoria />, crop: '/assets/tight_screens/4_categoria.png', title: '4. Categoria' },
    '5': { comp: <Screen05DetalheProduto />, crop: '/assets/tight_screens/5_detalhe.png', title: '5. Detalhe do produto' },
    '6': { comp: <Screen06Carrinho />, crop: '/assets/tight_screens/6_carrinho.png', title: '6. Carrinho' },
    '7': { comp: <Screen07Endereco />, crop: '/assets/tight_screens/7_endereco.png', title: '7. Endereço' },
    '8': { comp: <Screen08Pagamento />, crop: '/assets/tight_screens/8_pagamento.png', title: '8. Pagamento' },
    '9': { comp: <Screen09PedidoRealizado />, crop: '/assets/tight_screens/9_pedido_realizado.png', title: '9. Pedido realizado' },
    '10': { comp: <Screen10MeusPedidos />, crop: '/assets/tight_screens/10_meus_pedidos.png', title: '10. Meus pedidos' },
    '11': { comp: <Screen11Rastreamento />, crop: '/assets/tight_screens/11_rastreamento.png', title: '11. Rastreamento' },
    '12': { comp: <Screen12Perfil />, crop: '/assets/tight_screens/12_perfil.png', title: '12. Perfil' },
    '13': { comp: <Screen13Favoritos />, crop: '/assets/tight_screens/13_favoritos.png', title: '13. Favoritos' },
    '14': { comp: <Screen14Promocoes />, crop: '/assets/tight_screens/14_promocoes.png', title: '14. Promoções' },
    '15': { comp: <Screen15Sobre />, crop: '/assets/tight_screens/15_sobre.png', title: '15. Sobre o restaurante' },
    '16': { comp: <Screen16Suporte />, crop: '/assets/tight_screens/16_suporte.png', title: '16. Suporte' },
    '17': { comp: <Screen17Configuracoes />, crop: '/assets/tight_screens/17_configuracoes.png', title: '17. Configurações' },
  };

  const current = screenMap[selectedScreen];

  return (
    <div className="w-full min-h-screen bg-[#0A0A0C] text-white p-6 flex flex-col items-center">
      {/* Control Bar */}
      <div className="w-full max-w-4xl bg-[#16161A] border border-[#26262C] rounded-2xl p-4 mb-8 shadow-xl flex flex-wrap items-center justify-between gap-4">
        {/* Screen Picker */}
        <div className="flex items-center space-x-3">
          <label className="text-xs font-bold text-zinc-300">Tela:</label>
          <select
            value={selectedScreen}
            onChange={(e) => setSelectedScreen(e.target.value)}
            className="bg-[#202024] border border-[#303036] text-xs font-semibold text-white rounded-xl px-3 py-2 focus:outline-none"
          >
            {SCREENS_INFO.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Overlay Toggle */}
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={showOverlay}
              onChange={(e) => setShowOverlay(e.target.checked)}
              className="accent-[var(--brand)] rounded"
            />
            <span className="font-medium text-zinc-300">Modo Sobreposição</span>
          </label>

          {showOverlay && (
            <div className="flex items-center space-x-2">
              <span className="text-[11px] text-zinc-400">Opacidade:</span>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
                className="w-24 accent-[var(--brand)]"
              />
              <span className="text-[11px] font-mono text-zinc-300">{Math.round(overlayOpacity * 100)}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Comparison Area */}
      <div className="w-full max-w-4xl flex items-start justify-center gap-10 flex-wrap">
        {/* Reference Crop */}
        <div className="flex flex-col items-center">
          <div className="mb-2.5 px-3 py-1 bg-zinc-800 rounded-lg text-xs font-bold text-zinc-300">
            Referência Original
          </div>
          <div className="w-[280px] h-[580px] rounded-2xl bg-[#0E0E10] border border-[#28282E] overflow-hidden shadow-2xl flex items-center justify-center">
            <img
              src={current.crop}
              alt="Referência Original"
              className="w-full h-full object-fill"
            />
          </div>
        </div>

        {/* Recreated Pure Screen */}
        <div className="flex flex-col items-center relative">
          <div className="mb-2.5 px-3 py-1 bg-[var(--brand)]/20 border border-[var(--brand)]/40 rounded-lg text-xs font-bold text-[var(--brand)]">
            Tela Recriada 100%
          </div>
          <div className="relative">
            <CleanScreen
              label={current.title}
              width={280}
              height={580}
            >
              {current.comp}
            </CleanScreen>

            {/* Overlay */}
            {showOverlay && (
              <div
                style={{ opacity: overlayOpacity }}
                className="absolute inset-0 z-50 pointer-events-none rounded-2xl overflow-hidden"
              >
                <img
                  src={current.crop}
                  alt="Overlay"
                  className="w-full h-full object-fill"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
