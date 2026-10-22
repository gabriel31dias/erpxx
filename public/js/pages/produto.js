// Cadastro/edição de produto em tela própria + histórico de movimentações.
import { get, patch, post, uploadImage } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount,
  card, centsToInput, field, fmtBRL, fmtQty, h, input, moneyInput, moneyToCents, parseQty, refreshIcons,
  select, textarea, toast,
} from '../ui.js';

// ---------- cardápio digital: listas de {name, priceCents} editáveis ----------
function linhas(itens, { nome = 'Nome', vazio = 'Nenhum item.' } = {}) {
  const corpo = h('div', {});
  const linha = (it = {}) => {
    const n = input({ value: it.name ?? '', placeholder: nome, class: 'form-control form-control-sm' });
    const v = moneyInput({ value: centsToInput(it.priceCents ?? 0), class: 'form-control form-control-sm', style: 'max-width:120px' });
    const row = h('div', { class: 'd-flex gap-2 mb-2 lf-linha' }, n, v,
      h('button', { type: 'button', class: 'btn btn-sm btn-outline-danger', 'aria-label': 'Remover', onclick: () => row.remove() }, '×'));
    row.valor = () => ({ name: n.value.trim(), priceCents: moneyToCents(v.value) });
    corpo.append(row);
  };
  itens.forEach(linha);
  return {
    node: h('div', {}, corpo,
      h('button', { type: 'button', class: 'btn btn-sm btn-outline-primary', onclick: () => linha() }, '+ Adicionar'),
      itens.length ? null : h('div', { class: 'form-text' }, vazio)),
    value: () => [...corpo.children].map((r) => r.valor()).filter((x) => x.name),
  };
}

