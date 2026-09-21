// Financeiro: contas a pagar/receber, entradas e saídas, fluxo por dia e categoria.
import { del, get, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount,
  card, chart, confirmAction, dataList, debounce, fmtBRL, h, icon, input, paginator, refreshIcons,
  select, statCard, toast, todayStr,
} from '../ui.js';

export default async function render({ content, can, branchId }) {
  const gerir = can('financeiro.gerenciar');
  const state = {
    type: '', status: '', by: 'due', q: '',
    from: `${todayStr().slice(0, 8)}01`, to: todayStr(),
    page: 1, pageSize: 20, branchId,
  };
  const cards = h('div', { class: 'row' });
  const grafico = h('div', { style: 'min-height:260px' });
  const categorias = h('div', {});
  const lista = h('div', {});
  const rodape = h('div', {});

  const tipo = select([
    { value: '', label: 'Receitas e despesas' },
    { value: 'RECEITA', label: 'Somente receitas' },
    { value: 'DESPESA', label: 'Somente despesas' },
  ], { class: 'form-select' });
  tipo.onchange = () => { state.type = tipo.value; state.page = 1; carregar(); };

  const situacao = select([
    { value: '', label: 'Todas as situações' },
    { value: 'pending', label: 'Em aberto' },
    { value: 'paid', label: 'Pagas/recebidas' },
    { value: 'cancelled', label: 'Canceladas' },
  ], { class: 'form-select' });
  situacao.onchange = () => { state.status = situacao.value; state.page = 1; carregar(); };

  const base = select([
    { value: 'due', label: 'Por vencimento' },
    { value: 'paid', label: 'Por pagamento' },
  ], { class: 'form-select' });
  base.onchange = () => { state.by = base.value; carregar(); };

  const de = input({ type: 'date', class: 'form-control', value: state.from });
  const ate = input({ type: 'date', class: 'form-control', value: state.to });
  de.onchange = () => { state.from = de.value; carregar(); };
  ate.onchange = () => { state.to = ate.value; carregar(); };

  const busca = input({ type: 'search', class: 'form-control', placeholder: 'Descrição' });
  busca.oninput = debounce(() => { state.q = busca.value; state.page = 1; carregar(); });

  mount(content,
    pageTitle('Financeiro',
      gerir ? h('a', { class: 'btn btn-outline-danger', href: '/lancamento.html?type=DESPESA' }, icon('minus', 16), ' Nova despesa') : null,
      gerir ? h('a', { class: 'btn btn-primary', href: '/lancamento.html?type=RECEITA' }, icon('plus', 16), ' Nova receita') : null),
    cards,
    h('div', { class: 'row' },
      h('div', { class: 'col-12 col-xl-8' }, card('Entradas e saídas por dia', grafico)),
      h('div', { class: 'col-12 col-xl-4' }, card('Por categoria', categorias))),
    card(null, h('div', {},
      h('div', { class: 'row g-2 mb-3' },
        h('div', { class: 'col-6 col-md-2' }, tipo),
        h('div', { class: 'col-6 col-md-2' }, situacao),
        h('div', { class: 'col-6 col-md-2' }, base),
        h('div', { class: 'col-6 col-md-2' }, de),
        h('div', { class: 'col-6 col-md-2' }, ate),
        h('div', { class: 'col-6 col-md-2' }, busca)),
      lista, rodape)));

  async function carregar() {
    lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:140px' }));
    const [data, fluxo] = await Promise.all([
      get('/finance/entries', state),
      get('/finance/cashflow', { from: state.from, to: state.to, branchId }),
    ]);
    const s = data.summary;

    cards.replaceChildren(
      statCard('Entradas (recebidas)', fmtBRL(s.receitaCents), { iconName: 'arrow-down-circle', color: '#54ba4a' }),
      statCard('Saídas (pagas)', fmtBRL(s.despesaCents), { iconName: 'arrow-up-circle', color: '#fc4438' }),
      statCard('Saldo', fmtBRL(s.saldoCents), { iconName: 'dollar-sign' }),
      statCard('Em aberto', `${fmtBRL(s.aReceberCents)} / ${fmtBRL(s.aPagarCents)}`,
        { hint: 'a receber / a pagar', iconName: 'clock', color: '#ffaa05' }),
    );

    chart(grafico, {
      chart: { type: 'bar', height: 260, stacked: false, toolbar: { show: false } },
      series: [
        { name: 'Entradas', data: fluxo.days.map((d) => (d.inCents / 100).toFixed(2)) },
        { name: 'Saídas', data: fluxo.days.map((d) => (d.outCents / 100).toFixed(2)) },
      ],
      xaxis: { categories: fluxo.days.map((d) => `${d.date.slice(8)}/${d.date.slice(5, 7)}`) },
      colors: ['#54ba4a', '#fc4438'], dataLabels: { enabled: false },
      plotOptions: { bar: { borderRadius: 3 } },
    });

    categorias.replaceChildren(fluxo.byCategory.length
      ? h('table', { class: 'table table-sm align-middle mb-0' }, h('tbody', {},
          fluxo.byCategory.slice(0, 10).map((c) => h('tr', {},
            h('td', {}, c.name, h('span', {
              class: `badge ms-2 text-bg-${c.type === 'RECEITA' ? 'success' : 'danger'}`,
            }, c.type === 'RECEITA' ? 'entrada' : 'saída')),
            h('td', { class: 'text-end f-w-600' }, fmtBRL(c.totalCents))))))
      : h('p', { class: 'txt-secondary mb-0' }, 'Sem lançamentos pagos no período.'));

    lista.replaceChildren(dataList({
      rows: data.rows,
      empty: 'Nenhum lançamento no período.',
      columns: [
        {
          label: 'Descrição',
          cell: (r) => h('div', {},
            h('a', { class: 'f-w-600', href: `/lancamento.html?id=${r.id}` }, r.description),
            h('small', { class: 'd-block txt-secondary' },
              [r.category?.name, r.supplier?.name, r.customer?.name].filter(Boolean).join(' · ') || '—')),
        },
        {
          label: 'Tipo',
          cell: (r) => h('span', { class: `badge text-bg-${r.type === 'RECEITA' ? 'success' : 'danger'}` },
            r.type === 'RECEITA' ? 'Receita' : 'Despesa'),
        },
        { label: 'Vencimento', cell: (r) => r.dueDate },
        { label: 'Pago em', cell: (r) => r.paidAt ?? '—' },
        { label: 'Valor', className: 'text-end', cell: (r) => h('strong', {}, fmtBRL(r.amountCents)) },
        {
          label: 'Situação',
          cell: (r) => h('span', {
            class: `badge text-bg-${r.status === 'paid' ? 'success' : r.status === 'cancelled' ? 'secondary' : r.overdue ? 'danger' : 'warning'}`,
          }, r.status === 'paid' ? 'Quitado' : r.status === 'cancelled' ? 'Cancelado' : r.overdue ? 'Vencido' : 'Em aberto'),
        },
        {
          label: '', className: 'text-end',
          cell: (r) => gerir ? h('div', { class: 'd-flex gap-2 justify-content-end' },
            r.status === 'pending' ? h('button', {
              class: 'btn btn-sm btn-outline-success',
              onclick: async () => {
                try {
                  await post(`/finance/entries/${r.id}/pay`, {});
                  toast(r.type === 'RECEITA' ? 'Recebimento registrado.' : 'Pagamento registrado.');
                  carregar();
                } catch (e) { toast(e.message, 'error'); }
              },
            }, r.type === 'RECEITA' ? 'Receber' : 'Pagar') : null,
            h('a', { class: 'btn btn-sm btn-outline-secondary', href: `/lancamento.html?id=${r.id}` }, 'Editar'),
            h('button', {
              class: 'btn btn-sm btn-outline-danger', 'aria-label': `Excluir ${r.description}`,
              onclick: async () => {
                if (!(await confirmAction(`Cancelar o lançamento "${r.description}"?`))) return;
                try {
                  await del(`/finance/entries/${r.id}`);
                  toast('Lançamento cancelado.');
                  carregar();
                } catch (e) { toast(e.message, 'error'); }
              },
            }, icon('trash-2', 14))) : null,
        },
      ],
    }));
    rodape.replaceChildren(paginator(data, (p) => { state.page = p; carregar(); }));
    refreshIcons(content);
  }

  await carregar();
}
