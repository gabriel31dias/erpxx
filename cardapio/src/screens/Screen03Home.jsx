import React, { useState } from 'react';
import { Menu, ChevronRight } from 'lucide-react';
import { ScrollRow } from '../components/ScrollRow';
import { useApp, brl } from '../context/AppContext';
import { BottomNav } from '../components/BottomNav';
import { AddButton } from '../components/AddButton';
import { SideMenu } from '../components/SideMenu';

export function Screen03Home() {
  const { navigateTo, selectedCategory, setSelectedCategory, setCategoryFilter, setSelectedProduct, addToCart, storeInfo, categories, products } = useApp();

  const [menuOpen, setMenuOpen] = useState(false);

  // uma seção por categoria (sem categoria vai pra "Outros"); a pílula filtra as seções
  const sections = [
    ...categories.map(c => ({ ...c, items: products.filter(p => p.category === c.id) })),
    { id: 'outros', name: 'Outros', items: products.filter(p => !categories.some(c => c.id === p.category)) },
  ].filter(s => s.items.length && (selectedCategory === 'todos' || selectedCategory === s.id));
  const pills = [{ id: 'todos', name: 'Todos' }, ...categories.filter(c => products.some(p => p.category === c.id))];
  const seeAll = (id) => {
    setCategoryFilter(id);
    navigateTo('categoria');
  };

  return (
    <div className="relative w-full h-full min-h-screen bg-black overflow-hidden flex flex-col justify-between select-none">
      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto scrollbar-none">
        
        {/* Top Header Bar */}
        <div className="w-full bg-black px-4 pt-3.5 pb-2 flex items-center justify-between z-20">
          {/* Hamburger Menu */}
          <button 
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
            className="w-9 h-9 flex items-center justify-start text-white hover:text-zinc-300 transition-colors active:scale-95"
          >
            <Menu size={24} className="text-white stroke-[2.5]" />
          </button>

          {/* Center Brand: logo da loja (ou chama) + nome + slogan */}
          <div 
            onClick={() => navigateTo('sobre')}
            className="flex flex-col items-center cursor-pointer group min-w-0 px-2"
          >
            {storeInfo.logo_url ? (
              <img src={storeInfo.logo_url} alt="" style={{ height: storeInfo.logo_size || 32 }} className="w-auto max-w-[220px] object-contain" />
            ) : (
              <div className="w-6 h-6 flex items-center justify-center text-[var(--brand)]">
                <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
                  <path d="M12 23c-4.97 0-9-4.03-9-9 0-4.06 2.76-7.48 6.55-8.63.55-.17 1.07.27.99.84-.26 1.86.32 3.65 1.54 4.88.22.22.58.07.58-.24 0-1.89.87-3.66 2.37-4.83 1.25-.97 2.14-2.37 2.47-3.92.08-.38.54-.53.82-.26C20.31 4.75 21 8.25 21 14c0 4.97-4.03 9-9 9z"/>
                </svg>
              </div>
            )}
            {/* nome oculto continua pro leitor de tela */}
            <h1 className={storeInfo.show_name === false ? 'sr-only' : "text-[17px] font-black tracking-wider text-white uppercase leading-none mt-0.5 font-['Plus_Jakarta_Sans',sans-serif] truncate max-w-[200px]"}>
              {storeInfo.name}
            </h1>
            {storeInfo.subtitle && storeInfo.show_subtitle !== false && (
              <span className="text-[7.5px] font-extrabold tracking-[0.22em] text-white/80 uppercase leading-none mt-1 truncate max-w-[200px]">
                {storeInfo.subtitle}
              </span>
            )}
          </div>

          {/* Status aberto/fechado */}
          <div 
            onClick={() => navigateTo('sobre')}
            className="bg-[#1A1A1E] hover:bg-[#25252B] border border-white/10 px-3 py-1.5 rounded-full flex items-center space-x-1.5 cursor-pointer shadow-sm transition active:scale-95 shrink-0"
          >
            <span className={`w-2 h-2 rounded-full ${storeInfo.is_open ? 'bg-emerald-400' : 'bg-red-500'}`} />
            <span className="text-xs font-bold text-white">{storeInfo.is_open ? 'Aberto' : 'Fechado'}</span>
          </div>
        </div>

        {/* Hero Banner da loja */}
        {storeInfo.banner_url ? (
          <div className="relative w-full overflow-hidden bg-black flex items-center justify-center -mt-0.5 pb-2">
            <img
              src={storeInfo.banner_url}
              alt={storeInfo.name}
              // altura travada entre 160 e 240px: banner alto ou fino não quebra o layout
              className="w-full h-auto min-h-[160px] max-h-[240px] object-cover object-center select-none"
            />
          </div>
        ) : (
          <div className="h-8" />
        )}

        {/* White Main Container with Rounded Top Corners */}
        <div className="relative -mt-4 bg-white rounded-t-[30px] pt-4 px-4 pb-24 shadow-2xl min-h-[500px]">
          
          {!storeInfo.is_open && (
            <div className="mb-3 rounded-2xl bg-red-50 border border-red-100 px-3 py-2 text-xs font-semibold text-red-600">
              Estamos fechados agora. Horário: {storeInfo.hours}
            </div>
          )}

          {/* Horizontal Categories Filter Pills */}
          <ScrollRow className="pb-2 pt-0.5">
            {pills.map(cat => {
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all duration-150 active:scale-95 ${
                    isSelected
                      ? 'bg-[var(--brand)] text-white shadow-sm'
                      : 'bg-[#F1F5F9] text-[#475569] hover:bg-slate-200'
                  }`}
                >
                  {cat.name}
                </button>
              );
            })}
          </ScrollRow>

          {products.length === 0 && (
            <p className="py-16 text-center text-sm font-medium text-slate-400">Cardápio em montagem. Volte em breve!</p>
          )}

          {sections.map(section => (
            <div key={section.id} className="mt-3.5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[19px] font-black text-slate-900 tracking-tight">
                  {section.name}
                </h3>
                {section.id !== 'outros' && (
                  <button
                    onClick={() => seeAll(section.id)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-900 flex items-center space-x-0.5 transition-colors"
                  >
                    <span>Ver todos</span>
                    <ChevronRight size={14} className="stroke-[2.5]" />
                  </button>
                )}
              </div>

              <div className="space-y-2.5">
                {section.items.map(product => (
                  <div
                    key={product.id}
                    onClick={() => {
                      setSelectedProduct(product);
                      navigateTo('detalhe');
                    }}
                    className="flex items-center justify-between p-2.5 bg-white border border-slate-100 rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-md hover:border-slate-200 transition-all cursor-pointer group active:scale-[0.98]"
                  >
                    <div className="flex items-center space-x-3 flex-1 min-w-0 pr-2">
                      <div className="w-[68px] h-[68px] shrink-0 rounded-2xl overflow-hidden bg-slate-100 flex items-center justify-center shadow-xs">
                        <img
                          src={product.image}
                          alt={product.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[14px] font-bold text-slate-900 truncate">
                          {product.name}
                        </h4>
                        <p className="text-[10px] text-slate-500 line-clamp-2 leading-tight mt-0.5">
                          {product.description}
                        </p>
                        <div className="text-[13px] font-extrabold text-[var(--brand)] mt-1">
                          {product.sizes.length > 0 && <span className="text-[10px] font-semibold text-slate-400 mr-1">a partir de</span>}
                          {brl(product.price)}
                          {product.oldPrice ? <span className="ml-1.5 text-[11px] font-semibold text-slate-400 line-through">{brl(product.oldPrice)}</span> : null}
                        </div>
                      </div>
                    </div>

                    {/* com adicionais abre o detalhe pra escolher; sem, adiciona direto */}
                    <AddButton product={product} />
                  </div>
                ))}
              </div>
            </div>
          ))}

        </div>
      </div>

      {/* Bottom Navigation Bar */}
      <BottomNav activeTabOverride="home" />
      <SideMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}
