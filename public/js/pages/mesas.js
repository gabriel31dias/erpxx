// Mesas do salão: o caixa/gerente vê todas as comandas abertas e fecha a conta.
// Os pedidos entram pelo app do garçom (/garcom); tempo real pelo mesmo SSE da tela de pedidos.
import { get, post } from '../api.js';
import { branchId, pageTitle } from '../shell.js';
import { ouvirPedidos } from '../pedidos-ao-vivo.js';
import {
  askReason, card, centsToInput, fmtBRL, h, modal, moneyInput, moneyToCents, mount, select, statusBadge, toast,
} from '../ui.js';

const STATUS = {
  pending: { label: 'Novo', kind: 'warning' },
  preparing: { label: 'Preparando', kind: 'info' },
  delivering: { label: 'Preparando', kind: 'info' },
  delivered: { label: 'Servido', kind: 'success' },
};

export default async function render({ content, can }) {
  const fecha = can('pedido.gerenciar');
  const formas = fecha ? (await get('/company/payment-methods')).rows.filter((m) => m.active && m.type !== 'crediario') : [];
  let dados = { tables: 0, serviceFeePercent: 0, orders: [] };
  let aberta = null; // { mesa, m: modal, redesenhar } enquanto a comanda está aberta na tela
  const MOTIVOS = ['Cliente desistiu', 'Lançado errado', 'Sem o produto', 'Demora'];
  // garçom cancela só o que a cozinha ainda não aceitou; o resto é com caixa/gerente (o servidor confere)
  const podeCancelar = (o) => fecha || o.status === 'pending';

  const aoVivo = h('span', { class: 'badge text-bg-secondary', role: 'status', 'aria-live': 'polite' }, 'Conectando…');
  const resumo = h('span', { class: 'txt-secondary f-12' });
  const grade = h('div', { class: 'row g-3' });

  mount(content, pageTitle('Mesas',
    h('div', { class: 'd-flex gap-2' },
      h('button', { type: 'button', class: 'btn btn-outline-primary', onclick: () => fechadas() }, 'Fechadas hoje'),
      can('cardapio.gerenciar') ? h('a', { class: 'btn btn-outline-secondary', href: '/cardapio.html' }, 'Número de mesas') : null)),
  card(null, h('div', {},
    h('div', { class: 'mb-3 d-flex flex-wrap gap-2 align-items-center justify-content-between' }, resumo, aoVivo),
    grade)));

  const pedidosDa = (mesa) => dados.orders.filter((o) => o.table === mesa);
  const totalDa = (mesa) => pedidosDa(mesa).reduce((s, o) => s + o.totalCents, 0);

  function desenhar() {
    // mesa que saiu da configuração mas ainda tem conta aberta continua aparecendo
    const n = Math.max(dados.tables, ...dados.orders.map((o) => o.table));
    const ocupadas = new Set(dados.orders.map((o) => o.table)).size;
    resumo.textContent = n ? `${ocupadas} de ${n} mesas ocupadas · ${fmtBRL(dados.orders.reduce((s, o) => s + o.totalCents, 0))} em aberto` : '';
    if (!n) {
      grade.replaceChildren(h('p', { class: 'txt-secondary text-center py-4 mb-0' },
        'Nenhuma mesa configurada. Informe quantas mesas tem o salão em Cardápio digital.'));
      return;
    }
    grade.replaceChildren(...Array.from({ length: n }, (_, i) => i + 1).map((mesa) => {
      const pedidos = pedidosDa(mesa);
      const novo = pedidos.some((o) => o.status === 'pending');
      return h('div', { class: 'col-6 col-sm-4 col-md-3 col-xl-2' },
        h('button', {
          type: 'button',
          class: `btn w-100 h-100 py-3 d-flex flex-column align-items-center justify-content-center ${pedidos.length ? 'btn-primary' : 'btn-light border'}`,
          style: 'min-height:110px',
          'aria-label': `Mesa ${mesa}${pedidos.length ? `, ${fmtBRL(totalDa(mesa))}` : ', livre'}`,
          onclick: () => abrir(mesa),
        },
        h('div', { class: 'fs-4 fw-bold' }, String(mesa)),
        pedidos.length
          ? [h('div', { class: 'f-w-600' }, fmtBRL(totalDa(mesa))),
            h('div', { class: 'f-12' }, novo ? '● aguardando cozinha' : `${pedidos.length} pedido(s)`)]
          : h('div', { class: 'f-12 txt-secondary' }, 'Livre')));
    }));
  }

  async function cancelar(url, titulo) {
    const reason = await askReason(titulo, { quick: MOTIVOS, okLabel: 'Cancelar' });
    if (!reason) return;
    try {
      await post(url, { reason });
      toast(`Cancelado: ${titulo.replace(/^Cancelar /, '')}.`);
      carregar();
    } catch (e) { toast(e.message, 'error'); }
  }

  function comanda(mesa) {
    const pedidos = pedidosDa(mesa);
    if (!pedidos.length) return h('p', { class: 'txt-secondary mb-0' }, 'Mesa livre, sem conta aberta.');
    const x = (titulo, onclick) => h('button', { type: 'button', class: 'btn btn-sm btn-link text-danger p-0 ms-2', title: titulo, 'aria-label': titulo, onclick }, '✕');
    return h('div', {},
      ...pedidos.map((o) => h('div', { class: 'border rounded p-3 mb-2' },
        h('div', { class: 'd-flex justify-content-between align-items-center mb-1' },
          h('div', {}, h('strong', { class: 'me-2' }, `#${o.number}`), statusBadge(STATUS[o.status]?.label ?? o.status, STATUS[o.status]?.kind ?? 'light')),
          h('div', { class: 'd-flex align-items-center gap-2' },
            h('span', { class: 'f-12 txt-secondary' }, new Date(o.createdAt).toLocaleTimeString('pt-BR').slice(0, 5)),
            podeCancelar(o)
              ? h('button', { type: 'button', class: 'btn btn-sm btn-outline-danger py-0', onclick: () => cancelar(`/menu/orders/${o.id}/cancel`, `Cancelar pedido #${o.number}`) }, 'Cancelar')
              : null)),
        h('ul', { class: 'mb-1 ps-3' }, o.items.map((i, k) => h('li', {},
          `${i.quantity}x ${i.name} — ${fmtBRL(i.totalCents)}`,
          podeCancelar(o) ? x(`Tirar ${i.name}`, () => cancelar(`/menu/orders/${o.id}/items/${k}/cancel`, `Cancelar ${i.quantity}x ${i.name} do pedido #${o.number}`)) : null,
          i.additionals.length ? h('div', { class: 'f-12 txt-secondary' }, i.additionals.map((a) => `+ ${a.name}`).join(' · ')) : null))),
        o.notes ? h('div', { class: 'f-12 txt-secondary' }, o.notes) : null)));
  }

  /** passa a mesa (ou os pedidos marcados) para outra; mesa ocupada junta as contas */
  function transferir(mesa, depois) {
    const n = Math.max(dados.tables, ...dados.orders.map((o) => o.table));
    const destino = select(Array.from({ length: n }, (_, i) => i + 1).filter((t) => t !== mesa).map((t) => ({
      value: t, label: `Mesa ${t}${pedidosDa(t).length ? ` (ocupada, ${fmtBRL(totalDa(t))})` : ''}`,
    })), { class: 'form-select', 'aria-label': 'Mesa de destino' });
    const marcas = pedidosDa(mesa).map((o) => ({
      id: o.id, box: h('input', { type: 'checkbox', class: 'form-check-input me-2', checked: true, 'aria-label': `Pedido #${o.number}` }), o,
    }));
    const ok = h('button', { class: 'btn btn-primary' }, 'Transferir');
    const m = modal({
      title: `Transferir mesa ${mesa}`,
      body: h('div', {},
        h('label', { class: 'form-label' }, 'Para a mesa'), destino,
        h('p', { class: 'f-12 txt-secondary mt-2' }, 'Se a mesa de destino já estiver ocupada, as contas são juntadas.'),
        h('div', { class: 'mt-2' }, h('div', { class: 'form-label' }, 'Pedidos'),
          ...marcas.map(({ box, o }) => h('label', { class: 'd-flex align-items-center mb-1' }, box, `#${o.number} · ${fmtBRL(o.totalCents)}`)))),
      footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Voltar'), ok],
    });
    ok.onclick = async () => {
      const ids = marcas.filter((x) => x.box.checked).map((x) => x.id);
      if (!ids.length) return toast('Marque ao menos um pedido.', 'error');
      ok.disabled = true;
      try {
        const r = await post(`/menu/tables/${mesa}/transfer`, {
          to: Number(destino.value), ...(ids.length < marcas.length ? { orderIds: ids } : {}),
        });
        toast(`${r.moved} pedido(s) da mesa ${r.from} foram para a mesa ${r.to}.`);
        m.close();
        depois();
        carregar();
      } catch (e) { toast(e.message, 'error'); ok.disabled = false; }
    };
  }

  /** comanda da mesa; com permissão, fecha a conta: taxa de serviço e conta dividida */
  function abrir(mesa) {
    const corpo = h('div', {});
    const fechar = h('button', { class: 'btn btn-success' }, 'Fechar conta');
    const transfere = h('button', { class: 'btn btn-outline-primary me-auto' }, 'Transferir');
    const temConta = () => pedidosDa(mesa).length > 0;

    // ---- pagamento (só quem fecha conta) ----
    const pct = dados.serviceFeePercent || 0;
    const taxa = h('input', { type: 'checkbox', class: 'form-check-input', id: `taxa-${mesa}`, checked: pct > 0 });
    const consumo = () => totalDa(mesa);
    const servico = () => (taxa.checked ? Math.round((consumo() * pct) / 100) : 0);
    const total = () => consumo() + servico();
    const linhas = h('div', { class: 'd-flex flex-column gap-2' });
    const valores = h('div', { class: 'small' });
    const falta = h('div', { class: 'small fw-bold' });
    const pessoas = h('input', { type: 'number', min: 2, max: 20, value: 2, class: 'form-control form-control-sm', style: 'width:70px', 'aria-label': 'Pessoas' });
    const pagos = [];

    function conferir() {
      const soma = pagos.reduce((s, p) => s + moneyToCents(p.valor.value), 0);
      const diff = total() - soma;
      valores.replaceChildren(
        h('div', { class: 'd-flex justify-content-between' }, h('span', {}, 'Consumo'), h('span', {}, fmtBRL(consumo()))),
        pct ? h('div', { class: 'd-flex justify-content-between' }, h('span', {}, `Taxa de serviço (${pct}%)`), h('span', {}, fmtBRL(servico()))) : null,
        h('div', { class: 'd-flex justify-content-between fs-5 fw-bold' }, h('span', {}, 'Total'), h('span', {}, fmtBRL(total()))));
      falta.className = `small fw-bold ${diff === 0 ? 'text-success' : 'text-danger'}`;
      falta.textContent = diff === 0 ? 'Pagamentos conferem com o total.' : diff > 0 ? `Falta ${fmtBRL(diff)}` : `Passou ${fmtBRL(-diff)} do total`;
      fechar.disabled = diff !== 0 || !pagos.length;
    }

    function linha(cents) {
      const forma = select(formas.map((m, i) => ({ value: m.id, label: m.name, selected: i === 0 })), { class: 'form-select', 'aria-label': 'Forma de pagamento' });
      const valor = moneyInput({ value: centsToInput(cents), class: 'form-control', style: 'max-width:120px', 'aria-label': 'Valor' });
      const recebido = moneyInput({ placeholder: 'Recebido', class: 'form-control', style: 'max-width:120px', 'aria-label': 'Recebido em dinheiro' });
      const tira = h('button', { type: 'button', class: 'btn btn-outline-danger', 'aria-label': 'Tirar pagamento' }, '✕');
      const row = { forma, valor, recebido, el: h('div', { class: 'd-flex gap-2' }, forma, valor, recebido, tira) };
      const dinheiro = () => formas.find((m) => m.id === forma.value)?.requiresChange;
      row.dinheiro = dinheiro;
      const ver = () => { recebido.classList.toggle('d-none', !dinheiro()); conferir(); };
      forma.onchange = ver;
      valor.addEventListener('input', conferir);
      valor.addEventListener('blur', conferir);
      tira.onclick = () => { pagos.splice(pagos.indexOf(row), 1); row.el.remove(); conferir(); };
      pagos.push(row);
      linhas.append(row.el);
      ver();
    }

    /** n linhas iguais; os centavos que sobram vão na primeira */
    function dividir(n) {
      pagos.splice(0).forEach((p) => p.el.remove());
      const t = total();
      for (let i = 0; i < n; i++) linha(Math.floor(t / n) + (i === 0 ? t % n : 0));
    }

    taxa.onchange = () => { if (pagos.length === 1) pagos[0].valor.value = centsToInput(total()); conferir(); };
    const pagamento = fecha ? h('div', { class: 'border-top pt-3 mt-2' },
      pct ? h('div', { class: 'form-check mb-2' }, taxa, h('label', { class: 'form-check-label', for: taxa.id }, `Cobrar taxa de serviço (${pct}%)`)) : null,
      valores,
      h('div', { class: 'd-flex flex-wrap align-items-center gap-2 my-2' },
        h('span', { class: 'form-label mb-0 me-auto' }, 'Pagamentos'),
        h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', onclick: () => {
          const resta = total() - pagos.reduce((s, p) => s + moneyToCents(p.valor.value), 0);
          linha(Math.max(resta, 0));
        } }, '+ Pagamento'),
        h('span', { class: 'small' }, 'Dividir por'), pessoas,
        h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', onclick: () => dividir(Math.min(20, Math.max(2, Number(pessoas.value) || 2))) }, 'Dividir')),
      linhas, h('div', { class: 'mt-2' }, falta),
      h('p', { class: 'txt-secondary f-12 mb-0 mt-2' }, 'Fechar a conta lança a venda no caixa aberto, baixa o estoque e registra no financeiro.')) : null;

    function redesenhar() {
      corpo.replaceChildren(comanda(mesa));
      transfere.classList.toggle('d-none', !temConta());
      if (!pagamento) return;
      pagamento.classList.toggle('d-none', !temConta());
      fechar.classList.toggle('d-none', !temConta());
      // pedido novo/cancelado com a comanda aberta: um pagamento só acompanha o total
      if (pagos.length === 1) pagos[0].valor.value = centsToInput(total());
      conferir();
    }

    const m = modal({
      title: `Mesa ${mesa}`,
      size: 'modal-lg',
      body: h('div', {}, corpo, pagamento),
      footer: [transfere, h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Voltar'), fecha ? fechar : null],
    });
    if (fecha) linha(total());
    redesenhar();
    aberta = { mesa, m, redesenhar };
    // fechou o modal (Voltar, X ou ESC): para de redesenhar a comanda
    m.el.addEventListener('hidden.bs.modal', () => { if (aberta?.m === m) aberta = null; }, { once: true });
    transfere.onclick = () => transferir(mesa, () => m.close());

    fechar.onclick = async () => {
      fechar.disabled = true;
      try {
        const r = await post(`/menu/tables/${mesa}/close`, {
          branchId: branchId() || undefined,
          serviceFee: taxa.checked,
          payments: pagos.map((p) => ({
            paymentMethodId: p.forma.value, amountCents: moneyToCents(p.valor.value),
            ...(p.dinheiro() && p.recebido.value ? { receivedCents: moneyToCents(p.recebido.value) } : {}),
          })),
        });
        toast(`Conta da mesa ${mesa} fechada: ${fmtBRL(r.totalCents)}.`);
        aberta = null;
        m.close();
        carregar();
      } catch (e) {
        toast(e.message, 'error');
        fechar.disabled = false;
      }
    };
  }

  /** contas fechadas no dia: hora, mesa, pedidos, pagamento, total e quem fechou */
  function fechadas() {
    const dia = h('input', { type: 'date', class: 'form-control', style: 'max-width:180px', 'aria-label': 'Dia' });
    const lista = h('div', {}, h('p', { class: 'txt-secondary mb-0' }, 'Carregando…'));
    async function listar() {
      try {
        const r = await get('/menu/tables/closed', dia.value ? { date: dia.value } : {});
        dia.value = r.date;
        const validas = r.rows.filter((x) => x.status !== 'CANCELLED');
        lista.replaceChildren(r.rows.length
          ? h('div', { class: 'table-responsive' }, h('table', { class: 'table table-sm align-middle mb-0' },
            h('thead', {}, h('tr', {}, ...['Hora', 'Mesa', 'Pedidos', 'Pagamento', 'Fechou', 'Serviço', 'Total'].map((t) => h('th', {}, t)))),
            h('tbody', {}, ...r.rows.map((x) => h('tr', { class: x.status === 'CANCELLED' ? 'text-decoration-line-through txt-secondary' : '' },
              h('td', {}, x.closedAt.slice(11, 16)),
              h('td', {}, h('strong', {}, String(x.table))),
              h('td', { class: 'f-12' }, x.orders.map((n) => `#${n}`).join(', ')),
              h('td', { class: 'f-12' }, x.payments.join(', ')),
              h('td', { class: 'text-nowrap' }, x.closedBy ?? '—'),
              h('td', { class: 'text-end text-nowrap f-12' }, x.serviceCents ? fmtBRL(x.serviceCents) : '—'),
              // o valor abre a venda
              h('td', { class: 'text-end text-nowrap' }, h('a', { href: `/venda.html?id=${x.saleId}`, title: `Venda #${x.saleNumber}` }, fmtBRL(x.totalCents)))))),
            h('tfoot', {}, h('tr', {},
              h('th', { colspan: 5 }, `${validas.length} conta(s) fechada(s)`),
              h('th', { class: 'text-end text-nowrap' }, fmtBRL(validas.reduce((t, x) => t + x.serviceCents, 0))),
              h('th', { class: 'text-end text-nowrap' }, fmtBRL(validas.reduce((t, x) => t + x.totalCents, 0)))))))
          : h('p', { class: 'txt-secondary text-center py-3 mb-0' }, 'Nenhuma mesa fechada neste dia.'));
      } catch (e) { toast(e.message, 'error'); }
    }
    dia.onchange = listar;
    modal({
      title: 'Mesas fechadas',
      size: 'modal-lg',
      body: h('div', {}, h('div', { class: 'mb-3' }, dia), lista),
      footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Fechar')],
    });
    listar();
  }

  async function carregar() {
    try {
      dados = await get('/menu/tables');
      desenhar();
      // comanda aberta na tela acompanha pedido novo e mudança de status
      if (aberta) aberta.redesenhar();
    } catch (e) { toast(e.message, 'error'); }
  }

  desenhar();
  const estado = (texto, kind) => { aoVivo.textContent = texto; aoVivo.className = `badge text-bg-${kind}`; };
  // conexão da aba (a mesma do alarme); (re)conectou: recarrega o que chegou enquanto estava fora
  ouvirPedidos({
    open: () => { estado('● Ao vivo', 'success'); carregar(); },
    error: () => estado('Reconectando…', 'warning'),
    message: () => carregar(),
  });
}
