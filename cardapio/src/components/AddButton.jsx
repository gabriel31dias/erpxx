import React from 'react';
import { Plus, Minus } from 'lucide-react';
import { useApp, hasChoices } from '../context/AppContext';

// "+" do card; depois de adicionado vira contador [- qtd +].
// com escolhas (adicionais, tamanho, borda...) sempre abre o detalhe, então não tem contador.
export function AddButton({ product }) {
  const { cart, addToCart, updateCartQuantity, setSelectedProduct, navigateTo } = useApp();
  const line = !hasChoices(product) && cart.find(i => i.key.startsWith(`${product.id}|`));
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };

  if (line) {
    return (
      <div className="h-8 shrink-0 bg-[var(--brand)] text-white rounded-full flex items-center shadow-sm" onClick={(e) => e.stopPropagation()}>
        <button
          aria-label={`Remover um ${product.name}`}
          onClick={stop(() => updateCartQuantity(line.key, -1))}
          className="w-8 h-8 flex items-center justify-center active:scale-90 transition-transform"
        >
          <Minus size={15} className="stroke-[3]" />
        </button>
        <span key={line.quantity} className="min-w-[14px] text-center text-[13px] font-extrabold anim-fade-in">{line.quantity}</span>
        <button
          aria-label={`Adicionar mais um ${product.name}`}
          onClick={stop(() => updateCartQuantity(line.key, 1))}
          className="w-8 h-8 flex items-center justify-center active:scale-90 transition-transform"
        >
          <Plus size={15} className="stroke-[3]" />
        </button>
      </div>
    );
  }

  return (
    <button
      aria-label={`Adicionar ${product.name}`}
      onClick={stop(() => {
        if (hasChoices(product)) {
          setSelectedProduct(product);
          navigateTo('detalhe');
        } else addToCart(product, 1);
      })}
      className="w-8 h-8 shrink-0 bg-[var(--brand)] hover:brightness-90 text-white rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-transform"
    >
      <Plus size={16} className="stroke-[3]" />
    </button>
  );
}
