// Pedidos do cardápio digital: a cozinha/balcão avança o status; entregue vira venda.
// Tempo real por SSE (/api/menu/events): pedido novo aparece na hora, com bip.
import { get, patch, post } from '../api.js';
import { branchId, pageTitle } from '../shell.js';
import {
  askReason, card, centsToInput, field, fmtBRL, h, modal, moneyInput, moneyToCents, mount, paginator, refreshIcons, select,
  statusBadge, toast,
} from '../ui.js';

const STATUS = {
  pending: { label: 'Novo', kind: 'warning', next: 'preparing', action: 'Aceitar e preparar' },
  preparing: { label: 'Preparando', kind: 'info', next: 'delivering', action: 'Saiu para entrega' },
  delivering: { label: 'Saiu para entrega', kind: 'primary', next: 'delivered', action: 'Entregue' },
  delivered: { label: 'Entregue', kind: 'success' },
  cancelled: { label: 'Cancelado', kind: 'secondary' },
};
/** mesa: depois de pronto é servido, sem entrega; a venda sai ao fechar a conta */
const MESA = {
  ...STATUS,
  preparing: { ...STATUS.preparing, next: 'delivered', action: 'Servido' },
  delivered: { label: 'Servido', kind: 'success' },
};
const etapa = (o, status) => (o.table != null ? MESA : STATUS)[status];

const FILTROS = [
  ['pending,preparing,delivering', 'Em andamento'],
  ['pending', 'Novos'],
  ['delivered', 'Entregues'],
  ['cancelled', 'Cancelados'],
  ['', 'Todos'],
];

/** bip curto pelo próprio navegador, sem arquivo de áudio */
function bip() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch { /* navegador sem áudio liberado: fica só o aviso na tela */ }
}

