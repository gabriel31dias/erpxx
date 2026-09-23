// Vendas realizadas: filtros por período, status, operador e forma de pagamento.
import { get } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount,
  card, dataList, debounce, fmtBRL, fmtDate, h, icon, input, paginator, refreshIcons, select, statCard,
  todayStr,
} from '../ui.js';

const STATUS = {
  COMPLETED: ['Concluída', 'success'],
  CANCELLED: ['Cancelada', 'danger'],
  REFUNDED: ['Devolvida', 'warning'],
  OPEN: ['Aberta', 'secondary'],
};

export default async function render({ content, can, branchId }) {
  const state = {
    from: todayStr().slice(0, 8) + '01', to: todayStr(), status: '', q: '',
    paymentMethodId: '', paid: '', page: 1, pageSize: 20, branchId,
  };
  const cards = h('div', { class: 'row' });
  const lista = h('div', {});
  const rodape = h('div', {});

  const { rows: metodos } = await get('/company/payment-methods');

  const de = input({ type: 'date', class: 'form-control', value: state.from });
  const ate = input({ type: 'date', class: 'form-control', value: state.to });
  de.onchange = () => { state.from = de.value; state.page = 1; carregar(); };
  ate.onchange = () => { state.to = ate.value; state.page = 1; carregar(); };

  const status = select([
    { value: '', label: 'Todas' },
    { value: 'COMPLETED', label: 'Concluídas' },
    { value: 'CANCELLED', label: 'Canceladas' },
  ], { class: 'form-select' });
  status.onchange = () => { state.status = status.value; state.page = 1; carregar(); };

  const metodo = select([{ value: '', label: 'Qualquer pagamento' },
    ...metodos.map((m) => ({ value: m.id, label: m.name }))], { class: 'form-select' });
  metodo.onchange = () => { state.paymentMethodId = metodo.value; state.page = 1; carregar(); };

  const pago = select([
    { value: '', label: 'Pagas e não pagas' },
    { value: 'no', label: 'Não pagas' },
    { value: 'yes', label: 'Pagas' },
  ], { class: 'form-select' });
  pago.onchange = () => { state.paid = pago.value; state.page = 1; carregar(); };

  const busca = input({ type: 'search', class: 'form-control', placeholder: 'Número, cliente ou produto' });
  busca.oninput = debounce(() => { state.q = busca.value; state.page = 1; carregar(); });

  mount(content,
    pageTitle('Vendas',
      can('pdv.acessar') ? h('a', { class: 'btn btn-primary', href: '/pdv.html' }, icon('shopping-cart', 16), ' PDV') : null),
    cards,
    card(null, h('div', {},
      h('div', { class: 'row g-2 mb-3' },
        h('div', { class: 'col-6 col-md-2' }, de),
        h('div', { class: 'col-6 col-md-2' }, ate),
        h('div', { class: 'col-6 col-md-2' }, status),
        h('div', { class: 'col-6 col-md-2' }, metodo),
        h('div', { class: 'col-6 col-md-2' }, pago),
        h('div', { class: 'col-12 col-md-2' }, busca)),
      lista, rodape)));

  async function carregar() {
    lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:140px' }));
    const data = await get('/sales', state);
    cards.replaceChildren(
      statCard('Faturamento', fmtBRL(data.summary.totalCents), { iconName: 'trending-up' }),
      statCard('Custo', fmtBRL(data.summary.costCents), { iconName: 'package', color: '#ffaa05' }),
      statCard('Lucro estimado', fmtBRL(data.summary.profitCents), { iconName: 'award', color: '#54ba4a' }),
      statCard('Vendas', String(data.total), { iconName: 'file-text', color: '#16c7f9' }),
      statCard('A receber (não pagas)', fmtBRL(data.summary.unpaidCents), {
        iconName: 'clock', color: '#fc4438', hint: `${data.summary.unpaidCount} venda(s)`,
      }),
    );

    lista.replaceChildren(dataList({
      rows: data.rows,
      empty: 'Nenhuma venda no período.',
      columns: [
        { label: 'Nº', cell: (s) => h('a', { class: 'f-w-600', href: `/venda.html?id=${s.id}` }, `#${s.number}`) },
        { label: 'Data', cell: (s) => s.soldAt },
        { label: 'Cliente', cell: (s) => s.customer?.name ?? 'Não identificado' },
        { label: 'Operador', cell: (s) => s.operator?.name ?? (s.seller ? `${s.seller.name} (externo)` : '—') },
        { label: 'Pagamento', cell: (s) => s.payments.map((p) => p.methodName).join(', ') },
        { label: 'Itens', className: 'text-end', cell: (s) => String(s.items.length) },
        { label: 'Total', className: 'text-end', cell: (s) => h('strong', {}, fmtBRL(s.totalCents)) },
        {
          label: 'Situação',
          cell: (s) => h('div', { class: 'd-flex flex-wrap gap-1' },
            h('span', { class: `badge text-bg-${STATUS[s.status]?.[1] ?? 'light'}` }, STATUS[s.status]?.[0] ?? s.status),
            s.paymentStatus === 'unpaid'
              ? h('span', { class: 'badge text-bg-warning', title: s.dueDate ? `Vence em ${fmtDate(s.dueDate)}` : '' },
                `Não paga${s.dueDate ? ` · vence ${fmtDate(s.dueDate)}` : ''}`)
              : null),
        },
        {
          label: '', className: 'text-end',
          cell: (s) => h('a', { class: 'btn btn-sm btn-outline-secondary', href: `/venda.html?id=${s.id}` }, 'Abrir'),
        },
      ],
    }));
    rodape.replaceChildren(paginator(data, (p) => { state.page = p; carregar(); }));
    refreshIcons(content);
  }

  await carregar();
}
