import { useEffect, useState } from 'react';
import { BASE, waiterApi } from '../lib/api';

/** chamado novo de mesa: vibra e dá um "plim" (o navegador só toca depois do primeiro toque na tela) */
let audio = null;
function ding() {
  navigator.vibrate?.([200, 100, 200]);
  try {
    audio ??= new AudioContext();
    const t0 = audio.currentTime;
    [880, 1320].forEach((f, i) => {
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      osc.frequency.value = f;
      vol.gain.setValueAtTime(0.2, t0 + i * 0.18);
      vol.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.18 + 0.35);
      osc.connect(vol).connect(audio.destination);
      osc.start(t0 + i * 0.18);
      osc.stop(t0 + i * 0.18 + 0.35);
    });
  } catch { /* sem áudio */ }
}

/**
 * Mesas e comandas do app do garçom. Chamado sempre pelo AppProvider (regra dos hooks);
 * no app do cliente (`waiter` vazio) não abre conexão nem busca nada.
 */
export function useTables(waiter, { cart, clearCart, toApiLine }) {
  const [table, setTable] = useState(null);
  const [tables, setTables] = useState({ count: 0, serviceFeePercent: 0, orders: [], calls: [] });
  const [live, setLive] = useState(false);

  const refreshTables = () =>
    waiterApi.tables().then((r) => setTables({ count: r.tables, serviceFeePercent: r.serviceFeePercent, orders: r.orders, calls: r.calls || [] }));

  useEffect(() => {
    if (!waiter) return;
    // tempo real: o mesmo canal da tela de pedidos do ERP; qualquer evento recarrega as comandas
    const events = new EventSource(`${BASE}/api/menu/events`, { withCredentials: true });
    // (re)conectou: recarrega o que mudou enquanto estava fora
    events.onopen = () => {
      setLive(true);
      refreshTables().catch(() => {});
    };
    events.onerror = () => setLive(false);
    events.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data);
        if (e.type === 'call' && e.status !== 'attended') ding();
      } catch { /* ping */ }
      refreshTables().catch(() => {});
    };
    return () => events.close();
  }, [waiter]);

  const sendToTable = async (notes) => {
    await waiterApi.order(table, { items: cart.map(toApiLine), notes: notes || undefined });
    clearCart();
    await refreshTables();
  };

  const closeTable = async (payment) => {
    const r = await waiterApi.close(table, payment);
    await refreshTables();
    return r;
  };

  /** ações na comanda: chamam a API e recarregam (o tempo real avisa os outros aparelhos) */
  const after = (p) => p.then(async (r) => {
    await refreshTables();
    return r;
  });
  const attendTable = (n = table) => after(waiterApi.attend(n));
  const cancelOrder = (id, reason) => after(waiterApi.cancel(id, reason));
  const cancelItem = (id, index, reason) => after(waiterApi.cancelItem(id, index, reason));
  const transferTable = async (to) => {
    const r = await after(waiterApi.transfer(table, { to }));
    setTable(to);
    return r;
  };

  return {
    table,
    attendTable,
    calls: tables.calls.filter((c) => c.table === table),
    cancelOrder,
    cancelItem,
    transferTable,
    setTable,
    tables,
    live,
    refreshTables,
    sendToTable,
    closeTable,
    comanda: tables.orders.filter((o) => o.table === table),
    canCloseTable: !!waiter?.permissions.includes('pedido.gerenciar'),
  };
}
