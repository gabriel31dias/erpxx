// Lançamento financeiro: conta a pagar/receber, despesa ou receita (com parcelas).
import { get, novaChave, patch, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount,
  card, centsToInput, confirmAction, field, h, input, modal, moneyToCents, refreshIcons, select,
  textarea, toast, todayStr,
} from '../ui.js';

export default async function render({ content, can, branchId }) {
  if (!can('financeiro.gerenciar')) return mount(content, card(null, 'Sem permissão.'));
  const params = new URLSearchParams(location.search);
  const id = params.get('id');

  const [{ rows: categorias }, { rows: metodos }, { rows: fornecedores }, { rows: clientes }, { rows: contas }, { rows: centros }] = await Promise.all([
    get('/finance/categories'), get('/company/payment-methods'),
    get('/suppliers', { pageSize: 100 }), get('/customers', { pageSize: 100 }),
    get('/finance/bank-accounts'), get('/finance/cost-centers'),
  ]);

  const entry = id ? await get(`/finance/entries/${id}`) : {};
  const tipoInicial = entry.type || params.get('type') || 'DESPESA';
  const info = entry.instrumentInfo ? (() => { try { return JSON.parse(entry.instrumentInfo); } catch { return {}; } })() : {};
  const INSTRUMENTOS = [['', 'Não informado'], ['dinheiro', 'Dinheiro'], ['pix', 'PIX'], ['boleto', 'Boleto'], ['cheque', 'Cheque'], ['transferencia', 'Transferência'], ['cartao', 'Cartão'], ['outro', 'Outro']];

  const f = {
    type: select([
      { value: 'DESPESA', label: 'Despesa (saída)', selected: tipoInicial === 'DESPESA' },
      { value: 'RECEITA', label: 'Receita (entrada)', selected: tipoInicial === 'RECEITA' },
    ]),
    description: input({ value: entry.description ?? '', required: true }),
    amount: input({ inputmode: 'decimal', value: centsToInput(entry.amountCents ?? 0) }),
    dueDate: input({ type: 'date', value: entry.dueDate ?? todayStr() }),
    paidAt: input({ type: 'date', value: entry.paidAt ?? '' }),
    categoryId: select([{ value: '', label: 'Sem categoria' }]),
    paymentMethodId: select([{ value: '', label: 'Não informado' },
      ...metodos.map((m) => ({ value: m.id, label: m.name, selected: m.id === entry.paymentMethodId }))]),
    supplierId: select([{ value: '', label: 'Sem fornecedor' },
      ...fornecedores.map((s) => ({ value: s.id, label: s.name, selected: s.id === entry.supplierId }))]),
    customerId: select([{ value: '', label: 'Sem cliente' },
      ...clientes.map((c) => ({ value: c.id, label: c.name, selected: c.id === entry.customerId }))]),
    repeat: input({ type: 'number', min: '1', max: '60', value: '1' }),
    installments: input({ type: 'number', min: '1', max: '60', value: '1' }),
    instrument: select(INSTRUMENTOS.map(([v, l]) => ({ value: v, label: l, selected: v === (entry.instrument ?? '') }))),
    bankAccountId: select([{ value: '', label: 'Não informado' },
      ...contas.map((a) => ({ value: a.id, label: a.name, selected: a.id === entry.bankAccountId }))]),
    costCenterId: select([{ value: '', label: 'Sem centro de custo' },
      ...centros.map((c) => ({ value: c.id, label: c.name, selected: c.id === entry.costCenterId }))]),
    notes: textarea({ value: entry.notes ?? '' }),
  };

  // detalhe do instrumento (boleto/cheque) — vira instrumentInfo
  const detInst = { linhaDigitavel: input({ value: info.linhaDigitavel ?? '', placeholder: 'Linha digitável' }),
    banco: input({ value: info.banco ?? '', placeholder: 'Banco' }),
    numero: input({ value: info.numero ?? '', placeholder: 'Nº do cheque' }),
    bomPara: input({ type: 'date', value: info.bomPara ?? '' }) };
  const detalheInstrumento = h('div', { class: 'col-12' });
  const renderDetalhe = () => {
    const v = f.instrument.value;
    if (v === 'boleto') detalheInstrumento.replaceChildren(field('Linha digitável do boleto', detInst.linhaDigitavel, { col: 'col-12' }));
    else if (v === 'cheque') detalheInstrumento.replaceChildren(h('div', { class: 'row g-2' },
      field('Banco', detInst.banco, { col: 'col-6 col-md-4' }), field('Nº do cheque', detInst.numero, { col: 'col-6 col-md-4' }), field('Bom para', detInst.bomPara, { col: 'col-6 col-md-4' })));
    else detalheInstrumento.replaceChildren();
  };
  f.instrument.onchange = renderDetalhe;
  const instrumentInfoBody = () => {
    const v = f.instrument.value;
    if (v === 'boleto' && detInst.linhaDigitavel.value.trim()) return { linhaDigitavel: detInst.linhaDigitavel.value.trim() };
    if (v === 'cheque' && (detInst.banco.value || detInst.numero.value || detInst.bomPara.value)) {
      return { banco: detInst.banco.value.trim() || undefined, numero: detInst.numero.value.trim() || undefined, bomPara: detInst.bomPara.value || undefined };
    }
    return undefined;
  };

  const preencherCategorias = () => {
    const doTipo = categorias.filter((c) => c.type === f.type.value);
    f.categoryId.replaceChildren(
      h('option', { value: '' }, 'Sem categoria'),
      ...doTipo.map((c) => h('option', { value: c.id, selected: c.id === entry.categoryId }, c.name)));
  };
  f.type.onchange = preencherCategorias;
  preencherCategorias();
  renderDetalhe();

  const salvar = h('button', { class: 'btn btn-primary', type: 'submit' }, id ? 'Salvar' : 'Lançar');
  const form = h('form', { class: 'row g-3' },
    field('Tipo', f.type, { col: 'col-12 col-md-3' }),
    field('Descrição', f.description, { col: 'col-12 col-md-6' }),
    field('Valor (R$)', f.amount, { col: 'col-6 col-md-3' }),
    field('Vencimento', f.dueDate, { col: 'col-6 col-md-3' }),
    field('Pago/recebido em', f.paidAt, { col: 'col-6 col-md-3', help: 'Deixe vazio para "em aberto".' }),
    field('Categoria', f.categoryId, { col: 'col-6 col-md-3' }),
    field('Forma de pagamento', f.paymentMethodId, { col: 'col-6 col-md-3' }),
    field('Fornecedor', f.supplierId, { col: 'col-6 col-md-4' }),
    field('Cliente', f.customerId, { col: 'col-6 col-md-4' }),
    field('Centro de custo', f.costCenterId, { col: 'col-6 col-md-4' }),
    field('Instrumento', f.instrument, { col: 'col-6 col-md-4' }),
    field('Conta bancária / caixa', f.bankAccountId, { col: 'col-6 col-md-4', help: 'Ao informar data de pagamento, gera o movimento nesta conta.' }),
    detalheInstrumento,
    id ? null : field('Parcelar o total em (x)', f.installments, { col: 'col-6 col-md-3', help: 'Divide o valor em N parcelas mensais.' }),
    id ? null : field('Repetir por (meses)', f.repeat, { col: 'col-6 col-md-3', help: 'Mesmo valor todo mês (conta fixa).' }),
    field('Observações', f.notes, { col: 'col-12' }),
    h('div', { class: 'col-12 d-flex gap-2 justify-content-end' },
      h('a', { class: 'btn btn-light', href: '/financeiro.html' }, 'Voltar'),
      salvar));

  form.onsubmit = async (e) => {
    e.preventDefault();
    salvar.disabled = true;
    try {
      const body = {
        type: f.type.value,
        description: f.description.value.trim(),
        amountCents: moneyToCents(f.amount.value),
        dueDate: f.dueDate.value,
        paidAt: f.paidAt.value || undefined,
        categoryId: f.categoryId.value || undefined,
        paymentMethodId: f.paymentMethodId.value || undefined,
        supplierId: f.supplierId.value || undefined,
        customerId: f.customerId.value || undefined,
        costCenterId: f.costCenterId.value || undefined,
        bankAccountId: f.bankAccountId.value || undefined,
        instrument: f.instrument.value || undefined,
        instrumentInfo: instrumentInfoBody(),
        branchId: branchId || undefined,
        notes: f.notes.value.trim() || undefined,
        ...(id ? {} : (() => {
          const parc = Number(f.installments.value) || 1;
          return parc > 1
            ? { installments: parc, idempotencyKey: novaChave() }
            : { repeat: Number(f.repeat.value) || 1, idempotencyKey: novaChave() };
        })()),
      };
      if (id) await patch(`/finance/entries/${id}`, body);
      else await post('/finance/entries', body);
      toast('Lançamento salvo.');
      location.href = '/financeiro.html';
    } catch (err) {
      toast(err.message, 'error');
      salvar.disabled = false;
    }
  };

  // categorias financeiras ficam aqui: é onde o usuário sente falta delas
  const gerenciarCategorias = () => {
    const nome = input({ placeholder: 'Nome da categoria' });
    const tipo = select([{ value: 'DESPESA', label: 'Despesa' }, { value: 'RECEITA', label: 'Receita' }]);
    const lista = h('div', { class: 'list-group mt-3' });
    const desenhar = () => lista.replaceChildren(...categorias.map((c) => h('div', {
      class: 'list-group-item d-flex justify-content-between align-items-center',
    }, h('span', {}, c.name, h('span', {
      class: `badge ms-2 text-bg-${c.type === 'RECEITA' ? 'success' : 'danger'}`,
    }, c.type === 'RECEITA' ? 'receita' : 'despesa')))));
    desenhar();

    const add = h('button', { class: 'btn btn-primary' }, 'Adicionar');
    modal({
      title: 'Categorias financeiras',
      body: h('div', {}, h('div', { class: 'row g-2' },
        h('div', { class: 'col-7' }, nome), h('div', { class: 'col-3' }, tipo),
        h('div', { class: 'col-2' }, add)), lista),
    });
    add.onclick = async () => {
      try {
        const created = await post('/finance/categories', { name: nome.value.trim(), type: tipo.value });
        categorias.push(created);
        nome.value = '';
        desenhar();
        preencherCategorias();
        toast('Categoria criada.');
      } catch (e) { toast(e.message, 'error'); }
    };
  };

  mount(content,
    pageTitle(id ? 'Editar lançamento' : 'Novo lançamento',
      h('button', { class: 'btn btn-outline-secondary', onclick: gerenciarCategorias }, 'Categorias financeiras')),
    card(null, form));
  refreshIcons(content);
}
