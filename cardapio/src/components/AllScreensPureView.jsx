import React from 'react';
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

export function AllScreensPureView() {
  const row1 = [
    { num: 1, label: 'Splash', component: <Screen01Splash /> },
    { num: 2, label: 'Onboarding', component: <Screen02Onboarding /> },
    { num: 3, label: 'Home', component: <Screen03Home /> },
    { num: 4, label: 'Categoria', component: <Screen04Categoria /> },
    { num: 5, label: 'Detalhe do produto', component: <Screen05DetalheProduto /> },
    { num: 6, label: 'Carrinho', component: <Screen06Carrinho /> },
  ];

  const row2 = [
    { num: 7, label: 'Endereço', component: <Screen07Endereco /> },
    { num: 8, label: 'Pagamento', component: <Screen08Pagamento /> },
    { num: 9, label: 'Pedido realizado', component: <Screen09PedidoRealizado /> },
    { num: 10, label: 'Meus pedidos', component: <Screen10MeusPedidos /> },
    { num: 11, label: 'Rastreamento', component: <Screen11Rastreamento /> },
  ];

  const row3 = [
    { num: 12, label: 'Perfil', component: <Screen12Perfil /> },
    { num: 13, label: 'Favoritos', component: <Screen13Favoritos /> },
    { num: 14, label: 'Promoções', component: <Screen14Promocoes /> },
    { num: 15, label: 'Sobre o restaurante', component: <Screen15Sobre /> },
    { num: 16, label: 'Suporte', component: <Screen16Suporte /> },
    { num: 17, label: 'Configurações', component: <Screen17Configuracoes /> },
  ];

  return (
    <div className="w-full min-h-screen bg-[#0A0A0C] py-8 px-6 flex flex-col items-center select-none overflow-x-auto">
      <div className="flex flex-col space-y-10 min-w-fit">
        {/* Row 1 */}
        <div className="flex items-start justify-center space-x-5">
          {row1.map(screen => (
            <div key={screen.num} className="flex flex-col items-center">
              <div className="w-[195px] h-[430px] rounded-2xl overflow-hidden bg-[#0E0E10] border border-[#222226] shadow-xl">
                {screen.component}
              </div>
              <span className="mt-2.5 text-[11px] font-medium text-zinc-400">
                {screen.num}. {screen.label}
              </span>
            </div>
          ))}
        </div>

        {/* Row 2 */}
        <div className="flex items-start justify-center space-x-8">
          {row2.map(screen => (
            <div key={screen.num} className="flex flex-col items-center">
              <div className="w-[195px] h-[430px] rounded-2xl overflow-hidden bg-[#0E0E10] border border-[#222226] shadow-xl">
                {screen.component}
              </div>
              <span className="mt-2.5 text-[11px] font-medium text-zinc-400">
                {screen.num}. {screen.label}
              </span>
            </div>
          ))}
        </div>

        {/* Row 3 */}
        <div className="flex items-start justify-center space-x-5">
          {row3.map(screen => (
            <div key={screen.num} className="flex flex-col items-center">
              <div className="w-[195px] h-[430px] rounded-2xl overflow-hidden bg-[#0E0E10] border border-[#222226] shadow-xl">
                {screen.component}
              </div>
              <span className="mt-2.5 text-[11px] font-medium text-zinc-400">
                {screen.num}. {screen.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
