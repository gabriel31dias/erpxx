import React from 'react';
import { Heart } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ScreenHeader } from '../components/ScreenHeader';

export function Screen13Favoritos() {
  const { favorites, toggleFavorite, setSelectedProduct, navigateTo, products } = useApp();

  const favProducts = products.filter(p => favorites.includes(p.id));

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col justify-between select-none">
      {/* Top Header */}
      <div className="shrink-0 pt-2">
        <ScreenHeader title="Meus favoritos" />
      </div>

      {/* Favorites List */}
      <div className="flex-1 overflow-y-auto px-5 py-2 space-y-3 scrollbar-none">
        {favProducts.length === 0 && (
          <p className="py-16 text-center text-xs text-zinc-500">Toque no coração de um produto para salvar aqui.</p>
        )}
        {favProducts.map(product => (
          <div
            key={product.id}
            onClick={() => {
              setSelectedProduct(product);
              navigateTo('detalhe');
            }}
            className="bg-[#18181C] border border-[#26262C] hover:border-zinc-700 rounded-2xl p-3 flex items-center justify-between cursor-pointer group transition-all active:scale-[0.98]"
          >
            {/* Product Thumbnail & Details */}
            <div className="flex items-center space-x-3 min-w-0">
              <div className="w-14 h-14 rounded-xl bg-zinc-900 overflow-hidden shrink-0 flex items-center justify-center">
                <img
                  src={product.thumb || product.image}
                  alt={product.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                />
              </div>

              <div className="min-w-0">
                <h3 className="text-xs font-bold text-white truncate">
                  {product.name}
                </h3>
                <span className="text-xs font-bold text-[var(--brand)] block mt-1">
                  R$ {product.price.toFixed(2).replace('.', ',')}
                </span>
              </div>
            </div>

            {/* Red Filled Heart */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFavorite(product.id);
              }}
              className="w-8 h-8 flex items-center justify-center text-[var(--brand)] hover:scale-110 active:scale-95 transition-transform shrink-0"
            >
              <Heart size={18} className="fill-[var(--brand)]" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