/** grupos de escolha (ex.: Borda — mín 0, máx 1) com seus itens */
function grupos(lista) {
  const corpo = h('div', {});
  const grupo = (g = { min: 0, max: 1, items: [] }) => {
    const nome = input({ value: g.name ?? '', placeholder: 'Ex.: Borda', class: 'form-control form-control-sm' });
    const min = input({ type: 'number', min: 0, max: 20, value: g.min, class: 'form-control form-control-sm', style: 'max-width:80px' });
    const max = input({ type: 'number', min: 1, max: 20, value: g.max, class: 'form-control form-control-sm', style: 'max-width:80px' });
    const itens = linhas(g.items, { nome: 'Opção' });
    const box = h('div', { class: 'border rounded p-2 mb-2' },
      h('div', { class: 'd-flex gap-2 mb-2 align-items-center' }, nome,
        h('small', {}, 'mín'), min, h('small', {}, 'máx'), max,
        h('button', { type: 'button', class: 'btn btn-sm btn-outline-danger', onclick: () => box.remove() }, 'Remover grupo')),
      itens.node);
    box.valor = () => ({ name: nome.value.trim(), min: Number(min.value) || 0, max: Math.max(Number(max.value) || 1, 1), items: itens.value() });
    corpo.append(box);
  };
  lista.forEach(grupo);
  return {
    node: h('div', {}, corpo, h('button', { type: 'button', class: 'btn btn-sm btn-outline-primary', onclick: () => grupo() }, '+ Grupo de escolha')),
    value: () => [...corpo.children].map((b) => b.valor()).filter((g) => g.name && g.items.length),
  };
}

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
// ISO do servidor -> valor do <input type="datetime-local"> no fuso do navegador
const isoToLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default async function render({ content, can, branchId }) {
  const id = new URLSearchParams(location.search).get('id');
  const [{ rows: categorias }, { rows: pracas }, detalhe] = await Promise.all([
    get('/categories'),
    get('/kitchen/stations'),
    id ? get(`/products/${id}`, { branchId }) : Promise.resolve(null),
  ]);
  const p = detalhe?.product ?? {};
  const opcoes = JSON.parse(p.menuOptions || '{}');
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
    imageUrl: input({ value: p.imageUrl ?? '', placeholder: 'https://… ou envie uma foto' }),
    description: textarea({ value: p.description ?? '' }),
    active: select([
      { value: 'true', label: 'Ativo', selected: p.active !== false },
      { value: 'false', label: 'Inativo', selected: p.active === false },
    ]),
    initialStock: input({ inputmode: 'decimal', value: '0' }),
    addStock: input({ inputmode: 'decimal', value: '', placeholder: '0' }),
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
    // ---- cardápio digital ----
    menuVisible: select([
      { value: 'false', label: 'Não', selected: !p.menuVisible },
      { value: 'true', label: 'Sim', selected: !!p.menuVisible },
    ]),
    oldPrice: moneyInput({ value: p.oldPriceCents == null ? '' : centsToInput(p.oldPriceCents), placeholder: 'sem promoção' }),
    position: input({ type: 'number', value: p.position ?? 0 }),
    // ---- bilheteria ----
    eventName: input({ value: p.eventName ?? '', placeholder: 'Ex.: Show de Aniversário' }),
    eventDate: input({ type: 'datetime-local', value: isoToLocal(p.eventDate) }),
    ticketType: input({ value: p.ticketType ?? '', placeholder: 'Ex.: Inteira, Meia, VIP' }),
    ticketBox: select([
      { value: 'false', label: 'Não', selected: !p.ticketBox },
      { value: 'true', label: 'Sim', selected: !!p.ticketBox },
    ]),
    boxNumber: input({ value: p.boxNumber ?? '', placeholder: 'Ex.: 05' }),
    tableNumber: input({ value: p.tableNumber ?? '', placeholder: 'Ex.: 12' }),
    // ---- cozinha: '' herda da categoria; 'skip' não vai para tela nenhuma ----
    station: select([
      { value: '', label: 'Herdar da categoria', selected: !p.stationId && !p.kitchenSkip },
      ...pracas.map((s) => ({ value: s.id, label: s.name, selected: !p.kitchenSkip && s.id === p.stationId })),
      { value: 'skip', label: 'Não vai para a cozinha', selected: !!p.kitchenSkip },
    ]),
  };
  const pracaHerdada = h('div', { class: 'form-text' });
  const mostrarHerdada = () => {
    const cat = categorias.find((c) => c.id === f.categoryId.value);
    const nome = pracas.find((s) => s.id === cat?.stationId)?.name ?? pracas.find((s) => s.isDefault)?.name ?? 'Cozinha';
    pracaHerdada.textContent = f.station.value === 'skip'
      ? 'O item não aparece em nenhuma tela de preparo: o balcão/garçom só entrega.'
      : f.station.value ? 'Este produto vai para a praça escolhida, qualquer que seja a categoria.'
        : `Pela categoria, vai para: ${nome}.`;
  };
  f.station.onchange = mostrarHerdada;
  f.categoryId.addEventListener('change', mostrarHerdada);
  mostrarHerdada();
  const menu = {
    sizes: linhas(opcoes.sizes ?? [], { nome: 'Ex.: Grande', vazio: 'Sem tamanhos: vale o preço de venda.' }),
    additionals: linhas(opcoes.additionals ?? [], { nome: 'Ex.: Bacon' }),
    optionGroups: grupos(opcoes.optionGroups ?? []),
  };

  // foto: envia e preenche o campo de URL
  const foto = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'd-none' });
  const enviarFoto = h('button', { type: 'button', class: 'btn btn-outline-primary', onclick: () => foto.click() }, 'Enviar foto');
  foto.onchange = async () => {
    if (!foto.files[0]) return;
    enviarFoto.disabled = true;
    try { f.imageUrl.value = await uploadImage(foto.files[0]); toast('Foto enviada. Salve o produto.'); }
    catch (e) { toast(e.message, 'error'); } finally { enviarFoto.disabled = false; foto.value = ''; }
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
    id ? null : field('Quantidade em estoque (entrada inicial)', f.initialStock, {
      col: 'col-6 col-md-3', help: 'Ao cadastrar, gera a entrada automaticamente em Estoque > Entradas, com o custo informado.',
    }),
    id && can('estoque.entrada') ? field('Adicionar ao estoque (nova entrada)', f.addStock, {
      col: 'col-6 col-md-3',
      help: `Hoje: ${fmtQty(detalhe.product.stock, p.unit)}. Ao salvar, soma essa quantidade e gera a entrada em Estoque > Entradas.`,
    }) : null,
    field('Imagem (URL)', f.imageUrl, { col: 'col-12 col-md-6' }),
    h('div', { class: 'col-12 col-md-6 d-flex align-items-end gap-2' }, editavel ? enviarFoto : null, foto),
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
    // ---- Cozinha ----
    h('div', { class: 'col-12 mt-2' }, h('hr', {}),
      h('h6', { class: 'txt-primary mb-0' }, 'Cozinha'),
      h('small', { class: 'txt-secondary' }, 'Em qual tela de preparo (praça) o item aparece quando entra um pedido do cardápio ou do garçom.')),
    h('div', { class: 'col-12 col-md-6' }, h('label', { class: 'form-label' }, 'Praça da cozinha'), f.station, pracaHerdada),
    // ---- Bilheteria ----
    h('div', { class: 'col-12 mt-2' }, h('hr', {}),
      h('h6', { class: 'txt-primary mb-0' }, 'Bilheteria (ingresso)'),
      h('small', { class: 'txt-secondary' }, 'Opcional. Usado no modo bilheteria: a maquininha imprime esses dados no ingresso.')),
    field('Nome do evento', f.eventName, { col: 'col-12 col-md-6', help: 'Aparece no topo do ingresso.' }),
    field('Data do evento', f.eventDate, { col: 'col-6 col-md-3', help: 'Data e hora de início.' }),
    field('Tipo de ingresso', f.ticketType, { col: 'col-6 col-md-3', help: 'Ex.: Inteira, Meia-entrada, VIP, Pista.' }),
    field('Camarote', f.ticketBox, { col: 'col-6 col-md-3', help: 'Sim, o ingresso sai marcado como camarote.' }),
    field('Número do camarote', f.boxNumber, { col: 'col-6 col-md-3', help: 'Impresso no ingresso quando é camarote.' }),
    field('Mesa', f.tableNumber, { col: 'col-6 col-md-3', help: 'Número da mesa, quando o lugar é numerado.' }),
    // ---- Cardápio digital ----
    h('div', { class: 'col-12 mt-2' }, h('hr', {}),
      h('h6', { class: 'txt-primary mb-0' }, 'Cardápio digital'),
      h('small', { class: 'txt-secondary' }, 'Como o produto aparece no app de pedidos. O preço é sempre conferido no servidor.')),
    field('Mostrar no cardápio', f.menuVisible, { col: 'col-6 col-md-3' }),
    field('Preço "de" (R$)', f.oldPrice, { col: 'col-6 col-md-3', help: 'Aparece riscado, como promoção.' }),
    field('Ordem no cardápio', f.position, { col: 'col-6 col-md-3' }),
    h('div', { class: 'col-12 col-md-6' }, h('div', { class: 'form-label' }, 'Tamanhos (pizza: cada um com seu preço)'), menu.sizes.node),
    h('div', { class: 'col-12 col-md-6' }, h('div', { class: 'form-label' }, 'Adicionais'), menu.additionals.node),
    h('div', { class: 'col-12' }, h('div', { class: 'form-label' }, 'Escolhas com limite'), menu.optionGroups.node),
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
        ...(id ? { addStock: f.addStock.value.trim() ? parseQty(f.addStock.value) : undefined }
          : { initialStock: parseQty(f.initialStock.value) }),
        // cardápio digital
        menuVisible: f.menuVisible.value === 'true',
        oldPriceCents: f.oldPrice.value.trim() ? moneyToCents(f.oldPrice.value) : null,
        position: Number(f.position.value) || 0,
        menuOptions: { sizes: menu.sizes.value(), additionals: menu.additionals.value(), optionGroups: menu.optionGroups.value() },
        // cozinha
        stationId: f.station.value && f.station.value !== 'skip' ? f.station.value : null,
        kitchenSkip: f.station.value === 'skip',
        // bilheteria
        eventName: f.eventName.value.trim(),
        eventDate: f.eventDate.value ? new Date(f.eventDate.value).toISOString() : undefined,
        ticketType: f.ticketType.value.trim(),
        ticketBox: f.ticketBox.value === 'true',
        boxNumber: f.boxNumber.value.trim(),
        tableNumber: f.tableNumber.value.trim(),
      };
      const saved = id ? await patch(`/products/${id}`, body) : await post('/products', body);
      toast('Produto salvo.');
      // com entrada, recarrega para atualizar saldo e movimentações
      if (!id || body.addStock) location.href = `/produto.html?id=${saved.id}`;
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
