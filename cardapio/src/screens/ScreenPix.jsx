import React, { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useApp, brl } from '../context/AppContext';
import { ScreenHeader } from '../components/ScreenHeader';

export function ScreenPix() {
  const { activeOrder, refreshOrders, navigateTo } = useApp();
  const [copied, setCopied] = useState(false);
  const status = activeOrder?.payment_status;

  // consulta até o Mercado Pago confirmar
  useEffect(() => {
    if (status !== 'pending') return;
    const t = setInterval(() => refreshOrders().catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (status === 'approved') navigateTo('pedido_realizado');
  }, [status]);

  if (!activeOrder) return null;
  const pix = activeOrder.pix;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pix.qr_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* sem clipboard: o código continua visível pra copiar na mão */
    }
  };

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col select-none">
      <div className="shrink-0 pt-2">
        <ScreenHeader title={`Pedido ${activeOrder.label}`} onBack={() => navigateTo('meus_pedidos')} />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col items-center text-center space-y-4 scrollbar-none">
        {status === 'rejected' ? (
          <>
            <h1 className="text-lg font-extrabold text-white">Pagamento não aprovado</h1>
            <p className="text-xs text-zinc-400 max-w-[260px]">O Pix expirou ou foi recusado. Faça o pedido novamente.</p>
            <button onClick={() => navigateTo('home')} className="px-5 py-3 bg-[var(--brand)] rounded-2xl text-white text-sm font-bold">
              Voltar ao cardápio
            </button>
          </>
        ) : (
          <>
            <div>
              <p className="text-xs text-zinc-400">Total a pagar</p>
              <p className="text-2xl font-black text-white">{brl(activeOrder.total)}</p>
            </div>

            {pix?.qr_code_base64 && (
              <div className="bg-white p-3 rounded-2xl">
                <img src={`data:image/png;base64,${pix.qr_code_base64}`} alt="QR Code Pix" className="w-56 h-56" />
              </div>
            )}

            <p className="text-xs text-zinc-300 max-w-[280px] leading-relaxed">
              Abra o app do seu banco, escolha <b>Pix → Ler QR Code</b> ou use o <b>Pix copia e cola</b>.
            </p>

            {pix?.qr_code && (
              <div className="w-full space-y-2">
                <p className="w-full break-all rounded-2xl bg-[#18181C] border border-[#26262C] p-3 text-[10px] text-zinc-400 text-left select-all">
                  {pix.qr_code}
                </p>
                <button
                  onClick={copy}
                  className="w-full py-3.5 bg-[var(--brand)] hover:brightness-90 active:scale-[0.98] transition-all rounded-2xl text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2"
                >
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                  {copied ? 'Código copiado!' : 'Copiar código Pix'}
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-zinc-400 pt-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Aguardando pagamento... a confirmação é automática
            </div>
          </>
        )}
      </div>
    </div>
  );
}