export default async function render({ content, can }) {
  const gerencia = can('pedido.gerenciar');
  const formas = gerencia ? (await get('/company/payment-methods')).rows.filter((m) => m.active && m.type !== 'crediario') : [];
  let filtro = FILTROS[0][0];
  let page = 1;

  const abas = h('div', { class: 'btn-group flex-wrap', role: 'group', 'aria-label': 'Filtro de pedidos' });
  const aoVivo = h('span', { class: 'badge text-bg-secondary', role: 'status', 'aria-live': 'polite' }, 'Conectando…');
  const lista = h('div', {});
  const rodape = h('div', {});

  mount(content, pageTitle('Pedidos do cardápio',
    can('cardapio.gerenciar') ? h('a', { class: 'btn btn-outline-secondary', href: '/cardapio.html' }, 'Configurar cardápio') : null),
  card(null, h('div', {}, h('div', { class: 'mb-3 d-flex flex-wrap gap-2 align-items-center justify-content-between' }, abas, aoVivo), lista, rodape)));

  function desenharAbas() {
    abas.replaceChildren(...FILTROS.map(([v, label]) => h('button', {
      class: `btn btn-sm ${v === filtro ? 'btn-primary' : 'btn-outline-primary'}`,
      onclick: () => { filtro = v; page = 1; desenharAbas(); carregar(); },
    }, label)));
  }

  /** pedido por WhatsApp: pergunta como o cliente pagou na entrega */
  function entregar(o) {
    // pix já pago; mesa paga ao fechar a conta no app do garçom
    if (o.paymentMethod !== 'whatsapp') return mudar(o, 'delivered');
    const forma = select(formas.map((m, i) => ({ value: m.id, label: m.name, selected: i === 0 })));
    const recebido = moneyInput({ value: centsToInput(o.totalCents) });
    const campoRecebido = field('Valor recebido em dinheiro (para o troco)', recebido, { col: 'col-12' });
    const ehDinheiro = () => formas.find((m) => m.id === forma.value)?.requiresChange;
    const atualizar = () => campoRecebido.classList.toggle('d-none', !ehDinheiro());
    forma.onchange = atualizar;
    const ok = h('button', { class: 'btn btn-success' }, 'Confirmar entrega');
    const m = modal({
      title: `Entregar pedido #${o.number} · ${fmtBRL(o.totalCents)}`,
      body: h('div', { class: 'row g-3' },
        field('Como o cliente pagou?', forma, { col: 'col-12' }),
        campoRecebido,
        h('p', { class: 'col-12 txt-secondary f-12 mb-0' }, 'A entrega lança a venda no caixa aberto, baixa o estoque e registra no financeiro.')),
      footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar'), ok],
    });
    atualizar();
    ok.onclick = async () => {
      ok.disabled = true;
      const fechou = await mudar(o, 'delivered', {
        paymentMethodId: forma.value,
        ...(ehDinheiro() ? { receivedCents: moneyToCents(recebido.value) } : {}),
      });
      if (fechou) m.close(); else ok.disabled = false;
    };
  }

  async function mudar(o, status, extra = {}) {
    try {
      const r = await patch(`/menu/orders/${o.id}/status`, { status, branchId: branchId() || undefined, ...extra });
      toast(r.saleId ? `Pedido #${o.number} entregue e lançado como venda.` : `Pedido #${o.number}: ${etapa(o, status).label}.`);
      carregar();
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  }

  async function cancelar(o) {
    const reason = await askReason(`Cancelar pedido #${o.number}`, {
      quick: ['Cliente desistiu', 'Pedido errado', 'Sem o produto', 'Demora'], okLabel: 'Cancelar pedido',
    });
    if (!reason) return;
    try {
      const r = await post(`/menu/orders/${o.id}/cancel`, { reason });
      toast(r.refundPending
        ? `Pedido #${o.number} cancelado. Ele foi pago por Pix: faça o estorno no gateway.`
        : `Pedido #${o.number} cancelado.`, r.refundPending ? 'warning' : undefined);
      carregar();
    } catch (e) { toast(e.message, 'error'); }
  }

  function pedido(o) {
    const st = etapa(o, o.status);
    const mesa = o.table != null;
    const zap = o.customerPhone.replace(/\D/g, '');
    return h('div', { class: 'border rounded p-3 mb-3' },
      h('div', { class: 'd-flex flex-wrap justify-content-between gap-2 mb-2' },
        h('div', {},
          h('strong', { class: 'me-2' }, `#${o.number}`),
          statusBadge(st.label, st.kind), ' ',
          mesa ? statusBadge(`Mesa ${o.table}`, 'dark')
            : o.paymentMethod === 'pix' ? statusBadge('Pix pago', 'success') : statusBadge('Paga na entrega', 'light'),
          h('div', { class: 'f-12 txt-secondary mt-1' }, new Date(o.createdAt).toLocaleString('pt-BR').slice(0, 17))),
        h('div', { class: 'text-end' },
          h('div', { class: 'f-w-600' }, fmtBRL(o.totalCents)),
          o.deliveryFeeCents ? h('div', { class: 'f-12 txt-secondary' }, `inclui entrega ${fmtBRL(o.deliveryFeeCents)}`) : null)),
      mesa ? null : h('div', { class: 'mb-2' },
        h('span', { class: 'f-w-600' }, o.customerName), ' · ',
        h('a', { href: `https://wa.me/${zap.length <= 11 ? `55${zap}` : zap}`, target: '_blank', rel: 'noopener' }, o.customerPhone),
        h('div', { class: 'f-12' }, o.deliveryType === 'delivery' ? `Entrega: ${o.address}` : 'Retirar no local')),
      h('ul', { class: 'mb-2 ps-3' }, o.items.map((i) => h('li', {},
        `${i.quantity}x ${i.name} — ${fmtBRL(i.totalCents)}`,
        i.additionals.length ? h('div', { class: 'f-12 txt-secondary' }, i.additionals.map((a) => `+ ${a.name}`).join(' · ')) : null))),
      o.notes ? h('div', { class: 'alert alert-light py-2 px-3 mb-2 f-12' }, `Obs: ${o.notes}`) : null,
      o.cancelReason ? h('div', { class: 'alert alert-secondary py-2 px-3 mb-2 f-12' }, `Cancelado: ${o.cancelReason}`) : null,
      o.paymentStatus === 'refund_pending' ? h('div', { class: 'alert alert-warning py-2 px-3 mb-2 f-12' }, 'Pago por Pix: estorno pendente no gateway.') : null,
      h('div', { class: 'd-flex flex-wrap gap-2 justify-content-end' },
        o.saleId ? h('a', { class: 'btn btn-sm btn-outline-secondary', href: `/venda.html?id=${o.saleId}` }, 'Ver venda') : null,
        gerencia && st.next && !o.saleId
          ? h('button', { class: 'btn btn-sm btn-primary', onclick: () => (st.next === 'delivered' ? entregar(o) : mudar(o, st.next)) }, st.action)
          : null,
        gerencia && !['delivered', 'cancelled'].includes(o.status)
          ? h('button', { class: 'btn btn-sm btn-outline-danger', onclick: () => cancelar(o) }, 'Cancelar')
          : null));
  }

  async function carregar() {
    try {
      const r = await get('/menu/orders', { status: filtro, page, pageSize: 20 });
      lista.replaceChildren(...(r.rows.length
        ? r.rows.map(pedido)
        : [h('p', { class: 'txt-secondary text-center py-4 mb-0' }, 'Nenhum pedido aqui.')]));
      rodape.replaceChildren(paginator(r, (p) => { page = p; carregar(); }));
      refreshIcons(content);
    } catch (e) { toast(e.message, 'error'); }
  }

  /** escuta o servidor: o navegador reconecta sozinho se a conexão cair */
  function ouvir() {
    const fonte = new EventSource('/api/menu/events');
    const estado = (texto, kind) => { aoVivo.textContent = texto; aoVivo.className = `badge text-bg-${kind}`; };
    // (re)conectou: recarrega para pegar o que chegou enquanto estava fora
    fonte.onopen = () => { estado('● Ao vivo', 'success'); carregar(); };
    fonte.onerror = () => estado('Reconectando…', 'warning');
    fonte.onmessage = (ev) => {
      const e = JSON.parse(ev.data);
      if (e.type === 'new') {
        bip();
        toast(`Novo pedido #${e.number} de ${e.customerName}`);
      }
      carregar();
    };
    // saiu da tela: fecha a conexão
    addEventListener('pagehide', () => fonte.close(), { once: true });
  }

  desenharAbas();
  await carregar();
  ouvir();
  refreshIcons(content);
}
