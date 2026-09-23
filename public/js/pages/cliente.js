// Ficha do cliente: cadastro + histórico de compras e indicadores.
import { get, patch, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { criarMapa } from '../mapa.js';
import { mount,
  card, centsToInput, field, fmtBRL, fmtDate, h, input, moneyInput, moneyToCents, refreshIcons, select, statCard,
  textarea, toast, todayStr,
} from '../ui.js';

export default async function render({ content, can }) {
  const id = new URLSearchParams(location.search).get('id');
  const data = id ? await get(`/customers/${id}`) : null;
  const c = data?.customer ?? {};
  const editavel = can('cliente.gerenciar');
  // trocar a tabela muda o preço do cliente: só quem gerencia tabelas
  const podeTabela = editavel && can('tabela_preco.gerenciar');
  const tabelas = (await get('/price-lists').catch(() => ({ rows: [] }))).rows
    .filter((t) => t.active || t.id === c.priceListId);

  const f = {
    name: input({ value: c.name ?? '', required: true }),
    document: input({ value: c.document ?? '' }),
    phone: input({ value: c.phone ?? '', type: 'tel' }),
    whatsapp: input({ value: c.whatsapp ?? '', type: 'tel' }),
    email: input({ value: c.email ?? '', type: 'email' }),
    birthdate: input({ value: c.birthdate ?? '', type: 'date' }),
    address: input({ value: c.address ?? '' }),
    notes: textarea({ value: c.notes ?? '' }),
    active: select([
      { value: 'true', label: 'Ativo', selected: c.active !== false },
      { value: 'false', label: 'Inativo', selected: c.active === false },
    ]),
    priceList: select([
      { value: '', label: 'Preço do cadastro', selected: !c.priceListId },
      ...tabelas.map((t) => ({ value: t.id, label: t.name, selected: t.id === c.priceListId })),
    ], { disabled: !podeTabela }),
  };

  const salvar = h('button', { class: 'btn btn-primary', type: 'submit' }, id ? 'Salvar' : 'Cadastrar cliente');
  const form = h('form', { class: 'row g-3' },
    field('Nome', f.name, { col: 'col-12 col-md-6' }),
    field('CPF/CNPJ', f.document, { col: 'col-6 col-md-3' }),
    field('Nascimento', f.birthdate, { col: 'col-6 col-md-3' }),
    field('Telefone', f.phone, { col: 'col-6 col-md-3' }),
    field('WhatsApp', f.whatsapp, { col: 'col-6 col-md-3' }),
    field('E-mail', f.email, { col: 'col-12 col-md-4' }),
    field('Situação', f.active, { col: 'col-6 col-md-2' }),
    field('Tabela de preço', f.priceList, {
      col: 'col-12 col-md-4',
      help: podeTabela ? 'Preço que o cliente paga no PDV e no app dos vendedores.'
        : 'Só gerente ou proprietário altera a tabela do cliente.',
    }),
    field('Endereço', f.address, { col: 'col-12' }),
    field('Observações', f.notes, { col: 'col-12' }),
    h('div', { class: 'col-12 d-flex gap-2 justify-content-end' },
      h('a', { class: 'btn btn-light', href: '/clientes.html' }, 'Voltar'),
      editavel ? salvar : null));

  form.onsubmit = async (e) => {
    e.preventDefault();
    salvar.disabled = true;
    try {
      const body = {
        name: f.name.value.trim(),
        document: f.document.value.trim() || undefined,
        phone: f.phone.value.trim() || undefined,
        whatsapp: f.whatsapp.value.trim() || undefined,
        email: f.email.value.trim() || undefined,
        birthdate: f.birthdate.value || undefined,
        address: f.address.value.trim() || undefined,
        notes: f.notes.value.trim() || undefined,
        active: f.active.value === 'true',
        ...(podeTabela ? { priceListId: f.priceList.value || null } : {}),
      };
      const saved = id ? await patch(`/customers/${id}`, body) : await post('/customers', body);
      toast('Cliente salvo.');
      if (!id) location.href = `/cliente.html?id=${saved.id}`;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      salvar.disabled = false;
    }
  };

  const stats = data ? h('div', { class: 'row' },
    statCard('Total comprado', fmtBRL(data.stats.totalCents), { iconName: 'shopping-bag' }),
    statCard('Compras', String(data.stats.salesCount), { iconName: 'repeat', color: '#16c7f9' }),
    statCard('Ticket médio', fmtBRL(data.stats.avgTicketCents), { iconName: 'activity', color: '#54ba4a' }),
    statCard('Última compra', data.stats.lastSaleAt ? fmtDate(data.stats.lastSaleAt) : '—',
      { iconName: 'calendar', color: '#ffaa05' })) : null;

  const historico = data ? card('Histórico de compras', data.sales.length
    ? h('div', { class: 'table-responsive' }, h('table', { class: 'table align-middle mb-0' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Venda'), h('th', {}, 'Data'), h('th', { class: 'text-end' }, 'Itens'),
          h('th', {}, 'Pagamento'), h('th', { class: 'text-end' }, 'Total'), h('th', {}))),
        h('tbody', {}, data.sales.map((s) => h('tr', {},
          h('td', {}, `#${s.number}`), h('td', {}, s.soldAt),
          h('td', { class: 'text-end' }, String(s.items)), h('td', {}, s.payments),
          h('td', { class: 'text-end f-w-600' }, fmtBRL(s.totalCents)),
          h('td', { class: 'text-end' },
            h('a', { class: 'btn btn-sm btn-outline-secondary', href: `/venda.html?id=${s.id}` }, 'Abrir')))))))
    : h('p', { class: 'txt-secondary mb-0' }, 'Este cliente ainda não comprou.')) : null;

  const credito = id ? await blocoCredito(id, can('credito.gerenciar')) : null;
  const local = id && window.L ? blocoLocal(c, editavel) : null;

  mount(content,
    pageTitle(id ? c.name : 'Novo cliente'),
    stats,
    card('Dados do cliente', form),
    local?.el,
    credito,
    historico);
  local?.iniciar();
  refreshIcons(content);
}

