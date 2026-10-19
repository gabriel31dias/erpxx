import React, { useEffect } from 'react';
import { Check } from 'lucide-react';
import { useApp, brl } from '../context/AppContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { pub } from '../lib/api';

const FLOW = ['pending', 'preparing', 'delivering', 'delivered'];

export function Screen11Rastreamento() {
  const { activeOrder: order, refreshOrders, navigateTo } = useApp();

  // atualiza enquanto o pedido está em andamento
  useEffect(() => {
    if (!order || ['delivered', 'cancelled'].includes(order.status)) return;
    const t = setInterval(() => refreshOrders().catch(() => {}), 10000);
    return () => clearInterval(t);
  }, [order?.status]);

  useEffect(() => {
    if (!order) navigateTo('meus_pedidos', false);
  }, [order]);
  if (!order) return null;

  const cancelled = order.status === 'cancelled';
  const current = FLOW.indexOf(order.status);
  const steps = [
    'Pedido recebido',
    'Em preparação',
    order.delivery_type === 'pickup' ? 'Pronto para retirar' : 'Saiu para entrega',
    order.delivery_type === 'pickup' ? 'Retirado' : 'Entregue',
  ].map((title, i) => ({ title, state: i < current ? 'done' : i === current ? 'active' : 'pending' }));

  const badge = cancelled
    ? 'bg-red-500/15 text-red-400 border-red-500/30'
    : order.status === 'delivered'
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : 'bg-amber-500/15 text-amber-400 border-amber-500/30';

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col justify-between select-none">
      {/* Top Header */}
      <div className="shrink-0 pt-2">
        <ScreenHeader title="Acompanhando pedido" />
      </div>

      {/* Stepper & Details */}
      <div className="flex-1 overflow-y-auto px-6 py-3 space-y-6 scrollbar-none flex flex-col justify-between">
        <div>
          {/* Order Header */}
          <div className="flex items-center justify-between pb-3 border-b border-[#202026]">
            <div>
              <h2 className="text-base font-extrabold text-white tracking-tight">{order.label}</h2>
              <p className="text-[11px] text-zinc-400">{order.date} · {brl(order.total)}</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-[10px] font-bold border ${badge}`}>{order.statusLabel}</span>
          </div>

          {cancelled ? (
            <p className="pt-6 text-xs text-zinc-400">Este pedido foi cancelado. Fale com a loja se tiver dúvidas.</p>
          ) : (
            <div className="pt-5 space-y-5 relative">
              {steps.map((step, idx) => {
                const isDone = step.state === 'done';
                const isActive = step.state === 'active';
                const isPending = step.state === 'pending';

                return (
                  <div key={idx} className="flex items-start space-x-4 relative">
                    {idx < steps.length - 1 && (
                      <div className={`absolute left-[9px] top-[20px] bottom-[-20px] w-[2px] ${isDone ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
                    )}

                    <div className="relative z-10 shrink-0">
                      {isDone || isActive ? (
                        <div
                          className={`w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center ${
                            isActive ? 'ring-4 ring-emerald-500/25 shadow-[0_0_12px_rgba(16,185,129,0.5)]' : ''
                          }`}
                        >
                          <Check size={12} className="text-white stroke-[3.5]" />
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded-full border-2 border-zinc-600 bg-[#0E0E10]" />
                      )}
                    </div>

                    <div className="flex-1 -mt-0.5">
                      <h3 className={`text-xs font-semibold ${isPending ? 'text-zinc-500' : 'text-white'}`}>{step.title}</h3>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Itens */}
          <div className="mt-6 pt-4 border-t border-[#202026] space-y-1.5">
            {order.items.map((i, k) => (
              <div key={k} className="flex justify-between text-xs">
                <span className="text-zinc-300">
                  {i.quantity}x {i.name}
                  {i.additionals.length > 0 && <span className="text-zinc-500"> + {i.additionals.map((a) => a.name).join(', ')}</span>}
                </span>
                <span className="text-zinc-400">{brl(i.total)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Delivery Courier Scooter Graphic */}
        {!cancelled && (
          <div className="pb-8 pt-4 flex flex-col items-center text-center">
            <div className="w-40 h-28 mb-3 flex items-center justify-center">
              <img src={pub('assets/images/delivery_scooter.png')} alt="" className="w-full h-full object-contain" />
            </div>
            <p className="text-xs text-zinc-300 font-medium max-w-[220px] leading-relaxed">
              {order.status === 'delivered' ? 'Bom apetite!' : 'Seu pedido está sendo preparado com muito carinho!'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
