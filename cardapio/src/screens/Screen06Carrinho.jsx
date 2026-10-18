import React from 'react';
import { ArrowLeft, Trash2, Plus, Minus, MessageCircle, QrCode } from 'lucide-react';
import { useApp, brl } from '../context/AppContext';

export function Screen06Carrinho() {
  const {
    cart,
    updateCartQuantity,
    clearCart,
    subtotal,
    deliveryFee,
    total,
    navigateTo,
    storeInfo,
    setSelectedPayment,
  } = useApp();

  const checkout = (method) => {
    setSelectedPayment(method);
    navigateTo('endereco');
  };

  return (
    <div className="relative w-full h-full min-h-screen bg-white text-slate-900 overflow-hidden flex flex-col justify-between select-none">
      {/* Top Header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between border-b border-slate-100 bg-white z-10">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => navigateTo('home')}
            aria-label="Voltar"
            className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 hover:bg-slate-200 active:scale-95 transition"
          >
            <ArrowLeft size={19} className="stroke-[2.5]" />
          </button>
          <h1 className="text-lg font-black text-slate-900 tracking-tight">
            Meu pedido
          </h1>
        </div>

        {cart.length > 0 && (
          <button
            onClick={clearCart}
            aria-label="Esvaziar carrinho"
            className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-red-500 active:scale-95 transition"
          >
            <Trash2 size={18} />
          </button>
        )}
      </div>

      {/* Cart Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 scrollbar-none pb-44">
        {cart.length === 0 ? (
          <div className="py-20 text-center text-slate-400 space-y-3">
            <p className="text-sm font-medium">Seu carrinho está vazio</p>
            <button
              onClick={() => navigateTo('home')}
              className="px-5 py-2.5 bg-[var(--brand)] text-white text-xs font-bold rounded-xl shadow-md active:scale-95"
            >
              Explorar cardápio
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {cart.map((item) => (
              <div
                key={item.key}
                className="bg-white border border-slate-100 rounded-2xl p-3 flex items-center justify-between shadow-[0_2px_8px_rgba(0,0,0,0.03)]"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="w-14 h-14 rounded-xl bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                    <img
                      src={item.product.thumb || item.product.image}
                      alt={item.product.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs font-bold text-slate-900 tracking-tight truncate">
                      {item.name || item.product.name}
                    </h3>
                    {(item.options?.length > 0 || item.selectedAdditionals?.length > 0) && (
                      <p className="text-[10px] text-slate-500 truncate">
                        + {[...(item.options || []).map((o) => `${o.group}: ${o.name}`), ...item.selectedAdditionals.map((a) => a.name)].join(', ')}
                      </p>
                    )}
                    <span className="text-xs font-extrabold text-[var(--brand)] block mt-0.5">
                      {brl(item.itemTotal)}
                    </span>
                  </div>
                </div>

                {/* Quantity Stepper */}
                <div className="flex items-center space-x-2 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-xl shrink-0">
                  <button
                    aria-label="Diminuir"
                    onClick={() => updateCartQuantity(item.key, -1)}
                    className="w-4 h-4 flex items-center justify-center text-slate-600 hover:text-slate-900 active:scale-90"
                  >
                    <Minus size={12} className="stroke-[2.5]" />
                  </button>
                  <span className="text-xs font-bold text-slate-900 min-w-[14px] text-center">
                    {item.quantity}
                  </span>
                  <button
                    aria-label="Aumentar"
                    onClick={() => updateCartQuantity(item.key, 1)}
                    className="w-4 h-4 flex items-center justify-center text-slate-600 hover:text-slate-900 active:scale-90"
                  >
                    <Plus size={12} className="stroke-[2.5]" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Financial Summary */}
        {cart.length > 0 && (
          <div className="pt-3 border-t border-slate-100 space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-500 font-medium">
              <span>Subtotal</span>
              <span className="font-bold text-slate-900">{brl(subtotal)}</span>
            </div>

            <div className="flex items-center justify-between text-slate-500 font-medium">
              <span>Entrega</span>
              <span className="font-bold text-slate-900">
                {deliveryFee === 0 ? 'Grátis' : brl(deliveryFee)}
              </span>
            </div>

            <div className="flex items-center justify-between text-sm font-bold text-slate-900 pt-1 border-t border-slate-100">
              <span className="text-base font-black">Total</span>
              <span className="text-base font-black text-slate-900">{brl(total)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Actions */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 max-w-[440px] mx-auto p-4 bg-white border-t border-slate-100 shrink-0 z-30 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] space-y-2">
          {!storeInfo.is_open && (
            <p className="text-center text-xs font-semibold text-red-500">Loja fechada agora — volte no horário {storeInfo.hours}</p>
          )}
          {storeInfo.whatsapp_enabled && (
            <button
              disabled={!storeInfo.is_open}
              onClick={() => checkout('whatsapp')}
              className="w-full py-3.5 bg-[#00C259] hover:bg-[#00ab4e] active:scale-[0.98] transition-all rounded-2xl text-white font-bold text-sm shadow-[0_4px_16px_rgba(0,194,89,0.35)] flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              <MessageCircle size={19} className="fill-white" />
              <span>Finalizar pedido pelo WhatsApp</span>
            </button>
          )}

          {storeInfo.pix_enabled && (
            <button
              disabled={!storeInfo.is_open}
              onClick={() => checkout('pix')}
              className={
                storeInfo.whatsapp_enabled
                  ? 'w-full py-2.5 text-center text-xs font-bold text-slate-600 hover:text-slate-900 transition flex items-center justify-center gap-1.5 disabled:opacity-50'
                  : 'w-full py-3.5 bg-[var(--brand)] hover:brightness-90 active:scale-[0.98] transition-all rounded-2xl text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2 disabled:opacity-50'
              }
            >
              <QrCode size={storeInfo.whatsapp_enabled ? 15 : 19} />
              <span>{storeInfo.whatsapp_enabled ? 'Ou pagar agora com Pix' : 'Pagar com Pix'}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