/** Localização do cliente no mapa (check-in e roteiros): arrastar o pino ou buscar pelo endereço. */
function blocoLocal(c, editavel) {
  const mapaEl = h('div', { class: 'lf-map', style: 'height:280px' });
  const info = h('small', { class: 'txt-secondary' });
  const ORIGEM = { manual: 'marcado no mapa', geocoder: 'encontrado pelo endereço', checkin: 'do primeiro check-in do vendedor' };
  const legenda = () => {
    info.textContent = c.lat == null ? 'Sem localização. Busque pelo endereço ou clique no mapa para marcar.'
      : `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} · ${ORIGEM[c.geoSource] ?? ''}`;
  };
  const buscar = editavel && c.address ? h('button', { class: 'btn btn-sm btn-outline-primary', type: 'button' }, 'Buscar pelo endereço') : null;
  let map;
  let pino;
  const posicionar = (lat, lng, zoom) => {
    if (!pino) {
      pino = window.L.marker([lat, lng], { draggable: editavel }).addTo(map);
      pino.on('dragend', () => { const p = pino.getLatLng(); salvar(p.lat, p.lng); });
    } else pino.setLatLng([lat, lng]);
    map.setView([lat, lng], zoom ?? Math.max(map.getZoom(), 16));
  };
  async function salvar(lat, lng) {
    try {
      Object.assign(c, await patch(`/customers/${c.id}/geo`, { lat, lng }));
      legenda();
      toast('Localização do cliente salva.');
    } catch (e) { toast(e.message, 'error'); }
  }
  if (buscar) {
    buscar.onclick = async () => {
      buscar.disabled = true;
      try {
        const g = await post(`/customers/${c.id}/geo/lookup`);
        Object.assign(c, g);
        posicionar(g.lat, g.lng, 16);
        legenda();
        toast('Encontrado. Arraste o pino se precisar ajustar.');
      } catch (e) { toast(e.message, 'error'); } finally { buscar.disabled = false; }
    };
  }
  return {
    el: card('Localização', h('div', {}, mapaEl, h('div', { class: 'mt-2' }, info)), buscar),
    iniciar() {
      map = criarMapa(mapaEl);
      if (c.lat != null) posicionar(c.lat, c.lng, 16);
      if (editavel) map.on('click', (e) => { posicionar(e.latlng.lat, e.latlng.lng); salvar(e.latlng.lat, e.latlng.lng); });
      legenda();
    },
  };
}

