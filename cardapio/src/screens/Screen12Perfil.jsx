import React from 'react';
import {
  ReceiptText,
  Heart,
  Ticket,
  Store,
  MessageCircle,
  ChevronRight,
  User
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BottomNav } from '../components/BottomNav';

export function Screen12Perfil() {
  const { customer, navigateTo } = useApp();

  const menuItems = [
    { id: 'pedidos', label: 'Meus pedidos', icon: ReceiptText, screen: 'meus_pedidos' },
    { id: 'favoritos', label: 'Meus favoritos', icon: Heart, screen: 'favoritos' },
    { id: 'cupons', label: 'Promoções', icon: Ticket, screen: 'promocoes' },
    { id: 'sobre', label: 'Sobre a loja', icon: Store, screen: 'sobre' },
    { id: 'suporte', label: 'Falar com a loja', icon: MessageCircle, screen: 'suporte' },
  ];

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col justify-between select-none">
      {/* Top Header */}
      <div className="shrink-0 pt-4">
        <div className="px-5 pt-2 pb-3">
          <h1 className="text-base font-bold text-white tracking-tight">
            Meu perfil
          </h1>
        </div>

        {/* User Card */}
        <div className="px-5 pb-3">
          <div className="flex items-center space-x-3.5 bg-[#18181C] border border-[#26262C] p-3.5 rounded-2xl">
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
              <User size={24} />
            </div>

            <div className="flex-1 min-w-0">
              <h2 className="text-xs font-bold text-white tracking-tight truncate">
                {customer.name || 'Visitante'}
              </h2>
              <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                {customer.phone || 'Seus dados ficam salvos neste aparelho'}
              </p>

            </div>
          </div>
        </div>
      </div>

      {/* Menu Options */}
      <div className="flex-1 overflow-y-auto px-5 space-y-2 scrollbar-none pb-4">
        {menuItems.map(item => {
          const Icon = item.icon;
          const isLogout = item.id === 'sair';

          return (
            <button
              key={item.id}
              onClick={() => navigateTo(item.screen)}
              className="w-full bg-[#18181C] hover:bg-[#202024] border border-[#26262C] rounded-2xl px-4 py-3 flex items-center justify-between transition-colors group"
            >
              <div className="flex items-center space-x-3">
                <Icon size={16} className={isLogout ? 'text-zinc-400 group-hover:text-red-400' : 'text-zinc-300 group-hover:text-white'} />
                <span className={`text-xs font-medium ${isLogout ? 'text-zinc-300 group-hover:text-red-400' : 'text-zinc-200 group-hover:text-white'}`}>
                  {item.label}
                </span>
              </div>

              <ChevronRight size={14} className="text-zinc-500 group-hover:text-zinc-300" />
            </button>
          );
        })}
      </div>

      {/* Bottom Nav */}
      <BottomNav activeTabOverride="mais" />
    </div>
  );
}
