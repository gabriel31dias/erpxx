import React from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { ScrollRow } from '../components/ScrollRow';
import { useApp, brl } from '../context/AppContext';
import { BottomNav } from '../components/BottomNav';
import { AddButton } from '../components/AddButton';

export function Screen04Categoria() {
  const { categoryFilter, setCategoryFilter, setSelectedProduct, addToCart, navigateTo, goBack, categories, products, searchQuery, setSearchQuery } = useApp();
  const [searching, setSearching] = React.useState(!!searchQuery);

  const q = searchQuery.trim().toLowerCase();
  const filteredProducts = products.filter(p =>
    (categoryFilter === 'todos' || p.category === categoryFilter) &&
    (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
  );
  const pills = [{ id: 'todos', name: 'Todos' }, ...categories.filter(c => products.some(p => p.category === c.id))];

  return (
    <div className="relative w-full h-full min-h-screen bg-white text-slate-900 overflow-hidden flex flex-col justify-between select-none">
      {/* Top Header */}
      <div className="shrink-0 bg-white border-b border-slate-100">
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              onClick={goBack}
              className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 hover:bg-slate-200 active:scale-95 transition"
            >
              <ArrowLeft size={19} className="stroke-[2.5]" />
            </button>
            <h1 className="text-lg font-black text-slate-900 tracking-tight">
              Cardápio
            </h1>
          </div>

          <button
            aria-label="Buscar"
            onClick={() => {
              if (searching) setSearchQuery('');
              setSearching(!searching);
            }}
            className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 active:scale-95 transition"
          >
            <Search size={18} />
          </button>
        </div>

        {searching && (
          <div className="px-4 pb-1">
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar no cardápio"
              className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl px-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-400"
            />
          </div>
        )}

        {/* Filter Pills */}
        <ScrollRow className="px-4 py-2.5">
          {pills.map(cat => {
            const isActive = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setCategoryFilter(cat.id)}
                className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all duration-150 active:scale-95 ${
                  isActive
                    ? 'bg-[var(--brand)] text-white shadow-sm'
                    : 'bg-[#F1F5F9] text-[#475569] hover:bg-slate-200'
                }`}
              >
                {cat.name}
              </button>
            );
          })}
        </ScrollRow>
      </div>

      {/* Product List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 scrollbar-none pb-6">
        {filteredProducts.length === 0 && (
          <p className="py-16 text-center text-sm font-medium text-slate-400">Nenhum produto encontrado.</p>
        )}
        {filteredProducts.map(product => (
          <div
            key={product.id}
            onClick={() => {
              setSelectedProduct(product);
              navigateTo('detalhe');
            }}
            className="flex items-center justify-between p-2.5 bg-white border border-slate-100 rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-md hover:border-slate-200 transition-all cursor-pointer group active:scale-[0.98]"
          >
            {/* Thumbnail */}
            <div className="flex items-center space-x-3 flex-1 min-w-0 pr-2">
              <div className="w-[68px] h-[68px] shrink-0 rounded-2xl overflow-hidden bg-slate-100 flex items-center justify-center shadow-xs">
                <img
                  src={product.thumb || product.image}
                  alt={product.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h3 className="text-[14px] font-bold text-slate-900 tracking-tight truncate">
                  {product.name}
                </h3>
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

            {/* Add Button */}
            <AddButton product={product} />
          </div>
        ))}
      </div>

      {/* Bottom Nav */}
      <BottomNav activeTabOverride="cardapio" />
    </div>
  );
}
