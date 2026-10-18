import React, { useEffect } from 'react';
import { Clock, ChevronRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { BottomNav } from '../components/BottomNav';

export function Screen10MeusPedidos() {
  const { orders, refreshOrders, orderFilter, setOrderFilter, setActiveOrder, navigateTo } = useApp();

  useEffect(() => {
    refreshOrders().catch(() => {});
  }, []);

  const filteredOrders = orders.filter(order => {
    if (orderFilter === 'Em andamento') return order.statusCode === 'preparing';
    if (orderFilter === 'Entregues') return order.statusCode === 'delivered';
    return true;
  });

  const handleOrderClick = (order) => {
    setActiveOrder(order);
    navigateTo(order.payment_method === 'pix' && order.payment_status === 'pending' ? 'pix' : 'rastreamento');
  };

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col justify-between select-none">
      {/* Top Header */}
      <div className="shrink-0 pt-2">
        <ScreenHeader title="Meus pedidos" onBack={() => navigateTo('home')} />

        {/* Filter Tabs */}
        <div className="px-5 py-2 flex items-center space-x-2">
          {['Todos', 'Em andamento', 'Entregues'].map(tab => {
            const isActive = orderFilter === tab;
            return (
              <button
                key={tab}
                onClick={() => setOrderFilter(tab)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'bg-[#18181C] text-zinc-400 border border-[#26262C] hover:text-white'
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {/* Orders List */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 scrollbar-none">
        {filteredOrders.length === 0 && (
          <p className="py-16 text-center text-xs text-zinc-500">Nenhum pedido por aqui ainda.</p>
        )}
        {filteredOrders.map(order => {
          const isPreparing = order.statusCode === 'preparing';
          const isDelivered = order.statusCode === 'delivered';

          return (
            <div
              key={order.id}
              onClick={() => handleOrderClick(order)}
              className="bg-[#18181C] border border-[#26262C] hover:border-zinc-700 rounded-2xl p-3.5 flex items-center justify-between cursor-pointer group transition-all"
            >
              <div className="flex items-center space-x-3.5">
                <div className="w-10 h-10 rounded-full bg-zinc-900 border border-[#26262C] flex items-center justify-center text-zinc-400 shrink-0">
                  <Clock size={18} />
                </div>

                <div>
                  <span className="text-xs font-bold text-white block">
                    {order.label}
                  </span>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    {order.date}
                  </p>
                  <span className="text-xs font-bold text-white block mt-1">
                    R$ {order.total.toFixed(2).replace('.', ',')}
                  </span>
                </div>
              </div>

              {/* Status Badge */}
              <div className="flex items-center space-x-2">
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                  isPreparing
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    : isDelivered
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : 'bg-red-500/15 text-red-400 border border-red-500/30'
                }`}>
                  {order.statusLabel}
                </span>
                <ChevronRight size={16} className="text-zinc-500 group-hover:text-zinc-300" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Nav */}
      <BottomNav activeTabOverride="comanda" />
    </div>
  );
}
