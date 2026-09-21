// Aberturas e fechamentos de caixa.
import { get } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, card, dataList, fmtBRL, h, input, paginator, refreshIcons, select, todayStr } from '../ui.js';

export default async function render({ content, branchId }) {
  const state = { status: '', from: '', to: todayStr(), page: 1, pageSize: 20, branchId };
  const lista = h('div', {});
  const rodape = h('div', {});

  const status = select([
    { value: '', label: 'Todas' }, { value: 'open', label: 'Abertas' }, { value: 'closed', label: 'Fechadas' },
  ], { class: 'form-select' });
  status.onchange = () => { state.status = status.value; state.page = 1; carregar(); };

  const de = input({ type: 'date', class: 'form-control' });
  const ate = input({ type: 'date', class: 'form-control', value: state.to });
  de.onchange = () => { state.from = de.value; carregar(); };
  ate.onchange = () => { state.to = ate.value; carregar(); };

  mount(content,
    pageTitle('Aberturas e fechamentos', h('a', { class: 'btn btn-outline-secondary', href: '/caixa.html' }, 'Caixa atual')),
    card(null, h('div', {},
      h('div', { class: 'row g-2 mb-3' },
        h('div', { class: 'col-6 col-md-2' }, status),
        h('div', { class: 'col-6 col-md-2' }, de),
        h('div', { class: 'col-6 col-md-2' }, ate)),
      lista, rodape)));

  async function carregar() {
    lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:120px' }));
    const data = await get('/cash/sessions', state);
    lista.replaceChildren(dataList({
      rows: data.rows,
      empty: 'Nenhuma sessão de caixa no período.',
      columns: [
        { label: 'Abertura', cell: (s) => s.openedAt },
        { label: 'Fechamento', cell: (s) => s.closedAt ?? '—' },
        { label: 'PDV', cell: (s) => `${s.register.name} · ${s.branch.name}` },
        { label: 'Operador', cell: (s) => s.operator?.name ?? '—' },
        { label: 'Vendas', className: 'text-end', cell: (s) => String(s.sales) },
        { label: 'Esperado', className: 'text-end', cell: (s) => s.expectedCents == null ? '—' : fmtBRL(s.expectedCents) },
        { label: 'Contado', className: 'text-end', cell: (s) => s.countedCents == null ? '—' : fmtBRL(s.countedCents) },
        {
          label: 'Diferença', className: 'text-end',
          cell: (s) => s.differenceCents == null ? '—' : h('span', {
            class: `badge text-bg-${s.differenceCents === 0 ? 'success' : 'danger'}`,
          }, fmtBRL(s.differenceCents)),
        },
        {
          label: 'Situação',
          cell: (s) => h('span', { class: `badge text-bg-${s.status === 'open' ? 'primary' : 'light'}` },
            s.status === 'open' ? 'Aberta' : 'Fechada'),
        },
        {
          label: '', className: 'text-end',
          cell: (s) => h('a', { class: 'btn btn-sm btn-outline-secondary', href: `/sessao.html?id=${s.id}` }, 'Abrir'),
        },
      ],
    }));
    rodape.replaceChildren(paginator(data, (p) => { state.page = p; carregar(); }));
    refreshIcons(content);
  }

  await carregar();
}
