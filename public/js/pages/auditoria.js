// Auditoria: quem fez o quê, quando e com quais dados.
import { get } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, card, dataList, h, input, modal, paginator, refreshIcons, select } from '../ui.js';

const ENTIDADES = ['Sale', 'Product', 'CashSession', 'FinanceEntry', 'User', 'Customer', 'Supplier',
  'StockEntry', 'Company', 'Branch', 'PaymentMethod', 'Subscription'];
const ACOES = ['create', 'update', 'delete', 'cancel', 'discount', 'price', 'stock', 'sangria',
  'suprimento', 'close', 'permission', 'login'];

export default async function render({ content }) {
  const state = { entity: '', action: '', from: '', to: '', page: 1, pageSize: 25 };
  const lista = h('div', {});
  const rodape = h('div', {});

  const entidade = select([{ value: '', label: 'Todas as entidades' },
    ...ENTIDADES.map((e) => ({ value: e, label: e }))], { class: 'form-select' });
  entidade.onchange = () => { state.entity = entidade.value; state.page = 1; carregar(); };

  const acao = select([{ value: '', label: 'Todas as ações' },
    ...ACOES.map((a) => ({ value: a, label: a }))], { class: 'form-select' });
  acao.onchange = () => { state.action = acao.value; state.page = 1; carregar(); };

  const de = input({ type: 'date', class: 'form-control' });
  const ate = input({ type: 'date', class: 'form-control' });
  de.onchange = () => { state.from = de.value; carregar(); };
  ate.onchange = () => { state.to = ate.value; carregar(); };

  mount(content,
    pageTitle('Auditoria'),
    card(null, h('div', {},
      h('div', { class: 'row g-2 mb-3' },
        h('div', { class: 'col-6 col-md-3' }, entidade),
        h('div', { class: 'col-6 col-md-3' }, acao),
        h('div', { class: 'col-6 col-md-2' }, de),
        h('div', { class: 'col-6 col-md-2' }, ate)),
      lista, rodape)));

  async function carregar() {
    lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:140px' }));
    const data = await get('/audit', state);
    lista.replaceChildren(dataList({
      rows: data.rows,
      empty: 'Nenhum registro de auditoria.',
      columns: [
        { label: 'Quando', cell: (r) => new Date(r.createdAt).toLocaleString('pt-BR') },
        { label: 'Usuário', cell: (r) => r.user?.name ?? 'sistema' },
        { label: 'Ação', cell: (r) => h('span', { class: 'badge text-bg-light' }, r.action) },
        { label: 'Entidade', cell: (r) => `${r.entity}${r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ''}` },
        { label: 'IP', cell: (r) => r.ip ?? '—' },
        {
          label: '', className: 'text-end',
          cell: (r) => h('button', {
            class: 'btn btn-sm btn-outline-secondary',
            onclick: () => modal({
              title: `${r.action} · ${r.entity}`,
              body: h('pre', { class: 'mb-0', style: 'white-space:pre-wrap' }, JSON.stringify(r.data, null, 2)),
            }),
          }, 'Detalhes'),
        },
      ],
    }));
    rodape.replaceChildren(paginator(data, (p) => { state.page = p; carregar(); }));
    refreshIcons(content);
  }

  await carregar();
}
