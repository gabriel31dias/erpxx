import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X, Home, FileText, ShoppingBag, ReceiptText, Heart, Ticket, Store, MessageCircle, Settings, ChevronRight,
} from 'lucide-react';
import { useApp } from '../context/AppContext';

const LINKS = [
  { label: 'Início', icon: Home, screen: 'home' },
  { label: 'Cardápio', icon: FileText, screen: 'categoria' },
  { label: 'Carrinho', icon: ShoppingBag, screen: 'carrinho' },
  { label: 'Meus pedidos', icon: ReceiptText, screen: 'meus_pedidos' },
  { label: 'Favoritos', icon: Heart, screen: 'favoritos' },
  { label: 'Promoções', icon: Ticket, screen: 'promocoes' },
  { label: 'Sobre a loja', icon: Store, screen: 'sobre' },
  { label: 'Falar com a loja', icon: MessageCircle, screen: 'suporte' },
  { label: 'Configurações', icon: Settings, screen: 'configuracoes' },
];

export function SideMenu({ open, onClose }) {
  const { navigateTo, storeInfo, categories, products, setCategoryFilter, currentScreen } = useApp();
  const cats = categories.filter(c => products.some(p => p.category === c.id));

  const go = (screen) => {
    onClose();
    navigateTo(screen);
  };

  return (
    <AnimatePresence>
      {open && (
        // wrapper limited to the app column so the drawer lines up on desktop too
        <div className="fixed inset-0 z-50 max-w-[440px] mx-auto overflow-hidden">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label="Menu"
            className="absolute inset-y-0 left-0 w-[80%] max-w-[320px] bg-[#111114] border-r border-[#26262C] flex flex-col shadow-2xl"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          >
            {/* Store header */}
            <div className="px-5 pt-6 pb-5 border-b border-[#26262C] flex items-start justify-between">
              <div className="flex items-center space-x-3 min-w-0">
                {storeInfo.logo_url ? (
                  <img src={storeInfo.logo_url} alt="" className="w-11 h-11 rounded-xl object-contain bg-black" />
                ) : (
                  <div className="w-11 h-11 rounded-xl bg-[var(--brand)] flex items-center justify-center text-white font-black text-lg">
                    {storeInfo.name?.[0]}
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="text-sm font-black text-white uppercase tracking-wide truncate">{storeInfo.name}</h2>
                  {storeInfo.subtitle && (
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wider truncate mt-0.5">{storeInfo.subtitle}</p>
                  )}
                </div>
              </div>
              <button onClick={onClose} aria-label="Fechar menu" className="p-1 -mr-1 text-zinc-400 hover:text-white active:scale-90 transition">
                <X size={22} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto scrollbar-none py-3">
              {LINKS.map(({ label, icon: Icon, screen }, i) => {
                const active = currentScreen === screen;
                return (
                  <motion.button
                    key={screen}
                    onClick={() => go(screen)}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 + i * 0.03 }}
                    className={`w-full flex items-center space-x-3.5 px-5 py-3 text-left transition-colors ${
                      active ? 'text-white bg-white/5 border-l-[3px] border-[var(--brand)]' : 'text-zinc-300 hover:bg-white/5 hover:text-white border-l-[3px] border-transparent'
                    }`}
                  >
                    <Icon size={19} className={active ? 'text-[var(--brand)]' : 'text-zinc-400'} />
                    <span className="text-[13px] font-semibold">{label}</span>
                  </motion.button>
                );
              })}

              {cats.length > 0 && (
                <>
                  <p className="px-5 pt-5 pb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Categorias</p>
                  {cats.map(c => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setCategoryFilter(c.id);
                        go('categoria');
                      }}
                      className="w-full flex items-center justify-between px-5 py-2.5 text-zinc-300 hover:bg-white/5 hover:text-white transition-colors"
                    >
                      <span className="text-[13px] font-medium">{c.name}</span>
                      <ChevronRight size={15} className="text-zinc-600" />
                    </button>
                  ))}
                </>
              )}
            </nav>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
