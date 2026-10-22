import React, { useEffect, useState } from 'react';
import { CheckCircle2, Navigation, Phone, RefreshCw, Undo2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BottomNav } from '../components/BottomNav';
import { DeliveryMap } from '../components/DeliveryMap';
import { Sheet, backBtn, inputCls } from '../components/Sheet';
import { courierApi } from '../lib/api';
import { charge, money } from './util';

/** "12,50" ou "12.50" → centavos */
const toCents = (v) => Math.round(Number(String(v).trim().replace(/\./g, '').replace(',', '.')) * 100) || 0;

/** abre o GPS do celular (Google Maps / Waze escolhem pelo link) no ponto ou no endereço */
const navUrl = (o) => `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${
  o.lat != null ? `${o.lat},${o.lng}` : encodeURIComponent(o.address)}`;

/** minhas entregas: mapa com a rota na melhor ordem, lista das paradas e "Entregue" */
export function ScreenRota() {
  const { deliveries, position, payMethods, finishDelivery, releaseDelivery, notify, navigateTo } = useApp();
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sheet, setSheet] = useState(null); // pedido sendo marcado como entregue

  const ids = deliveries.mine.map((o) => o.id).sort().join(',');
  const load = async () => {
    if (!ids) return setRoute(null);
    setLoading(true);
    try {
      setRoute(await courierApi.route(position));
    } catch (e) {
      notify(e.message);
    } finally {
      setLoading(false);
    }
  };
  // recalcula quando entra ou sai entrega (não a cada passo)
  useEffect(() => {
    load();
  }, [ids]);

  const byId = new Map(deliveries.mine.map((o) => [o.id, o]));
  const ordered = [
    ...(route?.order || []).map((id) => byId.get(id)).filter(Boolean),
    ...deliveries.mine.filter((o) => !route?.order?.includes(o.id)), // sem ponto no mapa: no fim da lista
  ];
  const stops = ordered.filter((o) => o.lat != null);

  const release = async (o) => {
    try {
      await releaseDelivery(o.id);
      notify(`Pedido #${o.number} voltou para a fila`);
    } catch (e) {
      notify(e.message);
    }
  };

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col select-none">
      <div className="relative shrink-0">
        <DeliveryMap store={deliveries.store} me={position} stops={stops} path={route?.path} className="h-[42vh]" />
        <button
          onClick={load}
          aria-label="Recalcular rota"
          className="absolute top-4 right-4 z-[500] w-10 h-10 rounded-full bg-[#18181C]/90 border border-[#26262C] flex items-center justify-center text-white active:scale-95"
        >
          <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
        </button>
        {route?.meters > 0 && (
          <span className="absolute bottom-3 left-3 z-[500] px-3 py-1.5 rounded-full bg-[#18181C]/90 text-[11px] font-bold text-white">
            {(route.meters / 1000).toFixed(1).replace('.', ',')} km
            {route.seconds ? ` · ~${Math.round(route.seconds / 60)} min` : ''}
            {route.source === 'line' ? ' · em linha reta' : ''}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 scrollbar-none">
        {ordered.length === 0 && (
          <div className="py-12 text-center text-zinc-500 space-y-3">
            <p className="text-sm font-medium">Nenhuma entrega com você</p>
            <button onClick={() => navigateTo('entregas')} className="px-5 py-2.5 bg-[var(--brand)] text-white text-xs font-bold rounded-xl active:scale-95">
              Ver disponíveis
            </button>
          </div>
        )}

        {ordered.map((o) => {
          const n = stops.indexOf(o) + 1;
          const c = charge(o);
          return (
            <div key={o.id} className="bg-[#18181C] border border-[#26262C] rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-7 h-7 rounded-full bg-[var(--brand)] text-white text-xs font-black flex items-center justify-center">
                  {n || '?'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-white">#{o.number} · {o.customerName}</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">{o.address}</p>
                  {o.lat == null && <p className="text-[10px] text-amber-400 font-semibold mt-1">Endereço sem ponto no mapa: use o GPS pelo endereço</p>}
                  {o.notes && <p className="text-[11px] text-zinc-500 mt-1">{o.notes}</p>}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${c.paid ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/15' : 'text-amber-400 border-amber-500/30 bg-amber-500/15'}`}>
                  {c.label}
                </span>
                <button onClick={() => release(o)} className="text-[11px] font-semibold text-zinc-500 flex items-center gap-1 active:scale-95">
                  <Undo2 size={12} /> Devolver
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <a href={`tel:${o.customerPhone.replace(/\D/g, '')}`} className="py-2.5 rounded-xl bg-[#0E0E10] border border-[#26262C] text-xs font-bold text-white flex items-center justify-center gap-1.5">
                  <Phone size={14} /> Ligar
                </a>
                <a href={navUrl(o)} target="_blank" rel="noreferrer" className="py-2.5 rounded-xl bg-[#0E0E10] border border-[#26262C] text-xs font-bold text-white flex items-center justify-center gap-1.5">
                  <Navigation size={14} /> GPS
                </a>
                <button onClick={() => setSheet(o)} className="py-2.5 rounded-xl bg-[var(--brand)] text-xs font-bold text-white flex items-center justify-center gap-1.5 active:scale-95">
                  <CheckCircle2 size={14} /> Entregue
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {sheet && (
        <DeliveredSheet
          order={sheet}
          methods={payMethods}
          onCancel={() => setSheet(null)}
          onDone={async (body) => {
            await finishDelivery(sheet.id, body);
            notify(`Pedido #${sheet.number} entregue`);
            setSheet(null);
          }}
        />
      )}

      <BottomNav />
    </div>
  );
}

/** como o cliente pagou (Pix do cardápio já está pago); dinheiro pede o valor recebido para o troco */
function DeliveredSheet({ order, methods, onCancel, onDone }) {
  const paid = order.paymentMethod === 'pix';
  const [method, setMethod] = useState('');
  const [received, setReceived] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cash = methods.find((m) => m.id === method)?.type === 'dinheiro';
  const change = cash && received ? toCents(received) - order.totalCents : 0;

  const submit = async () => {
    if (!paid && !method) return setError('Escolha como o cliente pagou.');
    setBusy(true);
    setError('');
    try {
      await onDone(paid ? {} : { paymentMethodId: method, ...(cash && received ? { receivedCents: toCents(received) } : {}) });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Sheet label={`Entregar pedido #${order.number}`} onCancel={onCancel}>
      <div>
        <h2 className="text-base font-black text-white">Pedido #{order.number} entregue</h2>
        <p className="text-xs text-zinc-400 mt-0.5">{paid ? 'Pago no Pix pelo cardápio: nada a cobrar.' : `Total a cobrar: ${money(order.totalCents)}`}</p>
      </div>
      {!paid && (
        <div className="grid grid-cols-2 gap-2">
          {methods.map((m) => (
            <button
              key={m.id}
              onClick={() => setMethod(m.id)}
              className={`py-3 rounded-xl text-xs font-bold border transition ${method === m.id ? 'bg-[var(--brand)] border-[var(--brand)] text-white' : 'bg-[#0E0E10] border-[#26262C] text-zinc-300'}`}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
      {cash && (
        <label className="block space-y-1.5">
          <span className="text-[11px] font-semibold text-zinc-400">Recebeu quanto? (opcional, para o troco)</span>
          <input inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} placeholder="50,00" className={inputCls} />
          {change > 0 && <span className="text-xs font-bold text-emerald-400">Troco: {money(change)}</span>}
        </label>
      )}
      {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onCancel} className={backBtn}>Voltar</button>
        <button onClick={submit} disabled={busy} className="flex-1 py-3 rounded-2xl text-sm font-bold text-white bg-[var(--brand)] disabled:opacity-50">
          {busy ? 'Salvando…' : 'Confirmar'}
        </button>
      </div>
    </Sheet>
  );
}
