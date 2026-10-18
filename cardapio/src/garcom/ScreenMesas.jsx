import React from 'react';
import { LogOut } from 'lucide-react';
import { useApp, brl } from '../context/AppContext';
import { BottomNav } from '../components/BottomNav';
import { waiterApi } from '../lib/api';

/** salão: uma ficha por mesa, livre ou com a comanda aberta (total e pedidos), ao vivo */
export function ScreenMesas() {
  const { tables, live, setTable, navigateTo, waiter } = useApp();
  // mesa que saiu da configuração mas ainda tem conta aberta continua aparecendo
  const count = Math.max(tables.count, ...tables.orders.map((o) => o.table));
  const numbers = Array.from({ length: count }, (_, i) => i + 1);

  const open = (n) => {
    setTable(n);
    navigateTo('comanda');
  };

  const logout = async () => {
    await waiterApi.logout().catch(() => {});
    location.reload();
  };

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col select-none">
      <div className="shrink-0 px-5 pt-5 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white tracking-tight">Mesas</h1>
          <p className="text-[11px] text-zinc-400 mt-0.5 flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
            {live ? 'Ao vivo' : 'Reconectando…'} · {waiter.user.name}
          </p>
        </div>
        <button
          onClick={logout}
          aria-label="Sair"
          className="w-9 h-9 rounded-full bg-[#18181C] border border-[#26262C] flex items-center justify-center text-zinc-400 hover:text-white active:scale-95 transition"
        >
          <LogOut size={17} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 scrollbar-none">
        {count === 0 ? (
          <p className="py-16 text-center text-xs text-zinc-500">
            Nenhuma mesa configurada. No ERP, em <b className="text-zinc-300">Cardápio digital</b>, informe quantas mesas tem o salão.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {numbers.map((n) => {
              const orders = tables.orders.filter((o) => o.table === n);
              const busy = orders.length > 0;
              const total = orders.reduce((s, o) => s + o.totalCents, 0);
              const waiting = orders.some((o) => o.status === 'pending');
              return (
                <button
                  key={n}
                  onClick={() => open(n)}
                  // cor da loja vem em variável CSS: o "/15" do Tailwind não funciona nela
                  style={busy ? { background: 'color-mix(in srgb, var(--brand) 15%, transparent)' } : undefined}
                  className={`aspect-square rounded-2xl p-2.5 flex flex-col items-center justify-center text-center active:scale-95 transition-all border ${
                    busy ? 'border-[var(--brand)]' : 'bg-[#18181C] border-[#26262C] hover:border-zinc-600'
                  }`}
                >
                  <span className={`text-2xl font-black ${busy ? 'text-white' : 'text-zinc-300'}`}>{n}</span>
                  {busy ? (
                    <>
                      <span className="text-[11px] font-bold text-white mt-0.5">{brl(total / 100)}</span>
                      <span className={`text-[10px] mt-0.5 ${waiting ? 'text-amber-400 font-semibold' : 'text-zinc-400'}`}>
                        {waiting ? 'Aguardando cozinha' : `${orders.length} pedido${orders.length > 1 ? 's' : ''}`}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] text-zinc-500 mt-0.5">Livre</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
