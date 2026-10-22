import React from 'react';
import { BellRing, RefreshCw, Receipt } from 'lucide-react';
import { useApp, brl } from '../context/AppContext';
import { BottomNav } from '../components/BottomNav';

const STATUS = {
  pending: { label: 'Recebido', cls: 'bg-amber-100 text-amber-700' },
  preparing: { label: 'Em preparo', cls: 'bg-sky-100 text-sky-700' },
  ready: { label: 'Pronto', cls: 'bg-teal-100 text-teal-700' },
  delivering: { label: 'Em preparo', cls: 'bg-sky-100 text-sky-700' },
  delivered: { label: 'Servido', cls: 'bg-emerald-100 text-emerald-700' },
};

const hour = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** cliente na mesa (QR): o que a mesa já pediu, chamar o garçom e pedir a conta (fecha com o garçom/caixa) */
export function ScreenMinhaMesa() {
  const { table, tab, refreshTab, navigateTo, callStaff, notify } = useApp();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [calling, setCalling] = React.useState(null); // kind sendo enviado

  const call = async (kind) => {
    setCalling(kind);
    try {
      await callStaff(kind);
    } catch (e) {
      notify(e.message);
    } finally {
      setCalling(null);
    }
  };
  // chamado aberto: o botão mostra que já foi (tocar de novo avisa outra vez)
  const open = (kind) => (tab.calls || []).find((c) => c.kind === kind);

  const load = React.useCallback(() => {
    setLoading(true);
    return refreshTab()
      .then(() => setError(''))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // a cozinha muda o status: atualiza sozinho enquanto a tela está aberta
  React.useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="relative w-full h-full min-h-screen bg-white text-slate-900 overflow-hidden flex flex-col justify-between select-none">
      <div className="px-4 pt-4 pb-3 flex items-center justify-between border-b border-slate-100 bg-white z-10">
        <h1 className="text-lg font-black text-slate-900 tracking-tight">Mesa {table}</h1>
        <button
          onClick={load}
          aria-label="Atualizar"
          className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 hover:bg-slate-200 active:scale-95 transition"
        >
          <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-none">
        {error && <p className="text-center text-xs font-semibold text-red-500 py-2">{error}</p>}
        {!error && !loading && tab.orders.length === 0 && (
          <div className="py-20 text-center text-slate-400 space-y-3">
            <Receipt size={32} className="mx-auto" />
            <p className="text-sm font-medium">Nenhum pedido nesta mesa ainda</p>
            <button
              onClick={() => navigateTo('categoria')}
              className="px-5 py-2.5 bg-[var(--brand)] text-white text-xs font-bold rounded-xl shadow-md active:scale-95"
            >
              Ver cardápio
            </button>
          </div>
        )}

        {tab.orders.map((o) => {
          const st = STATUS[o.status] || STATUS.pending;
          return (
            <div key={o.id} className="border border-slate-100 rounded-2xl p-3 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-black">Pedido #{o.number}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
              </div>
              {o.items.map((i, idx) => (
                <div key={idx} className="flex justify-between text-xs text-slate-600 py-0.5">
                  <span className="truncate pr-2">{i.quantity}× {i.name}</span>
                  <span className="font-semibold text-slate-900 shrink-0">{brl(i.total)}</span>
                </div>
              ))}
            </div>
          );
        })}

        {tab.orders.length > 0 && (
          <div className="pt-3 border-t border-slate-100 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-base font-black">Total da mesa</span>
              <span className="text-base font-black">{brl(tab.total)}</span>
            </div>
            <p className="text-[11px] text-slate-500">A conta é fechada com o garçom ou no caixa.</p>
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pt-3 pb-2 border-t border-slate-100 bg-white grid grid-cols-2 gap-2">
        <CallButton icon={BellRing} label="Chamar garçom" kind="waiter" open={open('waiter')} busy={calling} onClick={call} />
        <CallButton icon={Receipt} label="Pedir a conta" kind="bill" open={open('bill')} busy={calling} onClick={call}
          disabled={!tab.orders.length} />
      </div>

      <BottomNav />
    </div>
  );
}

function CallButton({ icon: Icon, label, kind, open, busy, disabled, onClick }) {
  return (
    <button
      onClick={() => onClick(kind)}
      disabled={disabled || !!busy}
      className={`py-3 rounded-2xl text-xs font-bold flex flex-col items-center justify-center gap-1 active:scale-95 transition disabled:opacity-40 ${
        open ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-[var(--brand)] text-white shadow-md'
      }`}
    >
      <span className="flex items-center gap-1.5">
        <Icon size={16} className={busy === kind ? 'animate-pulse' : ''} />
        {busy === kind ? 'Enviando…' : label}
      </span>
      {open && <span className="text-[10px] font-semibold">Chamado às {hour(open.created_at)} · aguarde</span>}
    </button>
  );
}
