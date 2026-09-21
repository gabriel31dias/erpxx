// Formulário de entrada de mercadoria, reutilizado na página /entrada.html e na
// aba "Nova entrada" do estoque. Além da digitação manual, importa o XML da NF-e:
// casa os itens pelo código de barras / código do fornecedor e o que não existe
// no cadastro é criado automaticamente ao confirmar (produto entra sem preço).
import { get, novaChave, post } from '../api.js';
import {
  card, centsToInput, confirmAction, debounce, field, fmtBRL, fmtQty, h, input, moneyToCents,
  parseQty, refreshIcons, select, textarea, toast, todayStr,
} from '../ui.js';

const NEW_SUPPLIER = '__novo__';

// Monta o formulário e devolve o nó pronto. `onSaved(entry)` decide a navegação.
export async function entradaForm({ branchId, onSaved }) {
  const wrap = h('div', {});
  const { rows: fornecedores } = await get('/suppliers', { pageSize: 100 });
  const itens = [];
  let pendingSupplier = null; // fornecedor da NF-e ainda sem cadastro

  const busca = input({ class: 'form-control', placeholder: 'Código de barras, SKU ou nome do produto' });
  const sugestoes = h('div', { class: 'list-group mb-3 d-none' });
  const tabela = h('div', {});

  const fornecedor = select([{ value: '', label: 'Sem fornecedor' },
    ...fornecedores.map((s) => ({ value: s.id, label: s.name }))]);
  const documento = input({ placeholder: 'NF / cupom' });
  const observacao = textarea({ rows: 2 });
  const atualizarCusto = h('input', { type: 'checkbox', class: 'form-check-input', checked: true });
  const gerarConta = h('input', { type: 'checkbox', class: 'form-check-input' });
  const vencimento = input({ type: 'date', value: todayStr() });
  const avisoXml = h('div', { class: 'alert alert-info d-none py-2 px-3 mb-3' });

  // ---------- importação do XML ----------
  const arquivo = h('input', { type: 'file', accept: '.xml,text/xml', class: 'd-none' });
  const btnXml = h('button', { class: 'btn btn-outline-primary', type: 'button' }, 'Importar XML da NF-e');
  btnXml.onclick = () => arquivo.click();
  arquivo.onchange = async () => {
    const file = arquivo.files[0];
    if (!file) return;
    btnXml.disabled = true;
    try {
      const xml = await file.text();
      const nfe = await post('/stock/entries/import-nfe', { xml });
      await aplicarNfe(nfe);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btnXml.disabled = false;
      arquivo.value = '';
    }
  };

  async function aplicarNfe(nfe) {
    if (nfe.document) documento.value = nfe.document;
    // fornecedor: casa por CNPJ; se não existe, marca para criar ao confirmar
    if (nfe.supplier?.id) {
      fornecedor.value = nfe.supplier.id;
      pendingSupplier = null;
    } else if (nfe.supplier?.name) {
      pendingSupplier = { name: nfe.supplier.name, document: nfe.supplier.document || undefined };
      if (!fornecedor.querySelector(`option[value="${NEW_SUPPLIER}"]`)) {
        fornecedor.append(new Option(`＋ Novo: ${nfe.supplier.name}`, NEW_SUPPLIER));
      } else {
        fornecedor.querySelector(`option[value="${NEW_SUPPLIER}"]`).textContent = `＋ Novo: ${nfe.supplier.name}`;
      }
      fornecedor.value = NEW_SUPPLIER;
    }
    // itens: adiciona/atualiza pela chave (ean ou código)
    for (const it of nfe.items) {
      const chave = it.ean || it.code || it.name;
      const existente = itens.find((x) => x.chave === chave);
      const base = {
        chave,
        productId: it.product?.id || null,
        name: it.product?.name || it.name,
        ean: it.ean || '', code: it.code || '', unit: it.unit || 'UN',
        quantity: it.quantity, costCents: it.costCents,
        ncm: it.ncm || '', cest: it.cest || '', origem: it.origem || '',
      };
      if (existente) Object.assign(existente, base);
      else itens.push(base);
    }
    const novos = nfe.items.filter((i) => !i.product).length;
    avisoXml.classList.remove('d-none');
    avisoXml.textContent = novos
      ? `NF-e importada: ${nfe.items.length} item(ns), ${novos} sem cadastro — serão criados ao confirmar.`
      : `NF-e importada: ${nfe.items.length} item(ns), todos já cadastrados.`;
    desenhar();
    toast('NF-e importada.');

    // Pergunta se quer lançar o contas a pagar desta nota.
    const parcelas = nfe.payment?.parcelas || [];
    const totalNota = total();
    const detalhe = parcelas.length
      ? ` A nota tem ${parcelas.length} parcela(s); a 1ª vence em ${parcelas.map((p) => p.due).sort()[0]}.`
      : nfe.payment?.aprazo ? ' A nota é a prazo.' : '';
    const lancar = await confirmAction(
      `Lançar o contas a pagar desta nota (${fmtBRL(totalNota)})?${detalhe}`,
      { title: 'Contas a pagar', okLabel: 'Lançar conta', danger: false });
    gerarConta.checked = lancar;
    if (lancar && parcelas.length) vencimento.value = parcelas.map((p) => p.due).sort()[0];
    if (lancar) vencimento.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------- busca manual ----------
  const buscar = debounce(async () => {
    const q = busca.value.trim();
    if (q.length < 2) return sugestoes.classList.add('d-none');
    const { rows } = await get('/products/lookup', { q, branchId });
    sugestoes.replaceChildren(...rows.map((p) => h('button', {
      class: 'list-group-item list-group-item-action d-flex justify-content-between',
      type: 'button', onclick: () => adicionar(p),
    }, h('span', {}, p.name, h('small', { class: 'd-block txt-secondary' }, `${p.sku || ''} · estoque ${fmtQty(p.stock, p.unit)}`)),
      h('span', {}, `custo ${fmtBRL(p.costCents)}`))));
    sugestoes.classList.toggle('d-none', !rows.length);
  }, 300);
  busca.oninput = buscar;
  busca.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); sugestoes.querySelector('button')?.click(); } };

  function adicionar(product) {
    const chave = product.id;
    if (!itens.find((i) => i.chave === chave)) {
      itens.push({
        chave, productId: product.id, name: product.name, unit: product.unit,
        ean: '', code: '', quantity: 1, costCents: product.costCents,
      });
    }
    busca.value = '';
    sugestoes.classList.add('d-none');
    desenhar();
    busca.focus();
  }

  const totalBox = h('div', { class: 'lf-money' });

  function total() {
    return itens.reduce((s, i) => s + Math.round(i.costCents * i.quantity), 0);
  }

  function desenhar() {
    totalBox.textContent = fmtBRL(total());
    tabela.replaceChildren(itens.length
      ? h('div', { class: 'table-responsive' }, h('table', { class: 'table align-middle' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Produto'), h('th', { style: 'width:130px' }, 'Quantidade'),
            h('th', { style: 'width:150px' }, 'Custo unit.'), h('th', { class: 'text-end' }, 'Total'),
            h('th', { style: 'width:220px' }, 'Lote / validade'), h('th', {}))),
          h('tbody', {}, itens.map((item, index) => {
            const qtd = input({ class: 'form-control form-control-sm', inputmode: 'decimal', value: fmtQty(item.quantity) });
            const custo = input({ class: 'form-control form-control-sm', inputmode: 'decimal', value: centsToInput(item.costCents) });
            const lote = input({ class: 'form-control form-control-sm', placeholder: 'Lote' });
            const validade = input({ type: 'date', class: 'form-control form-control-sm' });
            qtd.oninput = () => { item.quantity = parseQty(qtd.value); desenharTotais(); };
            custo.oninput = () => { item.costCents = moneyToCents(custo.value); desenharTotais(); };
            lote.oninput = () => { item.lot = lote.value; };
            validade.onchange = () => { item.expiresAt = validade.value; };
            const nome = h('td', {}, h('strong', {}, item.name),
              h('small', { class: 'd-block txt-secondary' }, item.unit),
              item.productId ? null : h('span', { class: 'badge text-bg-warning mt-1' }, 'novo — será criado'));
            return h('tr', {},
              nome, h('td', {}, qtd), h('td', {}, custo),
              h('td', { class: 'text-end lf-item-total' }, fmtBRL(Math.round(item.costCents * item.quantity))),
              h('td', {}, h('div', { class: 'd-flex gap-1' }, lote, validade)),
              h('td', { class: 'text-end' }, h('button', {
                class: 'btn btn-sm btn-outline-danger', type: 'button',
                onclick: () => { itens.splice(index, 1); desenhar(); },
              }, '×')));
          }))))
      : h('p', { class: 'txt-secondary' }, 'Nenhum produto adicionado ainda.'));
    refreshIcons(wrap);
  }

  function desenharTotais() {
    totalBox.textContent = fmtBRL(total());
    tabela.querySelectorAll('.lf-item-total').forEach((td, i) => {
      td.textContent = fmtBRL(Math.round(itens[i].costCents * itens[i].quantity));
    });
  }

  const salvar = h('button', { class: 'btn btn-success btn-lg', type: 'button' }, 'Confirmar entrada');
  salvar.onclick = async () => {
    if (!itens.length) return toast('Adicione ao menos um produto.', 'warning');
    salvar.disabled = true;
    try {
      const novoForn = fornecedor.value === NEW_SUPPLIER;
      const entrada = await post('/stock/entries', {
        supplierId: novoForn ? undefined : (fornecedor.value || undefined),
        newSupplier: novoForn ? pendingSupplier : undefined,
        branchId: branchId || undefined,
        document: documento.value.trim() || undefined,
        notes: observacao.value.trim() || undefined,
        updateCost: atualizarCusto.checked,
        dueDate: gerarConta.checked ? vencimento.value : undefined,
        idempotencyKey: novaChave(),
        items: itens.map((i) => i.productId
          ? {
            productId: i.productId, quantity: i.quantity, costCents: i.costCents,
            lot: i.lot || undefined, expiresAt: i.expiresAt || undefined,
          }
          : {
            newProduct: {
              name: i.name, barcode: i.ean || undefined, sku: i.code || undefined, unit: i.unit,
              ncm: i.ncm || undefined, cest: i.cest || undefined, origem: i.origem || undefined,
            },
            quantity: i.quantity, costCents: i.costCents,
            lot: i.lot || undefined, expiresAt: i.expiresAt || undefined,
          }),
      });
      toast('Entrada registrada e estoque atualizado.');
      onSaved?.(entrada);
    } catch (e) {
      toast(e.message, 'error');
      salvar.disabled = false;
    }
  };

  wrap.append(
    avisoXml,
    card('Produtos', h('div', {},
      h('div', { class: 'd-flex flex-wrap gap-2 align-items-center mb-3' },
        h('div', { class: 'flex-grow-1' }, busca), btnXml, arquivo),
      sugestoes, tabela)),
    card('Dados da compra', h('div', { class: 'row g-3' },
      field('Fornecedor', fornecedor, { col: 'col-12 col-md-4' }),
      field('Documento', documento, { col: 'col-6 col-md-3' }),
      h('div', { class: 'col-12 col-md-5' },
        h('div', { class: 'form-check' }, atualizarCusto,
          h('label', { class: 'form-check-label' }, 'Atualizar o custo dos produtos com esta entrada')),
        h('div', { class: 'form-check' }, gerarConta,
          h('label', { class: 'form-check-label' }, 'Gerar conta a pagar do fornecedor'))),
      field('Vencimento da conta', vencimento, { col: 'col-6 col-md-3' }),
      field('Observações', observacao, { col: 'col-12' }))),
    h('div', { class: 'card' }, h('div', { class: 'card-body d-flex align-items-center gap-3 flex-wrap' },
      h('div', {}, h('div', { class: 'lf-stat-label' }, 'Total da entrada'), totalBox),
      h('div', { class: 'ms-auto' }, salvar))));
  desenhar();
  return wrap;
}
