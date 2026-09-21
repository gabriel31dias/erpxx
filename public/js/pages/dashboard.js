// Dashboard: indicadores do período, gráficos e alertas de estoque/caixa.
import { get } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, chart, emptyState, fmtBRL, fmtQty, h, icon, refreshIcons, select, statCard } from '../ui.js';

const PERIODOS = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'semana', label: 'Últimos 7 dias' },
  { value: 'mes', label: 'Este mês' },
  { value: 'mes_passado', label: 'Mês passado' },
  { value: 'ano', label: 'Este ano' },
];

export default async function render({ content, branchId, can }) {
  const state = { period: localStorage.getItem('lf.period') || 'mes' };
  const cards = h('div', { class: 'row' });
  const graficos = h('div', { class: 'row' });
  const alertas = h('div', { class: 'row' });

  const periodo = select(PERIODOS.map((p) => ({ ...p, selected: p.value === state.period })), { class: 'form-select' });
  periodo.onchange = () => {
    state.period = periodo.value;
    localStorage.setItem('lf.period', state.period);
    carregar();
  };

  mount(content,
    pageTitle('Dashboard',
      h('div', { style: 'min-width:190px' }, periodo),
      can('pdv.acessar') ? h('a', { class: 'btn btn-primary', href: '/pdv.html' }, icon('shopping-cart', 16), ' PDV') : null),
    cards, graficos, alertas);

  async function carregar() {
    cards.replaceChildren(h('div', { class: 'col-12' }, h('div', { class: 'lf-skeleton', style: 'height:90px' })));
    const [data, comp] = await Promise.all([
      get('/reports/dashboard', { period: state.period, branchId }),
      get('/reports/compare', { period: state.period, branchId }),
    ]);
    const c = data.cards;

    cards.replaceChildren(
      statCard('Vendas hoje', fmtBRL(c.todayCents), { hint: `${c.todayCount} venda(s)`, iconName: 'shopping-bag', color: '#7366ff' }),
      statCard('Faturamento do período', fmtBRL(c.revenueCents), {
        hint: comp.variationPct === null ? 'sem base anterior'
          : `${comp.variationPct >= 0 ? '+' : ''}${comp.variationPct}% vs período anterior`,
        iconName: 'trending-up', color: '#54ba4a',
      }),
      statCard('Ticket médio', fmtBRL(c.avgTicketCents), { hint: `${c.salesCount} venda(s)`, iconName: 'activity', color: '#16c7f9' }),
      statCard('Lucro estimado', fmtBRL(c.profitCents), { hint: 'faturamento − custo', iconName: 'award', color: '#ffaa05' }),
      statCard('Entradas', fmtBRL(c.incomeCents), { iconName: 'arrow-down-circle', color: '#54ba4a' }),
      statCard('Saídas', fmtBRL(c.expenseCents), { iconName: 'arrow-up-circle', color: '#fc4438' }),
      statCard('Saldo do período', fmtBRL(c.balanceCents), { iconName: 'dollar-sign', color: '#7366ff' }),
      statCard('Dinheiro em caixa', fmtBRL(c.cashOnHandCents), {
        hint: `${data.openSessions.length} caixa(s) aberto(s)`, iconName: 'briefcase', color: '#16c7f9',
      }),
    );

    const vendasBox = h('div', { style: 'min-height:260px' });
    const pagamentoBox = h('div', { style: 'min-height:260px' });
    const produtosBox = h('div', { style: 'min-height:260px' });

    graficos.replaceChildren(
      h('div', { class: 'col-12 col-xl-8' }, h('div', { class: 'card' },
        h('div', { class: 'card-header py-3' }, h('h5', { class: 'mb-0' }, 'Vendas por dia')),
        h('div', { class: 'card-body' }, vendasBox))),
      h('div', { class: 'col-12 col-xl-4' }, h('div', { class: 'card' },
        h('div', { class: 'card-header py-3' }, h('h5', { class: 'mb-0' }, 'Formas de pagamento')),
        h('div', { class: 'card-body' }, pagamentoBox))),
      h('div', { class: 'col-12 col-xl-6' }, h('div', { class: 'card' },
        h('div', { class: 'card-header py-3' }, h('h5', { class: 'mb-0' }, 'Produtos mais vendidos')),
        h('div', { class: 'card-body' }, produtosBox))),
      h('div', { class: 'col-12 col-xl-6' }, h('div', { class: 'card' },
        h('div', { class: 'card-header py-3 d-flex justify-content-between align-items-center' },
          h('h5', { class: 'mb-0' }, 'Estoque em alerta'),
          h('a', { class: 'btn btn-sm btn-outline-secondary', href: '/estoque.html?filter=baixo' }, 'Ver estoque')),
        h('div', { class: 'card-body p-0' }, data.lowStock.length
          ? h('div', { class: 'table-responsive' }, h('table', { class: 'table mb-0 align-middle' },
              h('tbody', {}, data.lowStock.map((p) => h('tr', {},
                h('td', {}, h('a', { href: `/produto.html?id=${p.id}` }, p.name)),
                h('td', { class: 'text-end' }, fmtQty(p.quantity, p.unit)),
                h('td', { class: 'text-end' }, h('span', {
                  class: `badge text-bg-${p.quantity <= 0 ? 'danger' : 'warning'}`,
                }, p.quantity <= 0 ? 'Sem estoque' : 'Baixo')))))))
          : emptyState('Nenhum produto em alerta.')))),
    );

    chart(vendasBox, {
      chart: { type: 'area', height: 260, toolbar: { show: false } },
      series: [{ name: 'Faturamento', data: data.charts.byDay.map((d) => (d.totalCents / 100).toFixed(2)) }],
      xaxis: { categories: data.charts.byDay.map((d) => d.date.slice(8) + '/' + d.date.slice(5, 7)) },
      colors: ['#7366ff'], dataLabels: { enabled: false }, stroke: { curve: 'smooth', width: 2 },
      yaxis: { labels: { formatter: (v) => `R$ ${Number(v).toFixed(0)}` } },
    });
    chart(pagamentoBox, {
      chart: { type: 'donut', height: 260 },
      series: data.charts.byPayment.map((p) => Number((p.totalCents / 100).toFixed(2))),
      labels: data.charts.byPayment.map((p) => p.name),
      colors: ['#7366ff', '#54ba4a', '#16c7f9', '#ffaa05', '#fc4438', '#6f42c1'],
      legend: { position: 'bottom' },
    });
    chart(produtosBox, {
      chart: { type: 'bar', height: 260, toolbar: { show: false } },
      plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
      series: [{ name: 'Quantidade', data: data.charts.topProducts.map((p) => p.quantity) }],
      xaxis: { categories: data.charts.topProducts.map((p) => p.name) },
      colors: ['#54ba4a'], dataLabels: { enabled: false },
    });

    alertas.replaceChildren(data.openSessions.length
      ? h('div', { class: 'col-12' }, h('div', { class: 'card' },
          h('div', { class: 'card-header py-3' }, h('h5', { class: 'mb-0' }, 'Caixas abertos')),
          h('div', { class: 'card-body p-0' }, h('div', { class: 'table-responsive' },
            h('table', { class: 'table mb-0 align-middle' },
              h('tbody', {}, data.openSessions.map((s) => h('tr', {},
                h('td', {}, s.register), h('td', {}, s.operator ?? '—'),
                h('td', {}, `desde ${s.openedAt.slice(11)}`),
                h('td', { class: 'text-end' },
                  h('a', { class: 'btn btn-sm btn-outline-secondary', href: `/sessao.html?id=${s.id}` }, 'Abrir'))))))))))
      : h('div', { class: 'd-none' }));

    refreshIcons(content);
  }

  await carregar();
}
