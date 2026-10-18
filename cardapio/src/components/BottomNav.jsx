import React from 'react';
import { Home, FileText, ShoppingBag, Receipt, MoreHorizontal } from 'lucide-react';
import { useApp } from '../context/AppContext';

export function BottomNav({ activeTabOverride }) {
  const { activeTab, setActiveTab, navigateTo, cart } = useApp();
  const current = activeTabOverride || activeTab;

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const tabs = [
    { id: 'home', label: 'Início', icon: Home, screen: 'home' },
    { id: 'cardapio', label: 'Cardápio', icon: FileText, screen: 'categoria' },
    { id: 'meupedido', label: 'Carrinho', icon: ShoppingBag, screen: 'carrinho', badge: totalCartCount || undefined },
    { id: 'comanda', label: 'Pedidos', icon: Receipt, screen: 'meus_pedidos' },
    { id: 'mais', label: 'Mais', icon: MoreHorizontal, screen: 'perfil' },
  ];

  // ponytail: spacer holds the nav's height in the flow so content isn't hidden behind the fixed bar
  return (
    <>
    <div className="h-[68px] shrink-0" />
    <div className="fixed bottom-0 left-0 right-0 max-w-[440px] mx-auto bg-white border-t border-slate-100 py-2 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-center justify-around z-30 shadow-[0_-4px_25px_rgba(0,0,0,0.05)]">
      {tabs.map(tab => {
        const Icon = tab.icon;
        const isActive = current === tab.id || (tab.id === 'home' && current === 'home');
        return (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              navigateTo(tab.screen);
            }}
            className="flex flex-col items-center justify-center space-y-1 py-1 px-2.5 transition-all duration-150 group relative"
          >
            <div className="relative">
              <Icon
                size={22}
                className={`transition-colors duration-150 ${
                  isActive ? 'text-[var(--brand)] stroke-[2.4]' : 'text-slate-500 group-hover:text-slate-800 stroke-[1.8]'
                }`}
              />
              {tab.badge !== undefined && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] bg-[var(--brand)] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 shadow-sm">
                  {tab.badge}
                </span>
              )}
            </div>
            <span
              className={`text-[10px] font-medium tracking-tight ${
                isActive ? 'text-[var(--brand)] font-bold' : 'text-slate-500 group-hover:text-slate-800'
              }`}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
    </>
  );
}
