import React, { useState } from 'react';
import { ArrowLeftRight, Plus, Receipt, X } from 'lucide-react';
import { useApp, brl } from '../context/AppContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { BottomNav } from '../components/BottomNav';
import { waiterApi } from '../lib/api';

const STATUS = {
  pending: { label: 'Novo', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  preparing: { label: 'Preparando', cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  delivering: { label: 'Preparando', cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  delivered: { label: 'Servido', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
};
const MOTIVOS = ['Cliente desistiu', 'Lançado errado', 'Sem o produto', 'Demora'];

const money = (cents) => brl(cents / 100);
const hour = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
/** "1.250,50", "12,50" ou "12.50" → centavos (com vírgula, o ponto é de milhar) */
const toCents = (v) => {
  const s = String(v).trim();
  return Math.round(Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) * 100) || 0;
};
const toInput = (cents) => (cents / 100).toFixed(2).replace('.', ',');

/** folha que sobe do rodapé: a mesma moldura para motivo, transferência e fechamento */
function Sheet({ label, onCancel, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={onCancel}>
      <div
        role="dialog"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] max-h-[90vh] overflow-y-auto bg-[#18181C] rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4 anim-sheet-in"
      >
        {children}
      </div>
    </div>
  );
}

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl bg-[#0E0E10] border border-[#26262C] text-sm text-white outline-none focus:border-[var(--brand)]';
const backBtn = 'flex-1 py-3 rounded-2xl text-sm font-bold text-zinc-300 bg-[#0E0E10] border border-[#26262C]';

/** comanda da mesa: pedidos ainda sem venda, cancelar, transferir e fechar a conta */
export function ScreenComanda() {
  const { table, comanda, navigateTo, canCloseTable, cancelOrder, cancelItem, notify } = useApp();
  const [sheet, setSheet] = useState(null); // { type: 'reason' | 'transfer' | 'close', ... }
  const total = comanda.reduce((s, o) => s + o.totalCents, 0);
  // garçom cancela só o que a cozinha ainda não aceitou; o servidor confere de novo
  const canCancel = (o) => canCloseTable || o.status === 'pending';

  if (!table) {
    return (
      <div className="relative w-full h-full min-h-screen bg-[#0E0E10] flex flex-col">
        <ScreenHeader title="Comanda" onBack={() => navigateTo('mesas')} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-sm text-zinc-400">Escolha uma mesa para ver a comanda.</p>
          <button onClick={() => navigateTo('mesas')} className="px-5 py-2.5 bg-[var(--brand)] text-white text-xs font-bold rounded-xl active:scale-95">
            Ver mesas
          </button>
        </div>
        <BottomNav />
      </div>
    );
  }

  const askCancel = (title, run) => setSheet({ type: 'reason', title, run });

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col select-none">
      <div className="shrink-0 pt-2">
        <ScreenHeader
          title={`Mesa ${table}`}
          onBack={() => navigateTo('mesas')}
          rightElement={comanda.length > 0 && (
            <button
              onClick={() => setSheet({ type: 'transfer' })}
              aria-label="Transferir mesa"
              className="w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-zinc-800/80 active:scale-90"
            >
              <ArrowLeftRight size={18} />
            </button>
          )}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 scrollbar-none">
        {comanda.length === 0 && (
          <p className="py-12 text-center text-xs text-zinc-500">Mesa livre. Lance o primeiro pedido.</p>
        )}

        {comanda.map((o) => {
          const st = STATUS[o.status] || STATUS.pending;
          return (
            <div key={o.id} className="bg-[#18181C] border border-[#26262C] rounded-2xl p-3.5">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-xs font-bold text-white">#{o.number}</span>
                  <span className="text-[11px] text-zinc-500 ml-2">{hour(o.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${st.cls}`}>{st.label}</span>
                  {canCancel(o) && (
                    <button
                      onClick={() => askCancel(`Cancelar pedido #${o.number}`, (reason) => cancelOrder(o.id, reason))}
                      className="px-2.5 py-1 rounded-full text-[10px] font-semibold text-red-400 border border-red-500/30 active:scale-95"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
              <ul className="space-y-1.5">
                {o.items.map((i, k) => (
                  <li key={k} className="flex justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <span className="text-zinc-200">{i.quantity}x {i.name}</span>
                      {i.additionals.length > 0 && (
                        <p className="text-[10px] text-zinc-500 truncate">+ {i.additionals.map((a) => a.name).join(', ')}</p>
                      )}
                    </div>
                    <div className="flex items-start gap-2 shrink-0">
                      <span className="text-zinc-300 font-semibold">{money(i.totalCents)}</span>
                      {canCancel(o) && (
                        <button
                          aria-label={`Tirar ${i.name}`}
                          onClick={() => askCancel(`Tirar ${i.quantity}x ${i.name}`, (reason) => cancelItem(o.id, k, reason))}
                          className="text-zinc-500 hover:text-red-400 active:scale-90"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {o.notes && <p className="mt-2 text-[11px] text-zinc-400 border-t border-[#26262C] pt-2">{o.notes}</p>}
            </div>
          );
        })}

        {comanda.length > 0 && (
          <div className="flex items-center justify-between pt-2 px-1">
            <span className="text-sm font-bold text-zinc-300">Consumo da mesa</span>
            <span className="text-lg font-black text-white">{money(total)}</span>
          </div>
        )}

        <div className="pt-2 space-y-2">
          <button
            onClick={() => navigateTo('categoria')}
            className="w-full py-3.5 bg-[var(--brand)] hover:brightness-90 active:scale-[0.98] transition-all rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-2"
          >
            <Plus size={18} className="stroke-[2.5]" />
            Adicionar itens
          </button>
          {canCloseTable && comanda.length > 0 && (
            <button
              onClick={() => setSheet({ type: 'close' })}
              className="w-full py-3 bg-[#18181C] border border-[#26262C] hover:border-zinc-600 active:scale-[0.98] transition-all rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-2"
            >
              <Receipt size={17} />
              Fechar conta
            </button>
          )}
        </div>
      </div>

      <BottomNav />
      {sheet?.type === 'reason' && (
        <ReasonSheet
          title={sheet.title}
          onCancel={() => setSheet(null)}
          onConfirm={async (reason) => {
            await sheet.run(reason);
            notify(`Cancelado: ${sheet.title.replace(/^(Cancelar|Tirar) /, '')}`);
            setSheet(null);
          }}
        />
      )}
      {sheet?.type === 'transfer' && <TransferSheet onCancel={() => setSheet(null)} />}
      {sheet?.type === 'close' && <CloseSheet consumo={total} onCancel={() => setSheet(null)} />}
    </div>
  );
}

/** motivo obrigatório para cancelar pedido ou item */
function ReasonSheet({ title, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <Sheet label={title} onCancel={onCancel}>
      <h2 className="text-base font-black text-white">{title}</h2>
      <div className="flex flex-wrap gap-2">
        {MOTIVOS.map((m) => (
          <button
            key={m}
            onClick={() => setReason(m)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${reason === m ? 'bg-white text-zinc-900 border-white' : 'text-zinc-300 border-[#26262C]'}`}
          >
            {m}
          </button>
        ))}
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Motivo" aria-label="Motivo" className={inputCls} />
      {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onCancel} className={backBtn}>Voltar</button>
        <button
          disabled={busy || reason.trim().length < 3}
          onClick={confirm}
          className="flex-[2] py-3 rounded-2xl text-sm font-bold text-white bg-red-500 hover:bg-red-600 active:scale-[0.98] transition disabled:opacity-50"
        >
          {busy ? 'Cancelando…' : 'Confirmar'}
        </button>
      </div>
    </Sheet>
  );
}

/** escolhe a mesa de destino; ocupada junta as contas */
function TransferSheet({ onCancel }) {
  const { table, tables, transferTable, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const numbers = Array.from({ length: tables.count }, (_, i) => i + 1).filter((n) => n !== table);
  const totalOf = (n) => tables.orders.filter((o) => o.table === n).reduce((s, o) => s + o.totalCents, 0);

  const go = async (to) => {
    setBusy(true);
    setError('');
    try {
      await transferTable(to);
      notify(`Mesa ${table} transferida para a mesa ${to}`);
      onCancel();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Sheet label={`Transferir mesa ${table}`} onCancel={onCancel}>
      <div>
        <h2 className="text-base font-black text-white">Transferir mesa {table}</h2>
        <p className="text-xs text-zinc-400 mt-1">Toque na mesa de destino. Se ela estiver ocupada, as contas são juntadas.</p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {numbers.map((n) => {
          const busyTable = totalOf(n) > 0;
          return (
            <button
              key={n}
              disabled={busy}
              onClick={() => go(n)}
              className={`py-3 rounded-xl border text-center active:scale-95 disabled:opacity-50 ${busyTable ? 'border-[var(--brand)] text-white' : 'border-[#26262C] text-zinc-300'}`}
            >
              <span className="block text-lg font-black">{n}</span>
              <span className="block text-[9px] text-zinc-400">{busyTable ? money(totalOf(n)) : 'Livre'}</span>
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
      <button onClick={onCancel} className={`w-full ${backBtn}`}>Voltar</button>
    </Sheet>
  );
}

/** taxa de serviço opcional e conta dividida → uma venda com todos os pedidos da mesa */
function CloseSheet({ consumo, onCancel }) {
  const { table, tables, closeTable, notify, navigateTo } = useApp();
  const pct = tables.serviceFeePercent || 0;
  const [methods, setMethods] = useState(null);
  const [fee, setFee] = useState(pct > 0);
  const [lines, setLines] = useState([]); // [{ methodId, value, received }]
  const [people, setPeople] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const service = fee ? Math.round((consumo * pct) / 100) : 0;
  const total = consumo + service;

  React.useEffect(() => {
    waiterApi
      .paymentMethods()
      .then((r) => {
        // crediário pede cliente cadastrado; pedido de mesa não tem
        const list = r.rows.filter((m) => m.active && m.type !== 'crediario');
        setMethods(list);
        setLines([{ methodId: list[0]?.id || '', value: toInput(total), received: '' }]);
      })
      .catch((e) => setError(e.message));
  }, []);

  // um pagamento só acompanha o total (taxa ligada/desligada)
  React.useEffect(() => {
    setLines((ls) => (ls.length === 1 ? [{ ...ls[0], value: toInput(total) }] : ls));
  }, [total]);

  const isCash = (id) => methods?.find((m) => m.id === id)?.requiresChange;
  const paid = lines.reduce((s, l) => s + toCents(l.value), 0);
  const diff = total - paid;
  const set = (i, patch) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  /** n partes iguais; os centavos que sobram vão na primeira */
  const split = (n) => {
    const first = methods[0]?.id || '';
    setLines(Array.from({ length: n }, (_, i) => ({ methodId: first, value: toInput(Math.floor(total / n) + (i === 0 ? total % n : 0)), received: '' })));
  };

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await closeTable({
        serviceFee: fee,
        payments: lines.map((l) => ({
          paymentMethodId: l.methodId,
          amountCents: toCents(l.value),
          ...(isCash(l.methodId) && l.received ? { receivedCents: toCents(l.received) } : {}),
        })),
      });
      notify(`Conta da mesa ${table} fechada`);
      navigateTo('mesas');
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const change = lines.reduce((s, l) => (isCash(l.methodId) && l.received ? s + Math.max(toCents(l.received) - toCents(l.value), 0) : s), 0);

  return (
    <Sheet label={`Fechar conta da mesa ${table}`} onCancel={onCancel}>
      <h2 className="text-base font-black text-white">Fechar mesa {table}</h2>

      <div className="space-y-1 text-sm">
        <div className="flex justify-between text-zinc-400"><span>Consumo</span><span>{money(consumo)}</span></div>
        {pct > 0 && (
          <label className="flex justify-between items-center text-zinc-400">
            <span className="flex items-center gap-2">
              <input type="checkbox" checked={fee} onChange={(e) => setFee(e.target.checked)} className="accent-[var(--brand)] w-4 h-4" />
              Taxa de serviço ({pct}%)
            </span>
            <span>{money(service)}</span>
          </label>
        )}
        <div className="flex justify-between text-lg font-black text-white pt-1"><span>Total</span><span>{money(total)}</span></div>
      </div>

      {!methods && !error && <p className="text-xs text-zinc-400">Carregando formas de pagamento…</p>}
      {methods && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-300 mr-auto">Pagamentos</span>
            <span className="text-[11px] text-zinc-400">Dividir por</span>
            <input
              type="number" min={2} max={20} value={people} onChange={(e) => setPeople(e.target.value)} aria-label="Pessoas"
              className="w-14 px-2 py-1.5 rounded-lg bg-[#0E0E10] border border-[#26262C] text-xs text-white text-center"
            />
            <button onClick={() => split(Math.min(20, Math.max(2, Number(people) || 2)))} className="px-3 py-1.5 rounded-lg text-xs font-bold text-white border border-[#26262C] active:scale-95">
              Dividir
            </button>
          </div>

          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2">
                <select
                  value={l.methodId} onChange={(e) => set(i, { methodId: e.target.value })} aria-label="Forma de pagamento"
                  className="flex-1 min-w-0 px-2 py-2.5 rounded-xl bg-[#0E0E10] border border-[#26262C] text-xs text-white"
                >
                  {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <input inputMode="decimal" value={l.value} onChange={(e) => set(i, { value: e.target.value })} aria-label="Valor" className={`${inputCls} !w-24 !px-2 text-right`} />
                {isCash(l.methodId) && (
                  <input inputMode="decimal" value={l.received} onChange={(e) => set(i, { received: e.target.value })} placeholder="Recebido" aria-label="Recebido em dinheiro" className={`${inputCls} !w-24 !px-2 text-right`} />
                )}
                {lines.length > 1 && (
                  <button aria-label="Tirar pagamento" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} className="text-zinc-500 hover:text-red-400 px-1">
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setLines((ls) => [...ls, { methodId: methods[0]?.id || '', value: toInput(Math.max(diff, 0)), received: '' }])}
              className="text-xs font-bold text-zinc-300 underline"
            >
              + Pagamento
            </button>
          </div>

          <p className={`text-xs font-bold ${diff === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {diff === 0 ? 'Pagamentos conferem com o total.' : diff > 0 ? `Falta ${money(diff)}` : `Passou ${money(-diff)} do total`}
            {change > 0 && <span className="text-emerald-400 ml-2">· Troco: {money(change)}</span>}
          </p>
        </>
      )}

      {error && <p className="text-xs font-semibold text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button onClick={onCancel} className={backBtn}>Voltar</button>
        <button
          disabled={busy || !methods || diff !== 0}
          onClick={confirm}
          className="flex-[2] py-3 rounded-2xl text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] transition disabled:opacity-50"
        >
          {busy ? 'Fechando…' : 'Confirmar pagamento'}
        </button>
      </div>
    </Sheet>
  );
}
