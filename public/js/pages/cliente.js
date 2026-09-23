// Ficha do cliente: cadastro + histórico de compras e indicadores.
import { get, patch, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount,
  card, field, fmtBRL, fmtDate, h, input, refreshIcons, select, statCard, textarea, toast,
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

  mount(content,
    pageTitle(id ? c.name : 'Novo cliente'),
    stats,
    card('Dados do cliente', form),
    historico);
  refreshIcons(content);
}
