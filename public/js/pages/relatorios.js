// Central de relatórios: vendas por dia/produto/categoria/operador/pagamento,
// produtos parados e estoque — com exportação CSV quando o plano permite.
import { get } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, card, chart, fmtBRL, fmtQty, h, icon, input, refreshIcons, select, statCard, toast, todayStr } from '../ui.js';

const AGRUPAR = [
  { value: 'day', label: 'Por dia' },
  { value: 'product', label: 'Por produto' },
  { value: 'category', label: 'Por categoria' },
  { value: 'operator', label: 'Por operador' },
  { value: 'payment', label: 'Por forma de pagamento' },
  { value: 'customer', label: 'Por cliente' },
  { value: 'branch', label: 'Por filial' },
];

export default async function render({ content, can, me, branchId }) {
  const state = {
    groupBy: 'day', from: `${todayStr().slice(0, 8)}01`, to: todayStr(), branchId,
  };
  const cards = h('div', { class: 'row' });
  const grafico = h('div', { style: 'min-height:280px' });
  const tabela = h('div', {});
  const parados = h('div', {});
  const podeExportar = can('relatorio.exportar') && me.company.plan.features.includes('export');

  const agrupar = select(AGRUPAR, { class: 'form-select' });
  agrupar.onchange = () => { state.groupBy = agrupar.value; carregar(); };

  const de = input({ type: 'date', class: 'form-control', value: state.from });
  const ate = input({ type: 'date', class: 'form-control', value: state.to });
  de.onchange = () => { state.from = de.value; carregar(); };
  ate.onchange = () => { state.to = ate.value; carregar(); };

  const exportar = h('button', { class: 'btn btn-outline-secondary' }, icon('download', 16), ' Exportar CSV');
  exportar.onclick = async () => {
    if (!podeExportar) return toast('A exportação está disponível a partir do plano Profissional.', 'warning');
    location.href = `/api/reports/export?type=sales&groupBy=${state.groupBy}&from=${state.from}&to=${state.to}`
      + (state.branchId ? `&branchId=${state.branchId}` : '');
  };

  mount(content,
    pageTitle('Relatórios',
      exportar,
      h('button', { class: 'btn btn-outline-secondary', onclick: () => window.print() }, icon('printer', 16), ' Imprimir')),
    h('div', { class: 'card lf-no-print' }, h('div', { class: 'card-body' },
      h('div', { class: 'row g-2' },
        h('div', { class: 'col-12 col-md-4' }, agrupar),
        h('div', { class: 'col-6 col-md-3' }, de),
        h('div', { class: 'col-6 col-md-3' }, ate)))),
    cards,
    card('Vendas', h('div', {}, grafico, tabela)),
    card('Produtos parados no período', parados));

  async function carregar() {
    tabela.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:160px' }));
    const [data, slow] = await Promise.all([
      get('/reports/sales', state),
      get('/reports/slow-movers', { from: state.from, to: state.to, branchId }),
    ]);

    cards.replaceChildren(
      statCard('Faturamento', fmtBRL(data.totals.totalCents), { iconName: 'trending-up' }),
      statCard('Custo', fmtBRL(data.totals.costCents), { iconName: 'package', color: '#ffaa05' }),
      statCard('Lucro estimado', fmtBRL(data.totals.profitCents), { iconName: 'award', color: '#54ba4a' }),
      statCard('Ticket médio', fmtBRL(data.totals.avgTicketCents), { hint: `${data.totals.count} venda(s)`, iconName: 'activity', color: '#16c7f9' }),
    );

    chart(grafico, {
      chart: { type: state.groupBy === 'day' ? 'line' : 'bar', height: 280, toolbar: { show: false } },
      plotOptions: { bar: { horizontal: state.groupBy !== 'day', borderRadius: 4 } },
      series: [{ name: 'Total', data: data.rows.slice(0, 20).map((r) => (r.totalCents / 100).toFixed(2)) }],
      xaxis: { categories: data.rows.slice(0, 20).map((r) => r.label) },
      colors: ['#7366ff'], dataLabels: { enabled: false },
    });

    tabela.replaceChildren(h('div', { class: 'table-responsive' }, h('table', { class: 'table align-middle mb-0' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Referência'), h('th', { class: 'text-end' }, 'Vendas'),
        h('th', { class: 'text-end' }, 'Quantidade'), h('th', { class: 'text-end' }, 'Total'),
        h('th', { class: 'text-end' }, 'Custo'), h('th', { class: 'text-end' }, 'Lucro'))),
      h('tbody', {}, data.rows.map((r) => h('tr', {},
        h('td', {}, r.label),
        h('td', { class: 'text-end' }, String(r.count)),
        h('td', { class: 'text-end' }, r.quantity ? fmtQty(r.quantity) : '—'),
        h('td', { class: 'text-end f-w-600' }, fmtBRL(r.totalCents)),
        h('td', { class: 'text-end' }, fmtBRL(r.costCents)),
        h('td', { class: 'text-end' }, fmtBRL(r.profitCents))))))));

    parados.replaceChildren(h('div', { class: 'table-responsive' }, h('table', { class: 'table align-middle mb-0' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Produto'), h('th', { class: 'text-end' }, 'Vendido'),
        h('th', { class: 'text-end' }, 'Faturado'), h('th', { class: 'text-end' }, 'Estoque'))),
      h('tbody', {}, slow.rows.slice(0, 25).map((p) => h('tr', {},
        h('td', {}, h('a', { href: `/produto.html?id=${p.id}` }, p.name)),
        h('td', { class: 'text-end' }, fmtQty(p.quantity, p.unit)),
        h('td', { class: 'text-end' }, fmtBRL(p.totalCents)),
        h('td', { class: 'text-end' }, fmtQty(p.stock, p.unit))))))));

    refreshIcons(content);
  }

  await carregar();
}
