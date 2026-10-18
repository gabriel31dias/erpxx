import React, { useEffect } from 'react';
import { Check } from 'lucide-react';
import { useApp } from '../context/AppContext';
import confetti from 'canvas-confetti';

export function Screen09PedidoRealizado() {
  const { navigateTo, activeOrder } = useApp();
  const viaWhatsapp = activeOrder?.payment_method === 'whatsapp';

  useEffect(() => {
    try {
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.4 },
        colors: ['#10B981', '#FFB800', '#FFFFFF']
      });
    } catch (e) {}
  }, []);

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col justify-between select-none px-6 py-12">
      <div className="h-6" />

      {/* Center Success Info */}
      <div className="flex-1 flex flex-col items-center justify-center text-center -mt-6">
        {/* Green Badge with checkmark and celebration particles */}
        <div className="relative mb-6">
          <div className="absolute -top-3 -right-2 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <div className="absolute -bottom-2 -left-3 w-1.5 h-1.5 rounded-full bg-yellow-400" />
          <div className="absolute top-1/2 -right-4 w-1.5 h-1.5 rounded-full bg-emerald-300" />
          <div className="absolute -top-1 -left-4 w-2 h-2 rounded-full bg-yellow-300" />

          <div className="w-24 h-24 rounded-full bg-[#10B981] flex items-center justify-center shadow-[0_0_35px_rgba(16,185,129,0.4)]">
            <Check size={48} className="text-white stroke-[3.5]" />
          </div>
        </div>

        <h1 className="text-2xl font-extrabold text-white tracking-tight">
          {viaWhatsapp ? <>Pedido {activeOrder.label}<br />enviado!</> : <>Pagamento<br />confirmado!</>}
        </h1>

        <p className="text-xs text-zinc-400 mt-3.5 max-w-[240px] leading-relaxed">
          {viaWhatsapp
            ? 'Envie a mensagem que abriu no WhatsApp para a loja confirmar seu pedido.'
            : 'Seu pedido já foi para a cozinha. Acompanhe por aqui.'}
        </p>
      </div>

      {/* Actions */}
      <div className="space-y-3 shrink-0 pb-4">
        {viaWhatsapp && activeOrder.whatsapp_url && (
          <a
            href={activeOrder.whatsapp_url}
            target="_blank"
            rel="noreferrer"
            className="block w-full py-3.5 bg-[#00C259] hover:bg-[#00ab4e] active:scale-[0.98] transition-all rounded-2xl text-white font-bold text-sm text-center"
          >
            Abrir WhatsApp novamente
          </a>
        )}
        <button
          onClick={() => navigateTo('rastreamento')}
          className="w-full py-3.5 bg-[var(--brand)] hover:brightness-90 active:scale-[0.98] transition-all rounded-2xl text-white font-bold text-sm shadow-lg"
        >
          Acompanhar pedido
        </button>

        <button
          onClick={() => navigateTo('home')}
          className="w-full py-3.5 bg-[#18181C] hover:bg-[#202024] border border-[#26262C] rounded-2xl text-zinc-300 hover:text-white font-bold text-sm transition-colors"
        >
          Voltar para o início
        </button>
      </div>
    </div>
  );
}
