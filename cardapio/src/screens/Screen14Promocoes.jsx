import React from 'react';
import { useApp, brl } from '../context/AppContext';
import { ScreenHeader } from '../components/ScreenHeader';

// promoção = produto com "preço antigo" cadastrado no painel
export function Screen14Promocoes() {
  const { navigateTo, setSelectedProduct, products } = useApp();
  const promos = products.filter((p) => p.oldPrice && p.oldPrice > p.price);

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col justify-between select-none">
      {/* Top Header */}
      <div className="shrink-0 pt-2">
        <ScreenHeader title="Promoções" />
      </div>

      {/* Promotions List */}
      <div className="flex-1 overflow-y-auto px-5 py-2 space-y-4 scrollbar-none">
        {promos.length === 0 && (
          <p className="py-16 text-center text-xs text-zinc-500">Nenhuma promoção no momento.</p>
        )}
        {promos.map((p) => (
          <div
            key={p.id}
            onClick={() => {
              setSelectedProduct(p);
              navigateTo('detalhe');
            }}
            className="relative w-full rounded-2xl bg-gradient-to-br from-[#2D1214] via-[#1E1113] to-[#141416] border border-red-950/60 p-4 flex items-center justify-between overflow-hidden cursor-pointer group shadow-lg transition-transform active:scale-[0.98]"
          >
            <div className="z-10 max-w-[60%]">
              <span className="inline-block px-2 py-0.5 bg-yellow-400/20 text-yellow-400 border border-yellow-400/30 rounded-md text-[9px] font-bold mb-1">
                {Math.round((1 - p.price / p.oldPrice) * 100)}% OFF
              </span>
              <h3 className="text-sm font-black text-white tracking-tight leading-tight">{p.name}</h3>
              <p className="text-xs text-zinc-300 mt-1 leading-tight line-clamp-2">{p.description}</p>
              <div className="text-sm font-extrabold text-white mt-2">
                {brl(p.price)}
                <span className="ml-2 text-[11px] font-semibold text-zinc-500 line-through">{brl(p.oldPrice)}</span>
              </div>
            </div>

            <div className="w-24 h-20 shrink-0 flex items-center justify-center rounded-xl overflow-hidden">
              <img
                src={p.image}
                alt={p.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