/** Crediário: limite, uso, atraso e parcelas em aberto; quem tem credito.gerenciar edita. */
async function blocoCredito(id, editavel) {
  const box = h('div', {});
  const desenhar = (cr) => {
    const situacao = cr.limitCents === null ? h('span', { class: 'badge text-bg-secondary' }, 'Sem crediário')
      : cr.status === 'BLOQUEADO' ? h('span', { class: 'badge text-bg-danger' }, `Bloqueado${cr.blockReason ? ` · ${cr.blockReason}` : ''}`)
      : cr.overdue.count ? h('span', { class: 'badge text-bg-warning' }, `${cr.overdue.count} parcela(s) em atraso`)
      : h('span', { class: 'badge text-bg-success' }, 'Liberado');

    const resumo = h('div', { class: 'row g-3 mb-3' },
      ...[['Limite', cr.limitCents === null ? '—' : fmtBRL(cr.limitCents)], ['Em aberto', fmtBRL(cr.usedCents)],
        ['Disponível', cr.limitCents === null ? '—' : fmtBRL(cr.availableCents)],
        ['Em atraso', cr.overdue.count ? `${fmtBRL(cr.overdue.amountCents)} · ${cr.overdue.days} dia(s)` : '—']]
        .map(([rotulo, valor]) => h('div', { class: 'col-6 col-md-3' },
          h('div', { class: 'f-12 txt-secondary' }, rotulo), h('div', { class: 'f-w-600 lf-num' }, valor))));

    let form = null;
    if (editavel) {
      const limite = moneyInput({ value: cr.limitCents === null ? '' : centsToInput(cr.limitCents), placeholder: 'sem crediário' });
      const status = select([
        { value: 'LIBERADO', label: 'Liberado', selected: cr.status !== 'BLOQUEADO' },
        { value: 'BLOQUEADO', label: 'Bloqueado', selected: cr.status === 'BLOQUEADO' },
      ]);
      const motivo = input({ value: cr.blockReason ?? '', placeholder: 'Ex.: cheque devolvido' });
      const salvar = h('button', { class: 'btn btn-outline-primary', type: 'submit' }, 'Salvar crédito');
      form = h('form', { class: 'row g-3 align-items-end mb-3' },
        field('Limite de crédito', limite, { col: 'col-6 col-md-3', help: 'Vazio = cliente sem crediário.' }),
        field('Situação', status, { col: 'col-6 col-md-3' }),
        field('Motivo do bloqueio', motivo, { col: 'col-12 col-md-4' }),
        h('div', { class: 'col-12 col-md-2 text-end' }, salvar));
      form.onsubmit = async (e) => {
        e.preventDefault();
        salvar.disabled = true;
        try {
          desenhar(await patch(`/customers/${id}/credit`, {
            creditLimitCents: limite.value.trim() === '' ? null : moneyToCents(limite.value),
            creditStatus: status.value, creditBlockReason: motivo.value.trim() || undefined,
          }));
          toast('Crédito do cliente salvo.');
        } catch (err) { toast(err.message, 'error'); } finally { salvar.disabled = false; }
      };
    }

    const parcelas = cr.installments.length
      ? h('div', { class: 'table-responsive' }, h('table', { class: 'table table-sm align-middle mb-0' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Vencimento'), h('th', {}, 'Descrição'), h('th', { class: 'text-end' }, 'Valor'))),
        h('tbody', {}, cr.installments.map((i) => h('tr', {},
          h('td', { class: i.dueDate < todayStr() ? 'text-danger f-w-600' : '' }, fmtDate(i.dueDate)),
          h('td', {}, i.saleId ? h('a', { href: `/venda.html?id=${i.saleId}` }, i.description) : i.description),
          h('td', { class: 'text-end lf-num' }, fmtBRL(i.amountCents)))))))
      : h('p', { class: 'txt-secondary mb-0' }, 'Nenhuma conta em aberto.');

    box.replaceChildren(card('Crediário', h('div', {}, resumo, form, h('h6', { class: 'mb-2' }, 'Em aberto'), parcelas), situacao));
  };
  try {
    desenhar(await get(`/customers/${id}/credit`));
  } catch {
    return null; // sem o crédito, a ficha continua funcionando
  }
  return box;
}
