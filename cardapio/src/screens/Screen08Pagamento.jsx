import React from 'react';
import { MessageCircle } from 'lucide-react';
import { useApp, brl } from '../context/AppContext';
import { ScreenHeader } from '../components/ScreenHeader';

const PixIcon = () => (
  <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2L6 8l3 3-3 3 6 6 6-6-3-3 3-3-6-6zm0 4.8l2.6 2.6-2.6 2.6-2.6-2.6L12 6.8zM8.2 12l2 2-2 2-2-2 2-2zm7.6 0l2 2-2 2-2-2 2-2zm-3.8 1.4l2.6 2.6-2.6 2.6-2.6-2.6 2.6-2.6z" />
  </svg>
);

export function Screen08Pagamento() {
  const { selectedPayment, setSelectedPayment, placeOrder, placing, orderError, storeInfo, total, cart, navigateTo, customer } = useApp();

  const methods = [
    storeInfo.whatsapp_enabled && {
      id: 'whatsapp',
      name: 'Combinar pelo WhatsApp',
      subtitle: 'Dinheiro, cartão ou Pix na entrega',
      icon: <MessageCircle size={18} className="text-[#00C259]" />,
    },
    storeInfo.pix_enabled && {
      id: 'pix',
      name: 'Pix agora',
      subtitle: 'QR Code Mercado Pago · aprovação imediata',
      icon: <PixIcon />,
    },
  ].filter(Boolean);

  // pix escolhido aqui sem e-mail: volta pro formulário pedir
  const finish = () => {
    if (selectedPayment === 'pix' && !customer.email) return navigateTo('endereco');
    placeOrder();
  };

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col justify-between select-none">
      {/* Top Header */}
      <div className="shrink-0 pt-2">
        <ScreenHeader title="Pagamento" />
      </div>

      {/* Payment Options */}
      <div className="flex-1 overflow-y-auto px-5 py-2 space-y-3.5 scrollbar-none">
        {methods.map((method) => {
          const isSelected = selectedPayment === method.id;
          return (
            <div
              key={method.id}
              onClick={() => setSelectedPayment(method.id)}
              className={`p-4 rounded-2xl border flex items-center justify-between cursor-pointer transition-all ${
                isSelected ? 'bg-[#18181C] border-zinc-500' : 'bg-[#141416] border-[#26262C] hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center space-x-3.5">
                <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-[#26262C] flex items-center justify-center shrink-0">
                  {method.icon}
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white tracking-tight">{method.name}</h3>
                  <p className="text-[11px] text-zinc-400 mt-0.5">{method.subtitle}</p>
                </div>
              </div>

              {/* Radio Indicator */}
              <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${isSelected ? 'border-[var(--brand)]' : 'border-zinc-500'}`}>
                {isSelected && <div className="w-2 h-2 rounded-full bg-[var(--brand)]" />}
              </div>
            </div>
          );
        })}

        <div className="flex items-center justify-between pt-2 text-sm">
          <span className="text-zinc-400 font-medium">Total</span>
          <span className="font-black text-white">{brl(total)}</span>
        </div>
        {orderError && (
          <p className="rounded-2xl bg-red-500/10 border border-red-500/30 p-3 text-xs font-semibold text-red-400">{orderError}</p>
        )}
      </div>

      {/* Bottom Button */}
      <div className="p-4 bg-[#0E0E10] border-t border-[#202026] shrink-0">
        <button
          onClick={finish}
          disabled={placing || cart.length === 0}
          className="w-full py-3.5 bg-[var(--brand)] hover:brightness-90 active:scale-[0.98] transition-all rounded-2xl text-white font-semibold text-sm shadow-lg disabled:opacity-60"
        >
          {placing ? 'Enviando pedido...' : selectedPayment === 'pix' ? 'Gerar QR Code Pix' : 'Enviar pedido no WhatsApp'}
        </button>
      </div>
    </div>
  );
}
