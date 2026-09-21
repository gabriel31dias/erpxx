// Bancos e fluxo: contas bancárias/caixa, extrato + conciliação, DRE gerencial,
// fluxo de caixa projetado e centros de custo. Consome /api/finance/*.
import { get, post, patch, del } from '../api.js';
import { pageTitle } from '../shell.js';
import {
  card, centsToInput, chart, confirmAction, dataList, field, fmtBRL, h, icon, input, modal,
  moneyToCents, mount, paginator, refreshIcons, select, statCard, toast,
} from '../ui.js';

const ABAS = [
  { key: 'contas', label: 'Contas' },
  { key: 'conciliacao', label: 'Conciliação' },
  { key: 'dre', label: 'DRE' },
  { key: 'fluxo', label: 'Fluxo projetado' },
  { key: 'centros', label: 'Centros de custo' },
];
const TIPOS = [
  ['corrente', 'Conta corrente'], ['poupanca', 'Poupança'], ['caixa', 'Caixa'],
  ['carteira', 'Carteira'], ['aplicacao', 'Aplicação'],
];
const tipoLabel = (t) => (TIPOS.find(([v]) => v === t) || [, t])[1];

export default async function render({ content, can }) {
  const params = new URLSearchParams(location.search);
  const aba = ABAS.some((a) => a.key === params.get('tab')) ? params.get('tab') : 'contas';
  const gerir = can('financeiro.gerenciar');

  const corpo = h('div', {});
  const abas = h('ul', { class: 'nav nav-tabs mb-3' }, ABAS.map((a) => h('li', { class: 'nav-item' },
    h('a', { class: `nav-link${a.key === aba ? ' active' : ''}`, href: `/bancos.html?tab=${a.key}` }, a.label))));

  mount(content, pageTitle('Bancos e fluxo'), card(null, h('div', {}, abas, corpo)));

  const dre = { period: 'mes', regime: 'caixa' };

  // ---------------- Contas ----------------
  async function contas() {
    corpo.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:200px' }));
    const data = await get('/finance/bank-accounts');
    const novo = gerir ? h('button', { class: 'btn btn-primary btn-sm', onclick: () => formConta() }, icon('plus', 16), ' Nova conta') : null;
    corpo.replaceChildren(
      h('div', { class: 'row mb-3' },
        statCard('Saldo total', fmtBRL(data.totalCents), { iconName: 'dollar-sign', col: 'col-12 col-md-4' })),
      h('div', { class: 'd-flex justify-content-between align-items-center mb-2' },
        h('strong', {}, 'Contas e saldos'), novo),
      dataList({
        rows: data.rows,
        empty: 'Nenhuma conta cadastrada.',
        emptyAction: novo,
        columns: [
          { label: 'Conta', cell: (a) => h('div', {}, h('strong', {}, a.name),
            h('small', { class: 'd-block txt-secondary' }, `${tipoLabel(a.type)}${a.bank ? ' · ' + a.bank : ''}${a.active ? '' : ' · inativa'}`)) },
          { label: 'Saldo inicial', className: 'text-end', cell: (a) => fmtBRL(a.openingCents) },
          { label: 'Saldo atual', className: 'text-end', cell: (a) => h('strong', { class: a.balanceCents < 0 ? 'text-danger' : '' }, fmtBRL(a.balanceCents)) },
          {
            label: '', className: 'text-end', cell: (a) => h('div', { class: 'd-flex gap-1 justify-content-end' },
              h('a', { class: 'btn btn-sm btn-outline-secondary', href: `/bancos.html?tab=conciliacao&acc=${a.id}` }, 'Extrato'),
              gerir ? h('button', { class: 'btn btn-sm btn-outline-secondary', onclick: () => formConta(a) }, 'Editar') : null),
          },
        ],
      }));
  }

  function formConta(a = null) {
    const f = {
      name: input({ value: a?.name ?? '' }),
      type: select(TIPOS.map(([v, l]) => ({ value: v, label: l, selected: v === (a?.type ?? 'corrente') })), { class: 'form-select' }),
      bank: input({ value: a?.bank ?? '' }),
      agency: input({ value: a?.agency ?? '' }),
      account: input({ value: a?.account ?? '' }),
      opening: input({ inputmode: 'decimal', value: centsToInput(a?.openingCents ?? 0) }),
      active: select([{ value: 'true', label: 'Ativa', selected: a?.active !== false }, { value: 'false', label: 'Inativa', selected: a?.active === false }], { class: 'form-select' }),
    };
    const salvar = h('button', { class: 'btn btn-primary' }, 'Salvar');
    const m = modal({
      title: a ? 'Editar conta' : 'Nova conta',
      body: h('div', { class: 'row g-3' },
        field('Nome', f.name, { col: 'col-12 col-md-8' }),
        field('Tipo', f.type, { col: 'col-12 col-md-4' }),
        field('Banco', f.bank, { col: 'col-12 col-md-4' }),
        field('Agência', f.agency, { col: 'col-6 col-md-4' }),
        field('Conta', f.account, { col: 'col-6 col-md-4' }),
        field('Saldo inicial (R$)', f.opening, { col: 'col-6 col-md-6' }),
        field('Situação', f.active, { col: 'col-6 col-md-6' })),
      footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar'), salvar],
    });
    salvar.onclick = async () => {
      const body = {
        name: f.name.value.trim(), type: f.type.value, bank: f.bank.value.trim() || undefined,
        agency: f.agency.value.trim() || undefined, account: f.account.value.trim() || undefined,
        openingCents: moneyToCents(f.opening.value), active: f.active.value === 'true',
      };
      try {
        if (a) await patch(`/finance/bank-accounts/${a.id}`, body); else await post('/finance/bank-accounts', body);
        m.close(); toast('Conta salva.'); contas();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  // ---------------- Conciliação / extrato ----------------
  async function conciliacao() {
    const { rows: accs } = await get('/finance/bank-accounts');
    if (!accs.length) return corpo.replaceChildren(card(null, 'Cadastre uma conta na aba Contas primeiro.'));
    const accId = params.get('acc') && accs.some((a) => a.id === params.get('acc')) ? params.get('acc') : accs[0].id;
    const seletor = select(accs.map((a) => ({ value: a.id, label: `${a.name} · ${fmtBRL(a.balanceCents)}`, selected: a.id === accId })), { class: 'form-select' });
    seletor.onchange = () => { location.href = `/bancos.html?tab=conciliacao&acc=${seletor.value}`; };
    const addBtn = gerir ? h('button', { class: 'btn btn-outline-primary btn-sm', onclick: () => formLinha(accId) }, icon('plus', 16), ' Lançar no extrato') : null;

    const lista = h('div', {});
    const rodape = h('div', {});
    corpo.replaceChildren(
      h('div', { class: 'row g-2 mb-3 align-items-end' },
        h('div', { class: 'col-12 col-md-6' }, field('Conta', seletor, { col: 'col-12' })),
        h('div', { class: 'col-12 col-md-6 text-md-end' }, addBtn)),
      lista, rodape);

    const state = { page: 1, pageSize: 20 };
    async function carregar() {
      lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:160px' }));
      const data = await get(`/finance/bank-accounts/${accId}/transactions`, state);
      lista.replaceChildren(
        h('p', { class: 'txt-secondary mb-2' }, `Saldo da conta: `, h('strong', {}, fmtBRL(data.balanceCents))),
        dataList({
          rows: data.rows,
          empty: 'Sem movimentos nesta conta.',
          columns: [
            { label: 'Data', cell: (t) => t.date },
            { label: 'Descrição', cell: (t) => h('div', {}, t.description,
              t.financeEntry ? h('small', { class: 'd-block txt-secondary' }, 'baixa: ' + t.financeEntry.description) : null) },
            { label: 'Valor', className: 'text-end', cell: (t) => h('strong', { class: t.amountCents < 0 ? 'text-danger' : 'text-success' }, fmtBRL(t.amountCents)) },
            { label: 'Conciliado', cell: (t) => h('span', { class: `badge ${t.reconciled ? 'text-bg-success' : 'text-bg-secondary'}` }, t.reconciled ? 'sim' : 'não') },
            {
              label: '', className: 'text-end', cell: (t) => gerir ? h('div', { class: 'd-flex gap-1 justify-content-end' },
                t.reconciled
                  ? h('button', { class: 'btn btn-sm btn-outline-secondary', onclick: () => desconciliar(t) }, 'Desfazer')
                  : h('button', { class: 'btn btn-sm btn-outline-primary', onclick: () => conciliar(t) }, 'Conciliar'),
                t.source === 'manual' ? h('button', { class: 'btn btn-sm btn-outline-danger', onclick: () => removerLinha(t) }, '×') : null) : null,
            },
          ],
        }));
      rodape.replaceChildren(paginator(data, (p) => { state.page = p; carregar(); }));
      refreshIcons(content);
    }
    async function desconciliar(t) { try { await post(`/finance/bank-transactions/${t.id}/unreconcile`, {}); toast('Conciliação desfeita.'); carregar(); } catch (e) { toast(e.message, 'error'); } }
    async function removerLinha(t) { if (!await confirmAction('Remover esta linha do extrato?')) return; try { await del(`/finance/bank-transactions/${t.id}`); toast('Removido.'); carregar(); } catch (e) { toast(e.message, 'error'); } }
    async function conciliar(t) {
      // busca lançamentos pendentes do mesmo sinal para vincular
      const tipo = t.amountCents >= 0 ? 'RECEITA' : 'DESPESA';
      const { rows } = await get('/finance/entries', { status: 'pending', type: tipo, pageSize: 50 });
      if (!rows.length) return toast('Nenhum lançamento pendente para conciliar.', 'warning');
      const sel = select(rows.map((e) => ({ value: e.id, label: `${e.dueDate} · ${e.description} · ${fmtBRL(e.amountCents)}` })), { class: 'form-select' });
      const ok = h('button', { class: 'btn btn-primary' }, 'Conciliar');
      const m = modal({ title: 'Conciliar movimento', body: h('div', {}, h('p', {}, `${t.description} · ${fmtBRL(t.amountCents)}`), field('Lançamento', sel, { col: 'col-12' })), footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar'), ok] });
      ok.onclick = async () => { try { await post(`/finance/bank-transactions/${t.id}/reconcile`, { financeEntryId: sel.value }); m.close(); toast('Conciliado.'); carregar(); } catch (e) { toast(e.message, 'error'); } };
    }
    await carregar();

    function formLinha(id) {
      const f = { date: input({ type: 'date' }), desc: input({}), valor: input({ inputmode: 'decimal', placeholder: '0,00' }), sinal: select([{ value: '1', label: 'Entrada (crédito)' }, { value: '-1', label: 'Saída (débito)' }], { class: 'form-select' }) };
      const salvar = h('button', { class: 'btn btn-primary' }, 'Lançar');
      const m = modal({
        title: 'Lançar no extrato',
        body: h('div', { class: 'row g-3' },
          field('Data', f.date, { col: 'col-6' }), field('Tipo', f.sinal, { col: 'col-6' }),
          field('Descrição', f.desc, { col: 'col-12' }), field('Valor (R$)', f.valor, { col: 'col-6' })),
        footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar'), salvar],
      });
      salvar.onclick = async () => {
        const amount = moneyToCents(f.valor.value) * Number(f.sinal.value);
        try { await post(`/finance/bank-accounts/${id}/transactions`, { date: f.date.value, description: f.desc.value.trim(), amountCents: amount }); m.close(); toast('Lançado.'); carregar(); } catch (e) { toast(e.message, 'error'); }
      };
    }
  }

  // ---------------- DRE ----------------
  async function dreTab() {
    const periodo = select([['mes', 'Este mês'], ['mes_anterior', 'Mês anterior'], ['ano', 'Este ano']].map(([v, l]) => ({ value: v, label: l, selected: v === dre.period })), { class: 'form-select' });
    const regime = select([['caixa', 'Caixa (pagamento)'], ['competencia', 'Competência (vencimento)']].map(([v, l]) => ({ value: v, label: l, selected: v === dre.regime })), { class: 'form-select' });
    periodo.onchange = () => { dre.period = periodo.value; carregar(); };
    regime.onchange = () => { dre.regime = regime.value; carregar(); };
    const alvo = h('div', {});
    corpo.replaceChildren(
      h('div', { class: 'row g-2 mb-3' },
        h('div', { class: 'col-6 col-md-3' }, field('Período', periodo, { col: 'col-12' })),
        h('div', { class: 'col-6 col-md-3' }, field('Regime', regime, { col: 'col-12' }))),
      alvo);
    async function carregar() {
      alvo.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:220px' }));
      const d = await get('/finance/dre', { period: dre.period, regime: dre.regime });
      const bloco = (titulo, linhas, total, cor) => h('div', { class: 'col-12 col-lg-6' }, card(titulo,
        h('div', { class: 'table-responsive' }, h('table', { class: 'table mb-0' },
          h('tbody', {}, [
            ...linhas.map((l) => h('tr', {}, h('td', {}, l.name), h('td', { class: 'text-end' }, fmtBRL(l.totalCents)))),
            h('tr', { class: 'fw-bold' }, h('td', {}, 'Total'), h('td', { class: `text-end ${cor}` }, fmtBRL(total))),
          ])))));
      alvo.replaceChildren(
        h('div', { class: 'row mb-3' },
          statCard('Receitas', fmtBRL(d.totals.receitasCents), { iconName: 'arrow-down-circle', color: '#22c55e' }),
          statCard('Despesas', fmtBRL(d.totals.despesasCents), { iconName: 'arrow-up-circle', color: '#ef4444' }),
          statCard('Resultado', fmtBRL(d.totals.resultadoCents), { iconName: 'activity', color: d.totals.resultadoCents >= 0 ? '#22c55e' : '#ef4444', col: 'col-12 col-xl-6' })),
        h('h6', { class: 'txt-secondary' }, 'Por categoria'),
        h('div', { class: 'row' },
          bloco('Receitas', d.porCategoria.receitas, d.totals.receitasCents, 'text-success'),
          bloco('Despesas', d.porCategoria.despesas, d.totals.despesasCents, 'text-danger')),
        h('h6', { class: 'txt-secondary mt-2' }, 'Por centro de custo'),
        h('div', { class: 'row' },
          bloco('Receitas', d.porCentroDeCusto.receitas, d.totals.receitasCents, 'text-success'),
          bloco('Despesas', d.porCentroDeCusto.despesas, d.totals.despesasCents, 'text-danger')));
    }
    await carregar();
  }

  // ---------------- Fluxo projetado ----------------
  async function fluxo() {
    corpo.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:280px' }));
    const d = await get('/finance/projection', { days: 90 });
    const grafico = h('div', { style: 'min-height:280px' });
    let acumulado = d.saldoAtualCents;
    corpo.replaceChildren(
      h('div', { class: 'row mb-3' },
        statCard('Saldo atual', fmtBRL(d.saldoAtualCents), { iconName: 'dollar-sign' }),
        statCard('A receber (90d)', fmtBRL(d.aReceberCents), { iconName: 'arrow-down-circle', color: '#22c55e' }),
        statCard('A pagar (90d)', fmtBRL(d.aPagarCents), { iconName: 'arrow-up-circle', color: '#ef4444' }),
        statCard('Saldo projetado', fmtBRL(d.saldoProjetadoCents), { iconName: 'trending-up', color: d.saldoProjetadoCents >= 0 ? '#22c55e' : '#ef4444' })),
      card('Projeção de saldo (próximos 90 dias)', grafico),
      card('Movimentos previstos', dataList({
        rows: d.dias,
        empty: 'Nada previsto no período.',
        columns: [
          { label: 'Data', cell: (r) => r.date },
          { label: 'Entradas', className: 'text-end', cell: (r) => h('span', { class: 'text-success' }, fmtBRL(r.inCents)) },
          { label: 'Saídas', className: 'text-end', cell: (r) => h('span', { class: 'text-danger' }, fmtBRL(r.outCents)) },
          { label: 'Saldo projetado', className: 'text-end', cell: (r) => h('strong', { class: r.saldoProjetadoCents < 0 ? 'text-danger' : '' }, fmtBRL(r.saldoProjetadoCents)) },
        ],
      })));
    chart(grafico, {
      chart: { type: 'area', height: 280, toolbar: { show: false } },
      series: [{ name: 'Saldo projetado', data: d.dias.map((r) => [new Date(r.date).getTime(), Math.round(r.saldoProjetadoCents / 100)]) }],
      xaxis: { type: 'datetime' },
      yaxis: { labels: { formatter: (v) => 'R$ ' + v.toLocaleString('pt-BR') } },
      dataLabels: { enabled: false }, stroke: { curve: 'stepline', width: 2 },
      annotations: { yaxis: [{ y: 0, borderColor: '#ef4444' }] },
    });
    void acumulado;
  }

  // ---------------- Centros de custo ----------------
  async function centros() {
    corpo.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:160px' }));
    const { rows } = await get('/finance/cost-centers');
    const novo = gerir ? h('button', { class: 'btn btn-primary btn-sm', onclick: () => formCentro() }, icon('plus', 16), ' Novo centro') : null;
    corpo.replaceChildren(
      h('div', { class: 'd-flex justify-content-between align-items-center mb-2' }, h('strong', {}, 'Centros de custo'), novo),
      dataList({
      rows,
      empty: 'Nenhum centro de custo.',
      emptyAction: novo,
      columns: [
        { label: 'Nome', cell: (c) => h('span', {}, c.name, c.active ? null : h('small', { class: 'txt-secondary' }, ' · inativo')) },
        { label: '', className: 'text-end', cell: (c) => gerir ? h('div', { class: 'd-flex gap-1 justify-content-end' },
          h('button', { class: 'btn btn-sm btn-outline-secondary', onclick: () => formCentro(c) }, 'Editar'),
          h('button', { class: 'btn btn-sm btn-outline-danger', onclick: () => removerCentro(c) }, '×')) : null },
      ],
    }));
    async function removerCentro(c) { if (!await confirmAction(`Remover o centro "${c.name}"?`)) return; try { await del(`/finance/cost-centers/${c.id}`); toast('Removido.'); centros(); } catch (e) { toast(e.message, 'error'); } }
    function formCentro(c = null) {
      const nome = input({ value: c?.name ?? '' });
      const salvar = h('button', { class: 'btn btn-primary' }, 'Salvar');
      const m = modal({ title: c ? 'Editar centro' : 'Novo centro de custo', body: field('Nome', nome, { col: 'col-12' }), footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar'), salvar] });
      salvar.onclick = async () => { try { if (c) await patch(`/finance/cost-centers/${c.id}`, { name: nome.value.trim() }); else await post('/finance/cost-centers', { name: nome.value.trim() }); m.close(); toast('Salvo.'); centros(); } catch (e) { toast(e.message, 'error'); } };
    }
  }

  await { contas, conciliacao, dre: dreTab, fluxo, centros }[aba]();
  refreshIcons(content);
}
