// Pedidos do cardápio digital: a cozinha/balcão avança o status; entregue vira venda.
// Grade de cards (ícone e cor por status); clique abre o detalhe. Tempo real por SSE (/api/menu/events).
import { get, patch, post } from '../api.js';
import { branchId, pageTitle } from '../shell.js';
import { ouvirPedidos } from '../pedidos-ao-vivo.js';
import {
  askReason, card, centsToInput, field, fmtBRL, h, icon, modal, moneyInput, moneyToCents, mount, paginator, refreshIcons, select,
  toast,
} from '../ui.js';

// `cor` vira a classe lf-ped-<cor> (app.css): faixa, ícone e chip do card
const STATUS = {
  pending: { label: 'Novo', cor: 'novo', icone: 'bell', next: 'preparing', action: 'Aceitar e preparar', acaoIcone: 'check' },
  preparing: { label: 'Preparando', cor: 'preparo', icone: 'clock', next: 'delivering', action: 'Saiu para entrega', acaoIcone: 'truck' },
  delivering: { label: 'Saiu para entrega', cor: 'rota', icone: 'truck', next: 'delivered', action: 'Entregue', acaoIcone: 'check-circle' },
  delivered: { label: 'Entregue', cor: 'feito', icone: 'check-circle' },
  cancelled: { label: 'Cancelado', cor: 'cancelado', icone: 'x-circle' },
};
/** mesa: depois de pronto é servido, sem entrega; a venda sai ao fechar a conta */
const MESA = {
  ...STATUS,
  preparing: { ...STATUS.preparing, next: 'delivered', action: 'Servido', acaoIcone: 'check-circle' },
  delivered: { ...STATUS.delivered, label: 'Servido' },
};
const etapa = (o, status) => (o.table != null ? MESA : STATUS)[status];
/** etapas da linha do tempo, na ordem */
const ETAPAS = (o) => (o.table != null ? ['pending', 'preparing', 'delivered'] : ['pending', 'preparing', 'delivering', 'delivered']);

/** como chega ao cliente */
function tipo(o) {
  if (o.table != null) return { icone: 'grid', texto: `Mesa ${o.table}` };
  return o.deliveryType === 'delivery' ? { icone: 'map-pin', texto: 'Entrega' } : { icone: 'shopping-bag', texto: 'Retirada' };
}
/** como paga */
function pagamento(o) {
  if (o.paymentStatus === 'refund_pending') return { icone: 'alert-triangle', texto: 'Estornar Pix' };
  if (o.paymentMethod === 'pix') return { icone: 'smartphone', texto: 'Pix pago' };
  if (o.paymentMethod === 'comanda') return { icone: 'clipboard', texto: 'Na comanda' };
  return { icone: 'dollar-sign', texto: 'Paga na entrega' };
}
/** "agora", "há 5 min", "há 1 h 20" */
function desde(iso) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const hs = Math.floor(min / 60);
  return hs < 24 ? `há ${hs} h${min % 60 ? ` ${min % 60}` : ''}` : new Date(iso).toLocaleDateString('pt-BR');
}
// pedido novo parado há mais que isso fica destacado no card
const ATRASO_MIN = 10;
const atrasado = (o) => o.status === 'pending' && Date.now() - new Date(o.createdAt) > ATRASO_MIN * 60000;
const whatsapp = (fone) => {
  const n = fone.replace(/\D/g, '');
  return `https://wa.me/${n.length <= 11 ? `55${n}` : n}`;
};
const chip = ({ icone, texto }, extra = '') => h('span', { class: `lf-ped-chip ${extra}` }, icon(icone, 13), texto);

const FILTROS = [
  ['pending,preparing,delivering', 'Em andamento'],
  ['pending', 'Novos'],
  ['delivered', 'Entregues'],
  ['cancelled', 'Cancelados'],
  ['', 'Todos'],
];

