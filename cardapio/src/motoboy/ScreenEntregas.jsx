import React, { useState } from 'react';
import { LogOut, MapPin, Package } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BottomNav } from '../components/BottomNav';
import { waiterApi } from '../lib/api';
import { charge, distance, minutesAgo, money } from './util';

/** pedidos prontos esperando motoboy, ao vivo; quem tocar primeiro em Aceitar leva */
export function ScreenEntregas() {
  const { deliveries, courierLive, courier, position, gpsError, acceptDelivery, notify, navigateTo } = useApp();
  const [busy, setBusy] = useState(null);

  const accept = async (o) => {
    setBusy(o.id);
    try {
      await acceptDelivery(o.id);
      notify(`Pedido #${o.number} é seu`);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(null);
    }
  };

  const logout = async () => {
    await waiterApi.logout().catch(() => {});
    location.reload();
  };

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col select-none">
      <div className="shrink-0 px-5 pt-5 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white tracking-tight">Entregas</h1>
          <p className="text-[11px] text-zinc-400 mt-0.5 flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${courierLive ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
            {courierLive ? 'Ao vivo' : 'Reconectando…'} · {courier.user.name}
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

      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-3 scrollbar-none">
        {gpsError && (
          <p role="alert" className="px-4 py-3 rounded-2xl bg-amber-400 text-zinc-900 text-xs font-bold">{gpsError}</p>
        )}
        {deliveries.mine.length > 0 && (
          <button
            onClick={() => navigateTo('rota')}
            className="w-full px-4 py-3 rounded-2xl border border-[var(--brand)] text-left text-xs font-bold text-white active:scale-[0.98] transition"
            style={{ background: 'color-mix(in srgb, var(--brand) 15%, transparent)' }}
          >
            Você está com {deliveries.mine.length} entrega{deliveries.mine.length > 1 ? 's' : ''}. Ver rota →
          </button>
        )}

        {deliveries.available.length === 0 ? (
          <div className="py-20 text-center text-zinc-500 space-y-3">
            <Package size={32} className="mx-auto" />
            <p className="text-sm font-medium">Nenhuma entrega pronta agora</p>
            <p className="text-[11px]">Quando a cozinha marcar um pedido como pronto, ele aparece aqui na hora.</p>
          </div>
        ) : (
          deliveries.available.map((o) => {
            const c = charge(o);
            const km = distance(position, o);
            const ago = minutesAgo(o.readyAt);
            const qty = o.items.reduce((s, i) => s + i.quantity, 0);
            return (
              <div key={o.id} className="bg-[#18181C] border border-[#26262C] rounded-2xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-white">#{o.number} · {o.customerName}</p>
                    <p className="text-[11px] text-zinc-400 mt-1 flex items-start gap-1">
                      <MapPin size={12} className="shrink-0 mt-0.5" />
                      <span className="line-clamp-2">{o.address}</span>
                    </p>
                  </div>
                  {km && <span className="shrink-0 text-xs font-bold text-white">{km}</span>}
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className={`px-2.5 py-1 rounded-full font-bold border ${c.paid ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/15' : 'text-amber-400 border-amber-500/30 bg-amber-500/15'}`}>
                    {c.label}
                  </span>
                  <span className="text-zinc-500">
                    {qty} {qty === 1 ? 'item' : 'itens'}{ago != null ? ` · pronto há ${ago} min` : ''}
                  </span>
                </div>
                <button
                  onClick={() => accept(o)}
                  disabled={!!busy}
                  className="w-full py-3 rounded-2xl bg-[var(--brand)] text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50"
                >
                  {busy === o.id ? 'Aceitando…' : `Aceitar · taxa ${money(o.deliveryFeeCents)}`}
                </button>
              </div>
            );
          })
        )}
      </div>

      <BottomNav />
    </div>
  );
}
