// Cadastro/edição de produto em tela própria + histórico de movimentações.
import { get, patch, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount,
  card, centsToInput, field, fmtBRL, fmtQty, h, input, moneyToCents, parseQty, refreshIcons,
  select, textarea, toast,
} from '../ui.js';

const UNITS = ['UN', 'KG', 'G', 'L', 'ML', 'CX', 'PCT'];

// Origem da mercadoria (ICMS) — usada na NF-e.
const ORIGENS = [
  ['0', '0 - Nacional'],
  ['1', '1 - Estrangeira (importação direta)'],
  ['2', '2 - Estrangeira (mercado interno)'],
  ['3', '3 - Nacional > 40% importação'],
  ['4', '4 - Nacional (processos produtivos básicos)'],
  ['5', '5 - Nacional < 40% importação'],
  ['6', '6 - Estrangeira (import. sem similar nacional)'],
  ['7', '7 - Estrangeira (merc. interno sem similar)'],
  ['8', '8 - Nacional > 70% importação'],
];
const pctToBp = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : undefined; };
const bpToPct = (bp) => (bp == null ? '' : String(bp / 100).replace('.', ','));

export default async function render({ content, can, branchId }) {
  const id = new URLSearchParams(location.search).get('id');
  const [{ rows: categorias }, detalhe] = await Promise.all([
    get('/categories'),
    id ? get(`/products/${id}`, { branchId }) : Promise.resolve(null),
  ]);
  const p = detalhe?.product ?? {};
  const editavel = id ? can('produto.editar') : can('produto.criar');

  const f = {
    name: input({ value: p.name ?? '', required: true }),
    barcode: input({ value: p.barcode ?? '', placeholder: 'Leia com o scanner' }),
    sku: input({ value: p.sku ?? '' }),
    internalCode: input({ value: p.internalCode ?? '' }),
    categoryId: select([{ value: '', label: 'Sem categoria' },
      ...categorias.map((c) => ({ value: c.id, label: c.name, selected: c.id === p.categoryId }))]),
    brand: input({ value: p.brand ?? '' }),
    unit: select(UNITS.map((u) => ({ value: u, label: u, selected: u === (p.unit ?? 'UN') }))),
    saleType: select([
      { value: 'UNIT', label: 'Por unidade', selected: (p.saleType ?? 'UNIT') === 'UNIT' },
      { value: 'WEIGHT', label: 'Por peso (aceita decimais)', selected: p.saleType === 'WEIGHT' },
    ]),
    cost: input({ inputmode: 'decimal', value: centsToInput(p.costCents ?? 0) }),
    price: input({ inputmode: 'decimal', value: centsToInput(p.priceCents ?? 0) }),
    minStock: input({ inputmode: 'decimal', value: String(p.minStock ?? 0) }),
    maxStock: input({ inputmode: 'decimal', value: String(p.maxStock ?? 0) }),
    imageUrl: input({ value: p.imageUrl ?? '', placeholder: 'https://…' }),
    description: textarea({ value: p.description ?? '' }),
    active: select([
      { value: 'true', label: 'Ativo', selected: p.active !== false },
      { value: 'false', label: 'Inativo', selected: p.active === false },
    ]),
    initialStock: input({ inputmode: 'decimal', value: '0' }),
    // ---- fiscais (NF-e) ----
    ncm: input({ value: p.ncm ?? '', placeholder: '8 dígitos', inputmode: 'numeric' }),
    cest: input({ value: p.cest ?? '', placeholder: '7 dígitos (se ST)', inputmode: 'numeric' }),
    cfop: input({ value: p.cfop ?? '5102', placeholder: '5102', inputmode: 'numeric' }),
    origem: select(ORIGENS.map(([v, l]) => ({ value: v, label: l, selected: v === (p.origem ?? '0') }))),
    csosn: input({ value: p.csosn ?? '102', placeholder: 'Simples (ex.: 102)', inputmode: 'numeric' }),
    cstIcms: input({ value: p.cstIcms ?? '', placeholder: 'Regime normal (ex.: 00)', inputmode: 'numeric' }),
    cstPis: input({ value: p.cstPis ?? '49', inputmode: 'numeric' }),
    cstCofins: input({ value: p.cstCofins ?? '49', inputmode: 'numeric' }),
    icmsAliq: input({ value: bpToPct(p.icmsAliqBp), placeholder: '%', inputmode: 'decimal' }),
    pisAliq: input({ value: bpToPct(p.pisAliqBp), placeholder: '%', inputmode: 'decimal' }),
    cofinsAliq: input({ value: bpToPct(p.cofinsAliqBp), placeholder: '%', inputmode: 'decimal' }),
    netWeight: input({ value: p.netWeight ?? '', placeholder: 'kg', inputmode: 'decimal' }),
    grossWeight: input({ value: p.grossWeight ?? '', placeholder: 'kg', inputmode: 'decimal' }),
  };

  const margem = h('div', { class: 'form-text' });
  const calcularMargem = () => {
    const cost = moneyToCents(f.cost.value);
    const price = moneyToCents(f.price.value);
    margem.textContent = price > 0 && cost > 0
      ? `Margem: ${(((price - cost) / price) * 100).toFixed(1)}% · lucro ${fmtBRL(price - cost)}`
      : 'Informe custo e preço para ver a margem.';
  };
  f.cost.oninput = calcularMargem;
  f.price.oninput = calcularMargem;
  calcularMargem();

  const salvar = h('button', { class: 'btn btn-primary', type: 'submit' }, id ? 'Salvar alterações' : 'Cadastrar produto');
  const form = h('form', { class: 'row g-3' },
    field('Nome do produto', f.name, { col: 'col-12 col-md-6' }),
    field('Código de barras', f.barcode, { col: 'col-12 col-md-3' }),
    field('SKU', f.sku, { col: 'col-6 col-md-3' }),
    field('Código interno', f.internalCode, { col: 'col-6 col-md-3' }),
    field('Categoria', f.categoryId, { col: 'col-6 col-md-3' }),
    field('Marca', f.brand, { col: 'col-6 col-md-3' }),
    field('Unidade', f.unit, { col: 'col-6 col-md-3' }),
    field('Tipo de venda', f.saleType, { col: 'col-12 col-md-3', help: 'Peso permite 0,742 kg no PDV.' }),
    field('Custo (R$)', f.cost, { col: 'col-6 col-md-3' }),
    field('Preço de venda (R$)', f.price, { col: 'col-6 col-md-3' }),
    h('div', { class: 'col-12' }, margem),
    field('Estoque mínimo', f.minStock, { col: 'col-6 col-md-3' }),
    field('Estoque máximo', f.maxStock, { col: 'col-6 col-md-3' }),
    field('Situação', f.active, { col: 'col-6 col-md-3' }),
    id ? null : field('Estoque inicial', f.initialStock, { col: 'col-6 col-md-3', help: 'Gera uma movimentação de entrada.' }),
    field('Imagem (URL)', f.imageUrl, { col: 'col-12 col-md-6' }),
    field('Descrição', f.description, { col: 'col-12' }),
    // ---- Dados fiscais (NF-e) ----
    h('div', { class: 'col-12 mt-2' }, h('hr', {}),
      h('h6', { class: 'txt-primary mb-0' }, 'Dados fiscais (NF-e)'),
      h('small', { class: 'txt-secondary' }, 'Usados na emissão da nota. NCM é obrigatório; CSOSN vale para o Simples Nacional e CST ICMS para o regime normal.')),
    field('NCM', f.ncm, { col: 'col-6 col-md-3' }),
    field('CEST', f.cest, { col: 'col-6 col-md-3' }),
    field('CFOP', f.cfop, { col: 'col-6 col-md-3' }),
    field('Origem da mercadoria', f.origem, { col: 'col-6 col-md-3' }),
    field('CSOSN (Simples)', f.csosn, { col: 'col-6 col-md-3' }),
    field('CST ICMS (regime normal)', f.cstIcms, { col: 'col-6 col-md-3' }),
    field('CST PIS', f.cstPis, { col: 'col-6 col-md-3' }),
    field('CST COFINS', f.cstCofins, { col: 'col-6 col-md-3' }),
    field('Alíquota ICMS (%)', f.icmsAliq, { col: 'col-6 col-md-3' }),
    field('Alíquota PIS (%)', f.pisAliq, { col: 'col-6 col-md-3' }),
    field('Alíquota COFINS (%)', f.cofinsAliq, { col: 'col-6 col-md-3' }),
    h('div', { class: 'col-6 col-md-3' }),
    field('Peso líquido (kg)', f.netWeight, { col: 'col-6 col-md-3' }),
    field('Peso bruto (kg)', f.grossWeight, { col: 'col-6 col-md-3' }),
    h('div', { class: 'col-12 d-flex gap-2 justify-content-end' },
      h('a', { class: 'btn btn-light', href: '/produtos.html' }, 'Voltar'),
      editavel ? salvar : null));

  form.onsubmit = async (e) => {
    e.preventDefault();
    salvar.disabled = true;
    try {
      const body = {
        name: f.name.value.trim(),
        barcode: f.barcode.value.trim() || undefined,
        sku: f.sku.value.trim() || undefined,
        internalCode: f.internalCode.value.trim() || undefined,
        categoryId: f.categoryId.value || undefined,
        brand: f.brand.value.trim() || undefined,
        unit: f.unit.value,
        saleType: f.saleType.value,
        costCents: moneyToCents(f.cost.value),
        priceCents: moneyToCents(f.price.value),
        minStock: parseQty(f.minStock.value),
        maxStock: parseQty(f.maxStock.value),
        imageUrl: f.imageUrl.value.trim() || undefined,
        description: f.description.value.trim() || undefined,
        active: f.active.value === 'true',
        // fiscais (NF-e)
        ncm: f.ncm.value.trim() || undefined,
        cest: f.cest.value.trim() || undefined,
        cfop: f.cfop.value.trim() || undefined,
        origem: f.origem.value,
        csosn: f.csosn.value.trim() || undefined,
        cstIcms: f.cstIcms.value.trim() || undefined,
        cstPis: f.cstPis.value.trim() || undefined,
        cstCofins: f.cstCofins.value.trim() || undefined,
        icmsAliqBp: pctToBp(f.icmsAliq.value),
        pisAliqBp: pctToBp(f.pisAliq.value),
        cofinsAliqBp: pctToBp(f.cofinsAliq.value),
        netWeight: f.netWeight.value ? parseQty(f.netWeight.value) : undefined,
        grossWeight: f.grossWeight.value ? parseQty(f.grossWeight.value) : undefined,
        ...(id ? {} : { initialStock: parseQty(f.initialStock.value) }),
      };
      const saved = id ? await patch(`/products/${id}`, body) : await post('/products', body);
      toast('Produto salvo.');
      if (!id) location.href = `/produto.html?id=${saved.id}`;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      salvar.disabled = false;
    }
  };

  const historico = detalhe ? card('Últimas movimentações',
    detalhe.movements.length
      ? h('div', { class: 'table-responsive' }, h('table', { class: 'table align-middle mb-0' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Data'), h('th', {}, 'Tipo'), h('th', { class: 'text-end' }, 'Qtd'),
            h('th', { class: 'text-end' }, 'Saldo'), h('th', {}, 'Motivo'), h('th', {}, 'Usuário'))),
          h('tbody', {}, detalhe.movements.map((m) => h('tr', {},
            h('td', {}, m.createdAtLocal),
            h('td', {}, h('span', { class: 'badge text-bg-light' }, m.type)),
            h('td', { class: 'text-end' }, fmtQty(m.quantity)),
            h('td', { class: 'text-end' }, fmtQty(m.after)),
            h('td', {}, m.reason ?? '—'),
            h('td', {}, m.user?.name ?? '—'))))))
      : h('p', { class: 'txt-secondary mb-0' }, 'Sem movimentações ainda.')) : null;

  const resumo = detalhe ? h('div', { class: 'row' },
    h('div', { class: 'col-6 col-xl-3' }, card(null, h('div', {},
      h('div', { class: 'lf-stat-label' }, 'Estoque atual'),
      h('div', { class: 'lf-stat-value' }, fmtQty(detalhe.product.stock, detalhe.product.unit))))),
    h('div', { class: 'col-6 col-xl-3' }, card(null, h('div', {},
      h('div', { class: 'lf-stat-label' }, 'Vendido (total)'),
      h('div', { class: 'lf-stat-value' }, fmtQty(detalhe.sold.quantity, detalhe.product.unit))))),
    h('div', { class: 'col-6 col-xl-3' }, card(null, h('div', {},
      h('div', { class: 'lf-stat-label' }, 'Faturamento'),
      h('div', { class: 'lf-stat-value' }, fmtBRL(detalhe.sold.totalCents))))),
    h('div', { class: 'col-6 col-xl-3' }, card(null, h('div', {},
      h('div', { class: 'lf-stat-label' }, 'Margem'),
      h('div', { class: 'lf-stat-value' }, `${detalhe.product.marginPct}%`))))) : null;

  mount(content,
    pageTitle(id ? p.name : 'Novo produto',
      id && can('estoque.movimentar') ? h('a', { class: 'btn btn-outline-secondary', href: `/estoque.html?tab=movimentacoes&productId=${id}` }, 'Movimentações') : null),
    resumo,
    card(id ? 'Dados do produto' : 'Novo produto', form),
    historico);
  refreshIcons(content);
}