export default async function render({ content, can }) {
  const gerencia = can('pedido.gerenciar');
  const formas = gerencia ? (await get('/company/payment-methods')).rows.filter((m) => m.active && m.type !== 'crediario') : [];
  let filtro = FILTROS[0][0];
  let page = 1;

  const abas = h('div', { class: 'btn-group flex-wrap', role: 'group', 'aria-label': 'Filtro de pedidos' });
  const resumo = h('div', { class: 'lf-ped-resumo' });
  const aoVivo = h('span', { class: 'badge text-bg-secondary', role: 'status', 'aria-live': 'polite' }, 'Conectando…');
  const lista = h('div', {});
  const rodape = h('div', {});

  mount(content, pageTitle('Pedidos do cardápio',
    can('cardapio.gerenciar') ? h('a', { class: 'btn btn-outline-secondary', href: '/cardapio.html' }, 'Configurar cardápio') : null),
  resumo,
  card(null, h('div', {}, h('div', { class: 'mb-3 d-flex flex-wrap gap-2 align-items-center justify-content-between' }, abas, aoVivo), lista, rodape)));

  function desenharAbas() {
    abas.replaceChildren(...FILTROS.map(([v, label]) => h('button', {
      class: `btn btn-sm ${v === filtro ? 'btn-primary' : 'btn-outline-primary'}`,
      onclick: () => { filtro = v; page = 1; desenharAbas(); carregar(); },
    }, label)));
    resumo.querySelectorAll('.lf-ped-contador').forEach((b, i) => b.classList.toggle('ativo', ['pending', 'preparing', 'delivering'][i] === filtro));
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

  /** card da grade: o essencial para a cozinha bater o olho; o resto no detalhe */
  function pedido(o) {
    const st = etapa(o, o.status);
    const qtd = o.items.reduce((n, i) => n + i.quantity, 0);
    const acao = gerencia && st.next && !o.saleId
      ? h('button', {
        class: `btn btn-sm lf-ped-acao lf-ped-${st.cor}`,
        onclick: (e) => { e.stopPropagation(); avancar(o); },
      }, icon(st.acaoIcone, 14), st.action)
      : null;
    const quando = h('span', { class: 'lf-ped-tempo', 'data-desde': o.createdAt }, icon('clock', 12), desde(o.createdAt));
    return h('article', {
      class: `lf-ped lf-ped-${st.cor} ${atrasado(o) ? 'lf-ped-atrasado' : ''}`,
      tabindex: 0, role: 'button', 'aria-label': `Pedido #${o.number}, ${st.label}. Abrir detalhes`,
      onclick: () => detalhe(o),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); detalhe(o); } },
    },
    h('div', { class: 'lf-ped-topo' },
      h('span', { class: 'lf-ped-icone' }, icon(st.icone, 20)),
      h('div', { class: 'lf-ped-id' },
        h('strong', {}, `#${o.number}`),
        h('span', { class: 'lf-ped-status' }, st.label)),
      quando),
    h('div', { class: 'lf-ped-cliente' }, o.table != null ? `Mesa ${o.table}` : o.customerName),
    h('div', { class: 'lf-ped-itens' }, o.items.slice(0, 3).map((i) => h('div', {}, `${i.quantity}× ${i.name}`)),
      o.items.length > 3 ? h('div', { class: 'lf-ped-mais' }, `+ ${o.items.length - 3} item(ns)`) : null),
    h('div', { class: 'lf-ped-chips' }, chip(tipo(o)), chip(pagamento(o), o.paymentStatus === 'refund_pending' ? 'lf-ped-chip-alerta' : ''),
      o.notes ? chip({ icone: 'message-square', texto: 'Obs.' }) : null),
    h('div', { class: 'lf-ped-rodape' },
      h('div', {}, h('div', { class: 'lf-ped-total' }, fmtBRL(o.totalCents)), h('div', { class: 'lf-ped-qtd' }, `${qtd} ${qtd === 1 ? 'item' : 'itens'}`)),
      acao));
  }

  function avancar(o) {
    const st = etapa(o, o.status);
    return st.next === 'delivered' ? entregar(o) : mudar(o, st.next);
  }

  /** linha do tempo: etapas já feitas, a atual e as que faltam */
  function linhaDoTempo(o) {
    if (o.status === 'cancelled') {
      return h('div', { class: 'lf-ped-cancel-box' }, icon('x-circle', 18),
        h('div', {}, h('strong', {}, 'Pedido cancelado'), o.cancelReason ? h('div', { class: 'f-12' }, o.cancelReason) : null));
    }
    const etapas = ETAPAS(o);
    const atual = etapas.indexOf(o.status);
    return h('ol', { class: 'lf-ped-linha' }, etapas.map((s, i) => {
      const e = etapa(o, s);
      return h('li', { class: i < atual ? 'feito' : i === atual ? `atual lf-ped-${e.cor}` : '' },
        h('span', { class: 'lf-ped-linha-bola' }, icon(i < atual ? 'check' : e.icone, 14)), h('span', {}, e.label));
    }));
  }

  /** detalhe completo: itens com adicionais, cliente, endereço, observação e ações */
  function detalhe(o) {
    const st = etapa(o, o.status);
    const t = tipo(o);
    const linha = (rotulo, valor) => h('div', { class: 'd-flex justify-content-between f-14' }, h('span', { class: 'text-muted' }, rotulo), h('span', {}, valor));
    let m;
    const fechaE = (fn) => async () => { m.close(); await fn(); };
    const botoes = [
      o.saleId ? h('a', { class: 'btn btn-outline-secondary', href: `/venda.html?id=${o.saleId}` }, icon('file-text', 14), ' Ver venda') : null,
      gerencia && !['delivered', 'cancelled'].includes(o.status)
        ? h('button', { class: 'btn btn-outline-danger', onclick: fechaE(() => cancelar(o)) }, icon('x', 14), ' Cancelar pedido') : null,
      gerencia && st.next && !o.saleId
        ? h('button', { class: `btn lf-ped-acao lf-ped-${st.cor}`, onclick: fechaE(() => avancar(o)) }, icon(st.acaoIcone, 14), ` ${st.action}`) : null,
    ].filter(Boolean);

    m = modal({
      title: h('span', { class: 'd-flex align-items-center gap-2' },
        h('span', { class: `lf-ped-icone lf-ped-${st.cor}` }, icon(st.icone, 18)), `Pedido #${o.number}`,
        h('span', { class: `lf-ped-status-chip lf-ped-${st.cor}` }, st.label)),
      size: 'modal-lg',
      body: h('div', { class: 'row g-4' },
        h('div', { class: 'col-12' }, linhaDoTempo(o)),
        h('div', { class: 'col-md-7' },
          h('h6', { class: 'mb-3' }, 'Itens'),
          h('div', { class: 'lf-ped-det-itens' }, o.items.map((i) => h('div', { class: 'lf-ped-det-item' },
            h('span', { class: 'lf-ped-det-qtd' }, `${i.quantity}×`),
            h('div', { class: 'flex-grow-1' }, h('div', { class: 'f-w-600' }, i.name),
              i.additionals.map((a) => h('div', { class: 'f-12 text-muted' }, `+ ${a.name}${a.priceCents ? ` (${fmtBRL(a.priceCents)})` : ''}`))),
            h('span', { class: 'f-w-600 text-nowrap' }, fmtBRL(i.totalCents))))),
          h('div', { class: 'mt-3 pt-3 border-top d-grid gap-1' },
            linha('Subtotal', fmtBRL(o.subtotalCents)),
            o.deliveryFeeCents ? linha('Taxa de entrega', fmtBRL(o.deliveryFeeCents)) : null,
            h('div', { class: 'd-flex justify-content-between f-18 f-w-700 mt-1' }, h('span', {}, 'Total'), h('span', {}, fmtBRL(o.totalCents))))),
        h('div', { class: 'col-md-5 d-grid gap-3 align-content-start' },
          o.table != null ? null : h('div', { class: 'lf-ped-bloco' },
            h('div', { class: 'lf-ped-bloco-titulo' }, icon('user', 14), 'Cliente'),
            h('div', { class: 'f-w-600' }, o.customerName),
            h('a', { href: whatsapp(o.customerPhone), target: '_blank', rel: 'noopener', class: 'd-inline-flex align-items-center gap-1' },
              icon('message-circle', 14), o.customerPhone)),
          h('div', { class: 'lf-ped-bloco' },
            h('div', { class: 'lf-ped-bloco-titulo' }, icon(t.icone, 14), t.texto),
            o.deliveryType === 'delivery'
              ? h('a', { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}`, target: '_blank', rel: 'noopener' }, o.address)
              : h('div', {}, o.table != null ? 'Servir na mesa' : 'Cliente retira no balcão')),
          h('div', { class: 'lf-ped-bloco' },
            h('div', { class: 'lf-ped-bloco-titulo' }, icon(pagamento(o).icone, 14), 'Pagamento'),
            h('div', {}, pagamento(o).texto),
            o.paymentStatus === 'refund_pending' ? h('div', { class: 'f-12 text-danger' }, 'Pago por Pix e cancelado: faça o estorno no gateway.') : null),
          h('div', { class: 'lf-ped-bloco' },
            h('div', { class: 'lf-ped-bloco-titulo' }, icon('calendar', 14), 'Recebido'),
            h('div', {}, `${new Date(o.createdAt).toLocaleString('pt-BR').slice(0, 17)} (${desde(o.createdAt)})`)),
          o.notes ? h('div', { class: 'lf-ped-bloco lf-ped-obs' },
            h('div', { class: 'lf-ped-bloco-titulo' }, icon('message-square', 14), 'Observação do cliente'), h('div', {}, o.notes)) : null)),
      footer: botoes.length ? botoes : null,
    });
  }

  /** quantos em cada etapa ativa; clicar filtra */
  async function contar() {
    const ativos = ['pending', 'preparing', 'delivering'];
    const totais = await Promise.all(ativos.map((s) => get('/menu/orders', { status: s, pageSize: 1 }).then((r) => r.total)));
    resumo.replaceChildren(...ativos.map((s, i) => {
      const e = STATUS[s];
      return h('button', {
        type: 'button', class: `lf-ped-contador lf-ped-${e.cor} ${filtro === s ? 'ativo' : ''}`,
        onclick: () => { filtro = s; page = 1; desenharAbas(); carregar(); },
      }, h('span', { class: 'lf-ped-icone' }, icon(e.icone, 18)),
      h('span', {}, h('strong', {}, totais[i]), h('span', {}, e.label)));
    }));
  }

  async function carregar() {
    try {
      const [r] = await Promise.all([get('/menu/orders', { status: filtro, page, pageSize: 24 }), contar()]);
      lista.replaceChildren(r.rows.length
        ? h('div', { class: 'lf-ped-grade' }, r.rows.map(pedido))
        : h('div', { class: 'lf-ped-vazio' }, icon('inbox', 36), h('p', { class: 'mb-0 mt-2' }, 'Nenhum pedido aqui.')));
      rodape.replaceChildren(paginator(r, (p) => { page = p; carregar(); }));
      refreshIcons(content);
    } catch (e) { toast(e.message, 'error'); }
  }

  // "há X min" anda sozinho entre um evento e outro
  setInterval(() => {
    content.querySelectorAll('[data-desde]').forEach((el) => { el.lastChild.textContent = desde(el.dataset.desde); });
  }, 30000);

  /** escuta o servidor (conexão da aba, a mesma do alarme); o navegador reconecta sozinho */
  function ouvir() {
    const estado = (texto, kind) => { aoVivo.textContent = texto; aoVivo.className = `badge text-bg-${kind}`; };
    ouvirPedidos({
      // (re)conectou: recarrega para pegar o que chegou enquanto estava fora
      open: () => { estado('● Ao vivo', 'success'); carregar(); },
      error: () => estado('Reconectando…', 'warning'),
      message: () => carregar(),
    });
  }

  desenharAbas();
  await carregar();
  ouvir();
  refreshIcons(content);
}
