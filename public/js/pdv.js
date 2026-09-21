/**
 * PDV — frente de caixa. Tela própria (sem menu), pensada para teclado e leitor
 * de código de barras: o foco vive no campo de leitura e volta para ele depois
 * de qualquer ação.
 *
 * Estado do carrinho (aqui) ≠ serviço de venda (API). A venda só existe quando o
 * servidor confirma; sem rede ela entra na fila com chave de idempotência, então
 * reenviar não duplica.
 */
import { get, novaChave, post } from './api.js';
import { pendentes, reenvioAutomatico, sincronizar } from './offline.js';
import {
  $, centsToInput, confirmAction, fmtBRL, fmtQty, h, modal, moneyToCents, parseQty, toast,
} from './ui.js';

const SUSPENSAS = 'lf.pdv.suspensas'; // ponytail: venda suspensa mora no aparelho
                                      // (nada foi baixado do estoque ainda)

const state = {
  me: null,
  session: null,
  methods: [],
  items: [],
  customer: null,
  discountCents: 0,
  index: -1, // item destacado
};

const root = document.getElementById('lf-pdv');
let busca;

// ---------- contas ----------
const itemGross = (i) => Math.round(i.unitPriceCents * i.quantity);
const itemTotal = (i) => Math.max(0, itemGross(i) - i.discountCents);
const subtotal = () => state.items.reduce((s, i) => s + itemGross(i), 0);
const itemDiscounts = () => state.items.reduce((s, i) => s + i.discountCents, 0);
const total = () => Math.max(0, subtotal() - itemDiscounts() - state.discountCents);

// ---------- carrinho ----------
function addProduct(product, quantity = 1) {
  const existing = state.items.find((i) => i.productId === product.id && product.saleType !== 'WEIGHT');
  if (existing) {
    existing.quantity += quantity;
    state.index = state.items.indexOf(existing);
  } else {
    state.items.push({
      productId: product.id, name: product.name, unit: product.unit, saleType: product.saleType,
      quantity, unitPriceCents: product.priceCents, discountCents: 0, stock: product.stock,
    });
    state.index = state.items.length - 1;
  }
  render();
}

function removeItem(index) {
  state.items.splice(index, 1);
  state.index = Math.min(state.index, state.items.length - 1);
  render();
}

async function buscar(term) {
  if (state.bloqueado) return;
  if (!term.trim()) return;
  const data = await get('/products/lookup', { q: term, branchId: state.branchId });
  if (!data.rows.length) return toast('Produto não encontrado.', 'warning');

  if (data.exact || data.rows.length === 1) {
    const product = data.rows[0];
    if (product.saleType === 'WEIGHT') return pedirQuantidade(product);
    addProduct(product, 1);
    return;
  }
  escolherProduto(data.rows);
}

function escolherProduto(rows) {
  const lista = h('div', { class: 'list-group lf-pdv-sugestoes' }, rows.map((p, i) =>
    h('button', {
      class: 'list-group-item list-group-item-action d-flex justify-content-between align-items-center gap-2',
      onclick: () => { m.close(); p.saleType === 'WEIGHT' ? pedirQuantidade(p) : addProduct(p, 1); },
    },
      h('span', {}, h('strong', {}, `${i + 1}. ${p.name}`),
        h('small', { class: 'd-block txt-secondary' }, `${p.sku || ''} · estoque ${fmtQty(p.stock, p.unit)}`)),
      h('strong', {}, fmtBRL(p.priceCents)))));
  const m = modal({ title: 'Selecione o produto', body: lista, size: 'modal-lg' });
  m.el.addEventListener('hidden.bs.modal', () => busca.focus());
  setTimeout(() => lista.querySelector('button')?.focus(), 150);
}

function pedirQuantidade(product) {
  const campo = h('input', { class: 'form-control form-control-lg', inputmode: 'decimal', value: '1' });
  const previa = h('div', { class: 'mt-2 f-w-600' });
  const atualizar = () => {
    previa.textContent = `${fmtQty(parseQty(campo.value), product.unit)} × ${fmtBRL(product.priceCents)}/${product.unit} = ${fmtBRL(Math.round(product.priceCents * parseQty(campo.value)))}`;
  };
  campo.oninput = atualizar;
  atualizar();

  const ok = h('button', { class: 'btn btn-primary' }, 'Adicionar');
  const m = modal({
    title: `${product.name} — quantidade em ${product.unit}`,
    body: h('div', {}, campo, previa,
      h('div', { class: 'form-text' }, 'Produto vendido por peso: aceita decimais (ex.: 0,742).')),
    footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar'), ok],
  });
  const confirmar = () => {
    const qty = parseQty(campo.value);
    if (qty <= 0) return toast('Quantidade inválida.', 'warning');
    m.close();
    addProduct(product, qty);
  };
  ok.onclick = confirmar;
  campo.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } };
  m.el.addEventListener('hidden.bs.modal', () => busca.focus());
  setTimeout(() => { campo.focus(); campo.select(); }, 150);
}

function alterarQuantidade(index) {
  const item = state.items[index];
  const campo = h('input', { class: 'form-control form-control-lg', inputmode: 'decimal', value: fmtQty(item.quantity) });
  const ok = h('button', { class: 'btn btn-primary' }, 'Alterar');
  const m = modal({ title: `Quantidade — ${item.name}`, body: campo, footer: [ok] });
  const confirmar = () => {
    const qty = parseQty(campo.value);
    if (qty <= 0) return toast('Quantidade inválida.', 'warning');
    if (item.saleType === 'UNIT' && !Number.isInteger(qty)) return toast('Este produto é vendido por unidade.', 'warning');
    item.quantity = qty;
    m.close();
    render();
  };
  ok.onclick = confirmar;
  campo.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } };
  m.el.addEventListener('hidden.bs.modal', () => busca.focus());
  setTimeout(() => { campo.focus(); campo.select(); }, 150);
}

function aplicarDesconto() {
  const escopo = h('select', { class: 'form-select mb-2' },
    h('option', { value: 'venda' }, 'Desconto na venda'),
    state.index >= 0 ? h('option', { value: 'item' }, `Desconto no item: ${state.items[state.index]?.name ?? ''}`) : null);
  const valor = h('input', { class: 'form-control form-control-lg', inputmode: 'decimal', placeholder: '0,00' });
  const tipo = h('select', { class: 'form-select mt-2' },
    h('option', { value: 'valor' }, 'Em reais (R$)'),
    h('option', { value: 'pct' }, 'Em porcentagem (%)'));

  const ok = h('button', { class: 'btn btn-primary' }, 'Aplicar');
  const m = modal({ title: 'Desconto', body: h('div', {}, escopo, valor, tipo), footer: [ok] });
  ok.onclick = () => {
    const base = escopo.value === 'item' ? itemGross(state.items[state.index]) : subtotal() - itemDiscounts();
    const cents = tipo.value === 'pct'
      ? Math.round((base * parseQty(valor.value)) / 100)
      : moneyToCents(valor.value);
    if (cents < 0 || cents > base) return toast('Desconto maior que o valor.', 'warning');
    if (escopo.value === 'item') state.items[state.index].discountCents = cents;
    else state.discountCents = cents;
    m.close();
    render();
  };
  valor.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } };
  m.el.addEventListener('hidden.bs.modal', () => busca.focus());
  setTimeout(() => valor.focus(), 150);
}

async function escolherCliente() {
  const campo = h('input', { class: 'form-control', placeholder: 'Nome, telefone ou CPF' });
  const lista = h('div', { class: 'list-group mt-2 lf-pdv-sugestoes' });
  const carregar = async () => {
    const { rows } = await get('/customers', { q: campo.value, pageSize: 8 });
    lista.replaceChildren(...(rows.length ? rows.map((c) => h('button', {
      class: 'list-group-item list-group-item-action',
      onclick: () => { state.customer = c; m.close(); render(); },
    }, h('strong', {}, c.name), h('small', { class: 'd-block txt-secondary' }, c.phone || c.document || '')))
      : [h('div', { class: 'list-group-item txt-secondary' }, 'Nenhum cliente encontrado.')]));
  };
  campo.oninput = () => carregar();

  const limpar = h('button', { class: 'btn btn-light' }, 'Vender sem cliente');
  const m = modal({ title: 'Cliente da venda', body: h('div', {}, campo, lista), footer: [limpar] });
  limpar.onclick = () => { state.customer = null; m.close(); render(); };
  m.el.addEventListener('hidden.bs.modal', () => busca.focus());
  setTimeout(() => campo.focus(), 150);
  carregar();
}

// ---------- vendas suspensas ----------
const lerSuspensas = () => JSON.parse(localStorage.getItem(SUSPENSAS) || '[]');
const gravarSuspensas = (rows) => localStorage.setItem(SUSPENSAS, JSON.stringify(rows));

function suspender() {
  if (!state.items.length) return toast('Nada para suspender.', 'warning');
  const rows = lerSuspensas();
  rows.push({
    id: novaChave(), at: new Date().toISOString(),
    items: state.items, customer: state.customer, discountCents: state.discountCents,
    totalCents: total(),
  });
  gravarSuspensas(rows);
  limpar();
  toast('Venda suspensa. Use F9 para recuperar.');
}

function recuperar() {
  const rows = lerSuspensas();
  if (!rows.length) return toast('Nenhuma venda suspensa.', 'warning');
  const lista = h('div', { class: 'list-group lf-pdv-sugestoes' }, rows.map((r) => h('button', {
    class: 'list-group-item list-group-item-action d-flex justify-content-between',
    onclick: () => {
      state.items = r.items; state.customer = r.customer; state.discountCents = r.discountCents;
      gravarSuspensas(lerSuspensas().filter((x) => x.id !== r.id));
      m.close();
      render();
    },
  },
    h('span', {}, `${r.items.length} item(ns)`,
      h('small', { class: 'd-block txt-secondary' }, new Date(r.at).toLocaleString('pt-BR'))),
    h('strong', {}, fmtBRL(r.totalCents)))));
  const m = modal({ title: 'Vendas suspensas', body: lista });
  m.el.addEventListener('hidden.bs.modal', () => busca.focus());
}

function limpar() {
  state.items = [];
  state.customer = null;
  state.discountCents = 0;
  state.index = -1;
  render();
  busca.focus();
}

// ---------- pagamento ----------
/**
 * Painel de pagamento: formas numeradas (a tecla é o número), valor em mono e
 * um único número grande dizendo o que falta — ou o troco.
 */
function finalizar() {
  if (!state.items.length) return toast('Adicione produtos antes de finalizar.', 'warning');
  if (!state.session) return toast('Abra o caixa antes de vender.', 'error');

  const devido = total();
  /** Cada pagamento guarda o que abate da venda e o que o cliente entregou. */
  const pagamentos = [];
  const pago = () => pagamentos.reduce((s, p) => s + p.amountCents, 0);
  const restante = () => devido - pago();
  const trocoTotal = () => pagamentos.reduce((s, p) => s + (p.receivedCents - p.amountCents), 0);

  const digitado = () => moneyToCents(valor.value);
  /** Do que foi digitado, quanto abate a venda (o excedente em dinheiro é troco). */
  const aplicavel = () => Math.min(digitado(), restante());
  const trocoPrevisto = () => (metodo?.requiresChange ? Math.max(0, digitado() - restante()) : 0);

  const passo = h('div', { class: 'pay-step' });
  const linhas = h('div', { class: 'pay-lines' });
  const restanteBox = h('strong', { class: 'pay-remaining lf-num' });
  const trocoBox = h('div', { class: 'pay-change d-none' });
  const valor = h('input', {
    class: 'pay-amount lf-num', inputmode: 'decimal', placeholder: '0,00',
    'aria-label': 'Valor deste pagamento',
  });
  const parcelas = h('select', { class: 'form-select d-none' });

  /** Botão único: vira "Avançar" quando o valor digitado não cobre o total. */
  const acaoTexto = h('span', {}, 'Confirmar venda');
  const acao = h('button', { class: 'pdv-finish' }, acaoTexto, h('span', { class: 'pdv-key' }, 'F10'));

  let metodo = state.methods[0];
  let escolhendo = false; // aguardando a forma do valor restante
  let editando = -1;      // índice do pagamento sendo corrigido

  const botoes = state.methods.map((m, i) => h('button', {
    class: `pay-method${i === 0 ? ' is-on' : ''}`,
    onclick: () => selecionar(m),
  }, h('span', { class: 'pdv-key' }, String(i + 1)), m.name));

  function selecionar(m) {
    metodo = m;
    botoes.forEach((b, i) => b.classList.toggle('is-on', state.methods[i].id === m.id));
    parcelas.classList.toggle('d-none', !m.allowsInstallments);
    if (m.allowsInstallments) {
      const base = aplicavel() || restante();
      parcelas.replaceChildren(...Array.from({ length: m.maxInstallments }, (_, n) =>
        h('option', { value: n + 1 }, `${n + 1}x de ${fmtBRL(Math.round(base / (n + 1)))}`)));
    }
    if (escolhendo) {
      escolhendo = false;
      valor.value = centsToInput(restante());
    }
    atualizar({ mantemValor: true });
    valor.focus();
    valor.select();
  }

  const dividir = (fracao) => {
    valor.value = centsToInput(fracao === 1 ? restante() : Math.round(restante() * fracao));
    escolhendo = false;
    atualizar({ mantemValor: true });
    valor.focus();
    valor.select();
  };

  const chips = h('div', { class: 'pay-chips' },
    h('button', { class: 'pay-chip', onclick: () => dividir(1) }, 'Tudo que falta'),
    h('button', { class: 'pay-chip', onclick: () => dividir(0.5) }, 'Metade'),
    h('button', {
      class: 'pay-chip',
      onclick: () => { valor.value = ''; escolhendo = false; atualizar({ mantemValor: true }); valor.focus(); },
    }, 'Outro valor'));

  /** Linha já lançada: em modo leitura mostra o que foi pago; em edição, o campo. */
  function linhaPagamento(p, i) {
    const troco = p.receivedCents - p.amountCents;
    const detalhe = troco > 0
      ? `recebido ${fmtBRL(p.receivedCents)} · troco ${fmtBRL(troco)}`
      : (p.installments > 1 ? `${p.installments}x de ${fmtBRL(Math.round(p.amountCents / p.installments))}` : '');

    if (editando !== i) {
      return h('div', { class: 'pay-line' },
        h('span', {}, h('strong', {}, p.methodName),
          detalhe ? h('small', { class: 'd-block txt-secondary' }, detalhe) : null),
        h('span', { class: 'd-flex align-items-center gap-3' },
          h('span', { class: 'pay-line-amount lf-num' }, fmtBRL(p.receivedCents)),
          h('button', {
            class: 'pay-undo', title: `Editar o valor em ${p.methodName}`,
            onclick: () => { editando = i; atualizar({ mantemValor: true }); },
          }, 'editar'),
          h('button', {
            class: 'pay-undo', title: `Desfazer ${p.methodName}`,
            onclick: () => { pagamentos.splice(i, 1); editando = -1; escolhendo = false; atualizar(); },
          }, 'desfazer')));
    }

    // edição no lugar: o valor recebido daquela forma
    const campo = h('input', {
      class: 'pay-amount pay-amount--inline lf-num', inputmode: 'decimal',
      value: centsToInput(p.receivedCents), 'aria-label': `Valor recebido em ${p.methodName}`,
    });
    const salvar = () => {
      const novo = moneyToCents(campo.value);
      const outros = pagamentos.reduce((s, x, j) => (j === i ? s : s + x.amountCents), 0);
      const cabe = devido - outros;
      if (novo <= 0) {
        pagamentos.splice(i, 1);
      } else if (!p.requiresChange && novo > cabe) {
        return toast(`${p.methodName} não recebe mais que ${fmtBRL(cabe)} nesta venda.`, 'warning');
      } else {
        p.amountCents = Math.min(novo, cabe);
        p.receivedCents = novo;
      }
      editando = -1;
      atualizar();
      valor.focus();
    };
    campo.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); salvar(); }
      if (e.key === 'Escape') { e.preventDefault(); editando = -1; atualizar(); }
    };
    setTimeout(() => { campo.focus(); campo.select(); }, 30);

    return h('div', { class: 'pay-line pay-line--editing' },
      h('span', {}, h('strong', {}, p.methodName)),
      h('span', { class: 'd-flex align-items-center gap-2' },
        campo,
        h('button', { class: 'pay-chip', onclick: salvar }, 'Salvar'),
        h('button', {
          class: 'pay-chip', onclick: () => { editando = -1; atualizar(); },
        }, 'Cancelar')));
  }

  const atualizar = ({ mantemValor = false } = {}) => {
    const falta = restante();
    // editar um pagamento pode fechar a conta: aí não há mais o que escolher
    if (falta <= 0) escolhendo = false;
    const aLancar = aplicavel();
    const sobra = falta - aLancar;
    const troco = trocoTotal() + trocoPrevisto();

    restanteBox.textContent = falta > 0 ? `Falta ${fmtBRL(falta)}` : 'Pagamento completo';
    restanteBox.dataset.tone = falta > 0 ? 'due' : 'done';

    linhas.replaceChildren(...pagamentos.map(linhaPagamento));

    if (!mantemValor && falta > 0 && !escolhendo) valor.value = centsToInput(falta);
    if (falta <= 0 && !mantemValor) valor.value = '';

    passo.dataset.tone = escolhendo ? 'due' : 'go';
    passo.textContent = falta <= 0
      ? (troco > 0 ? `Tudo pago. Troco de ${fmtBRL(troco)}.` : 'Tudo pago. Confirme a venda.')
      : escolhendo
        ? `Selecione a forma de pagamento para os ${fmtBRL(falta)} restantes.`
        : trocoPrevisto() > 0
          ? `${fmtBRL(aLancar)} em ${metodo.name} · troco de ${fmtBRL(trocoPrevisto())}.`
          : sobra > 0
            ? `${fmtBRL(aLancar)} nesta forma — sobram ${fmtBRL(sobra)} para a próxima.`
            : `${fmtBRL(falta)} em ${metodo.name}.`;

    const vaiAvancar = falta > 0 && (escolhendo || sobra > 0 || aLancar <= 0);
    acaoTexto.textContent = vaiAvancar ? 'Avançar' : 'Confirmar venda';
    acao.classList.toggle('pdv-finish--step', vaiAvancar);
    acao.disabled = escolhendo || editando >= 0 || (falta > 0 && aLancar <= 0);
    chips.classList.toggle('d-none', falta <= 0);

    if (troco > 0) {
      trocoBox.replaceChildren(h('span', {}, 'Troco'), h('strong', { class: 'lf-num' }, fmtBRL(troco)));
      trocoBox.classList.remove('d-none');
    } else trocoBox.classList.add('d-none');
  };

  const lancar = () => {
    const entregue = digitado();
    const abate = aplicavel();
    if (abate <= 0) return false;
    if (!metodo.requiresChange && entregue > restante()) {
      toast(`${metodo.name} não recebe mais que ${fmtBRL(restante())} nesta venda.`, 'warning');
      return false;
    }
    pagamentos.push({
      paymentMethodId: metodo.id, methodName: metodo.name,
      amountCents: abate,
      receivedCents: metodo.requiresChange ? entregue : abate,
      installments: metodo.allowsInstallments ? Number(parcelas.value || 1) : 1,
      requiresChange: metodo.requiresChange,
    });
    return true;
  };

  /** Uma ação só: lança o que está digitado e, se faltar, pede a próxima forma. */
  const avancar = async () => {
    if (editando >= 0) return;
    if (restante() > 0) {
      // PIX com gateway habilitado: cobra online (QR + polling) antes de lançar.
      if (metodo?.type === 'pix' && state.pixEnabled && aplicavel() > 0) {
        acao.disabled = true;
        const okPix = await cobrarPix(aplicavel(), state.customer);
        acao.disabled = false;
        if (!okPix) return; // cancelado ou não pago
      }
      if (!lancar()) return;
      if (restante() > 0) {
        escolhendo = true;
        valor.value = '';
        atualizar({ mantemValor: true });
        const proxima = state.methods.findIndex((mm) => !pagamentos.some((p) => p.paymentMethodId === mm.id));
        botoes[proxima >= 0 ? proxima : 0].focus();
        return;
      }
      atualizar();
    }
    await confirmar();
  };

  valor.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); avancar(); } };
  valor.oninput = () => atualizar({ mantemValor: true });
  acao.onclick = avancar;

  const m = modal({
    title: `Pagamento · total ${fmtBRL(devido)}`,
    size: 'modal-lg lf-pay',
    body: h('div', {},
      passo,
      h('label', { class: 'pdv-label mt-3' }, 'Forma de pagamento'),
      h('div', { class: 'pay-methods' }, botoes),
      h('div', { class: 'pay-block' },
        h('div', { class: 'd-flex justify-content-between align-items-baseline' },
          h('label', { class: 'pdv-label' }, 'Valor recebido nesta forma'),
          restanteBox),
        h('div', { class: 'row g-2 align-items-center' },
          h('div', { class: 'col-12 col-md-7' }, valor),
          h('div', { class: 'col-12 col-md-5' }, parcelas)),
        chips,
        h('div', { class: 'pay-hint' },
          'Em dinheiro, digite o que o cliente entregou: o que passar do total vira troco.')),
      trocoBox,
      linhas),
    footer: [
      h('button', { class: 'pdv-hold', 'data-bs-dismiss': 'modal' }, 'Cancelar (ESC)'),
      acao,
    ],
  });

  // 1..9 escolhe a forma de pagamento sem tirar a mão do teclado
  m.el.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return; // digitando valor: número é número
    const n = Number(e.key);
    if (n >= 1 && n <= state.methods.length) {
      e.preventDefault();
      selecionar(state.methods[n - 1]);
    }
  });

  async function confirmar() {
    acao.disabled = true;
    try {
      const venda = await post('/sales', {
        branchId: state.branchId || undefined,
        cashSessionId: state.session.id,
        customerId: state.customer?.id,
        discountCents: state.discountCents,
        idempotencyKey: novaChave(),
        items: state.items.map((i) => ({
          productId: i.productId, quantity: i.quantity, discountCents: i.discountCents,
        })),
        payments: pagamentos.map((p) => ({
          paymentMethodId: p.paymentMethodId, amountCents: p.amountCents,
          installments: p.installments,
          receivedCents: p.requiresChange ? p.receivedCents : undefined,
        })),
      });
      // o resumo só entra depois que o painel de pagamento saiu de cena: abrir os
      // dois juntos empilha backdrop (aparecia offline, sem a espera da rede)
      await fechado(m);
      const itens = [...state.items];
      const trocoLocal = trocoTotal();
      limpar();
      carregarCaixa();
      if (venda.offline) {
        vendaConcluida({ items: itens, payments: pagamentos, totalCents: devido, changeCents: trocoLocal },
          { offline: true });
      } else {
        vendaConcluida(venda);
        if (state.settings?.autoPrint) imprimir(venda);
      }
    } catch (e) {
      acao.disabled = false;
      toast(e.message, 'error');
    }
  }

  m.el.addEventListener('hidden.bs.modal', () => busca.focus());
  valor.value = centsToInput(devido);
  atualizar({ mantemValor: true });
  setTimeout(() => { valor.focus(); valor.select(); }, 150);
}

/** Espera o modal terminar de fechar (com saída de emergência se a animação falhar). */
function fechado(m) {
  return new Promise((resolve) => {
    let pronto = false;
    const fim = () => { if (!pronto) { pronto = true; resolve(); } };
    m.el.addEventListener('hidden.bs.modal', fim, { once: true });
    m.close();
    setTimeout(fim, 500);
  });
}

/**
 * Cobrança PIX pelo gateway Blue: gera o QR, mostra copia-e-cola e faz polling do
 * status. Resolve `true` quando o pagamento é confirmado; `false` se cancelar.
 */
async function cobrarPix(amountCents, customer) {
  const corpo = h('div', { class: 'py-3' }, h('div', { class: 'lf-skeleton', style: 'height:240px' }));
  const cancelar = h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar');
  const m = modal({ title: `PIX · ${fmtBRL(amountCents)}`, body: corpo, footer: [cancelar], size: 'lf-pay' });

  let charge;
  try {
    charge = await post('/payments/pix', {
      amountCents,
      customer: customer ? { name: customer.name, document: customer.document } : undefined,
    });
  } catch (e) {
    toast(e.message, 'error');
    m.close();
    return false;
  }
  if (charge.paid) { m.close(); return true; }

  const statusLinha = h('div', { class: 'mt-3 txt-secondary' }, 'Aguardando pagamento…');
  const copia = h('input', { class: 'form-control text-center', readonly: true, value: charge.qrcode });
  const copiar = h('button', { class: 'btn btn-outline-secondary', type: 'button' }, 'Copiar código');
  copiar.onclick = async () => {
    try { await navigator.clipboard.writeText(charge.qrcode); toast('Pix copia e cola copiado.'); }
    catch { copia.select(); document.execCommand('copy'); }
  };
  corpo.replaceChildren(h('div', { class: 'text-center' },
    h('img', { src: charge.qrImage, alt: 'QR Code PIX', style: 'width:240px;height:240px;max-width:100%' }),
    h('p', { class: 'mt-2 mb-1 f-w-600' }, 'Escaneie o QR ou use o Pix Copia e Cola'),
    h('div', { class: 'd-flex gap-2 justify-content-center align-items-center' }, copia, copiar),
    statusLinha,
    h('div', { class: 'd-flex align-items-center justify-content-center gap-2 mt-3 txt-secondary f-12' },
      h('span', {}, 'Pagamento processado por'),
      h('img', { src: '/icons/brand.png', alt: 'Blue', style: 'height:18px;width:auto' }))));

  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (v) => { if (!done) { done = true; if (timer) clearTimeout(timer); resolve(v); } };
    m.el.addEventListener('hidden.bs.modal', () => finish(false), { once: true });
    const poll = async () => {
      if (done) return;
      let s = null;
      try { s = await get(`/payments/pix/${charge.id}`); } catch { /* rede: tenta de novo */ }
      if (s?.paid) {
        statusLinha.textContent = 'Pagamento confirmado ✓';
        statusLinha.className = 'mt-3 text-success f-w-600';
        setTimeout(() => { m.close(); finish(true); }, 700);
        return;
      }
      timer = setTimeout(poll, 4000);
    };
    timer = setTimeout(poll, 4000);
  });
}

/**
 * Fim da venda: um resumo que o operador lê de longe (troco em destaque) e um
 * único caminho adiante — nova venda. Enter/F10 já seguem para a próxima.
 */
function vendaConcluida(venda, { offline = false } = {}) {
  const troco = venda.changeCents ?? 0;
  const nova = h('button', { class: 'pdv-finish' }, 'Nova venda', h('span', { class: 'pdv-key' }, 'F10'));
  const imprimir_ = h('button', { class: 'pdv-hold' }, 'Imprimir comprovante');

  const corpo = h('div', { class: 'pay-done' },
    h('div', { class: 'pay-done-mark' }, '✓'),
    h('div', { class: 'pay-done-title' }, offline ? 'Venda guardada neste aparelho' : `Venda #${venda.number} concluída`),
    offline
      ? h('div', { class: 'pay-done-sub' }, 'Ela sobe sozinha quando a conexão voltar. Nada será duplicado.')
      : h('div', { class: 'pay-done-sub' }, `${venda.items.length} item(ns) · ${venda.payments.map((p) => p.methodName).join(' + ')}`),
    h('div', { class: 'pay-done-grid' },
      h('div', {},
        h('div', { class: 'pdv-stat-label' }, 'Total da venda'),
        h('div', { class: 'pay-done-total lf-num' }, fmtBRL(venda.totalCents))),
      troco > 0
        ? h('div', { class: 'pay-done-change' },
            h('div', { class: 'pdv-display-label' }, 'Troco para o cliente'),
            h('div', { class: 'pay-done-total lf-num' }, fmtBRL(troco)))
        : null));

  const m = modal({
    title: offline ? 'Venda registrada' : 'Venda concluída',
    size: 'lf-pay lf-done',
    body: corpo,
    footer: [offline ? null : imprimir_, nova].filter(Boolean),
  });

  imprimir_.onclick = () => imprimir(venda);
  nova.onclick = () => m.close();
  m.el.addEventListener('hidden.bs.modal', () => busca.focus());
  setTimeout(() => nova.focus(), 150);
  return m;
}

/** Comprovante não fiscal: a janela de impressão do navegador resolve. */
function imprimir(venda) {
  const linha = (a, b) => h('tr', {}, h('td', {}, a), h('td', { class: 'text-end' }, b));
  const box = h('div', { class: 'lf-recibo lf-recibo-print' },
    h('div', { class: 'text-center' },
      h('strong', {}, state.me.company.tradeName || state.me.company.name),
      h('div', {}, state.me.company.document || ''),
      h('div', {}, `Venda #${venda.number} · ${venda.soldAt}`),
      h('div', {}, `Operador: ${state.me.user.name}`)),
    h('hr'),
    h('table', {}, h('tbody', {}, venda.items.map((i) =>
      linha(`${fmtQty(i.quantity, i.unit)} × ${i.name}`, fmtBRL(i.totalCents))))),
    h('hr'),
    h('table', {}, h('tbody', {},
      linha('Subtotal', fmtBRL(venda.subtotalCents)),
      linha('Desconto', fmtBRL(venda.discountCents)),
      linha(h('strong', {}, 'TOTAL'), h('strong', {}, fmtBRL(venda.totalCents))),
      ...venda.payments.map((p) => linha(p.methodName, fmtBRL(p.amountCents))),
      venda.changeCents ? linha('Troco', fmtBRL(venda.changeCents)) : null)),
    h('hr'),
    h('div', { class: 'text-center f-12' }, state.receiptFooter || 'Documento sem valor fiscal.'));

  document.body.append(box);
  document.body.classList.add('lf-printing');
  window.print();
  document.body.classList.remove('lf-printing');
  box.remove();
}

// ---------- caixa ----------
async function carregarCaixa() {
  const data = await get('/cash/current', { branchId: state.branchId });
  state.session = data.session;
  state.summary = data.summary;
  state.otherOpen = data.otherOpen;
  render();
}

/**
 * Abertura de caixa. Sem sessão aberta o PDV não opera: o modal é obrigatório
 * (sem X, sem ESC) e a única saída é abrir o caixa ou sair do PDV.
 */
async function abrirCaixa({ bloqueante = false } = {}) {
  const { rows } = await get('/cash/registers', { branchId: state.branchId });
  const livres = rows.filter((r) => r.active && !r.openSession);
  const ocupados = rows.filter((r) => r.openSession);

  if (!livres.length && !bloqueante) return toast('Todos os PDVs já estão abertos.', 'warning');

  const pdv = h('select', { class: 'form-select form-select-lg' }, livres.map((r) =>
    h('option', { value: r.id }, `${r.name} · ${r.branch}`)));
  const inicial = h('input', {
    class: 'pay-amount lf-num', inputmode: 'decimal', value: '0,00',
    'aria-label': 'Valor inicial em dinheiro',
  });
  const ok = h('button', { class: 'pdv-finish' }, 'Abrir caixa', h('span', { class: 'pdv-key' }, 'Enter'));
  const sair = h('button', { class: 'pdv-hold' }, 'Sair do PDV');

  const corpo = livres.length
    ? h('div', {},
        h('div', { class: 'pay-step' }, bloqueante
          ? 'Para vender, abra o caixa e informe quanto tem de troco na gaveta.'
          : 'Informe o PDV e o fundo de troco.'),
        h('label', { class: 'pdv-label mt-3' }, 'PDV'), pdv,
        h('label', { class: 'pdv-label mt-3' }, 'Valor inicial (fundo de troco)'), inicial,
        h('div', { class: 'pay-hint' }, 'É o dinheiro que já está na gaveta. Zero também vale.'),
        ocupados.length
          ? h('div', { class: 'pay-hint' },
              `Em uso: ${ocupados.map((r) => `${r.name} (${r.openSession.operator ?? 'outro operador'})`).join(' · ')}`)
          : null)
    : h('div', {},
        h('div', { class: 'pay-step', dataset: { tone: 'due' } }, 'Todos os PDVs desta filial já estão abertos.'),
        h('div', { class: 'pay-hint' },
          ocupados.map((r) => `${r.name}: ${r.openSession.operator ?? 'outro operador'}`).join(' · ')
          || 'Nenhum PDV cadastrado. Peça ao administrador para criar um em Empresa.'));

  state.bloqueado = bloqueante;
  const m = modal({
    title: 'Abertura de caixa',
    size: 'lf-pay',
    dismissible: !bloqueante,
    body: corpo,
    footer: [bloqueante ? sair : null, livres.length ? ok : null].filter(Boolean),
  });

  sair.onclick = () => { location.href = '/'; };
  const confirmarAbertura = async () => {
    ok.disabled = true;
    try {
      const escolhido = livres.find((r) => r.id === pdv.value);
      await post('/cash/open', {
        registerId: pdv.value, branchId: escolhido?.branchId,
        openingCents: moneyToCents(inicial.value),
      });
      state.bloqueado = false;
      m.close();
      toast('Caixa aberto. Bom trabalho!');
      await carregarCaixa();
      busca.focus();
    } catch (e) {
      ok.disabled = false;
      toast(e.message, 'error');
    }
  };
  ok.onclick = confirmarAbertura;
  inicial.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarAbertura(); } };
  m.el.addEventListener('hidden.bs.modal', () => { state.bloqueado = false; busca.focus(); });
  setTimeout(() => { inicial.focus(); inicial.select(); }, 200);
  return m;
}

async function sangriaOuSuprimento(tipo) {
  if (!state.session) return toast('Nenhum caixa aberto.', 'warning');
  const valor = h('input', { class: 'form-control form-control-lg', inputmode: 'decimal', placeholder: '0,00' });
  const motivo = h('input', { class: 'form-control mt-2', placeholder: 'Motivo' });
  const ok = h('button', { class: 'btn btn-primary' }, 'Confirmar');
  const m = modal({ title: tipo === 'sangria' ? 'Sangria' : 'Suprimento', body: h('div', {}, valor, motivo), footer: [ok] });
  ok.onclick = async () => {
    try {
      await post(`/cash/sessions/${state.session.id}/${tipo}`, {
        amountCents: moneyToCents(valor.value), reason: motivo.value.trim(),
      });
      m.close();
      toast('Registrado.');
      carregarCaixa();
    } catch (e) { toast(e.message, 'error'); }
  };
  setTimeout(() => valor.focus(), 150);
}

// ---------- render ----------
const relogio = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Linha de cupom: nome grande, conta em mono embaixo, total à direita. */
function linhaItem(item, index) {
  return h('li', {
    class: `pdv-line${index === state.index ? ' is-current' : ''}`,
    onclick: () => { state.index = index; render(); },
  },
    h('span', { class: 'pdv-line-idx lf-num' }, String(index + 1).padStart(2, '0')),
    h('div', {},
      h('div', { class: 'pdv-line-name' }, item.name),
      h('button', {
        class: 'pdv-line-calc lf-num',
        title: 'Alterar quantidade',
        onclick: (e) => { e.stopPropagation(); alterarQuantidade(index); },
      }, `${fmtQty(item.quantity, item.unit)} × ${fmtBRL(item.unitPriceCents)}`),
      item.discountCents
        ? h('span', { class: 'pdv-line-tag lf-num' }, `− ${fmtBRL(item.discountCents)}`)
        : null,
      item.stock !== undefined && item.stock < item.quantity
        ? h('span', { class: 'pdv-line-tag' }, `estoque ${fmtQty(item.stock, item.unit)}`)
        : null),
    h('span', { class: 'pdv-line-total lf-num' }, fmtBRL(itemTotal(item))),
    h('button', {
      class: 'pdv-line-del', 'aria-label': `Remover ${item.name}`,
      onclick: (e) => { e.stopPropagation(); removeItem(index); },
    }, '×'));
}

function painelCaixa() {
  if (!state.session) {
    return h('div', { class: 'pdv-card' },
      h('span', { class: 'pdv-label' }, 'Caixa'),
      h('div', { class: 'pdv-alert' }, 'Nenhum caixa aberto para você.'),
      state.otherOpen
        ? h('div', { class: 'pdv-hint' },
            `${state.otherOpen.register?.name} está com ${state.otherOpen.operator?.name ?? 'outro operador'}.`)
        : null,
      h('button', { class: 'pdv-btn pdv-btn--fill pdv-btn--wide mt-3', onclick: () => abrirCaixa({ bloqueante: true }) }, 'Abrir caixa'));
  }
  const t = state.summary?.totals;
  return h('div', { class: 'pdv-card' },
    h('div', { class: 'pdv-row' },
      h('span', { class: 'pdv-label mb-0' }, state.session.register?.name ?? 'Caixa'),
      h('span', { class: 'pdv-chip', dataset: { tone: 'open' } }, `aberto ${state.session.openedAt?.slice(11) ?? ''}`)),
    h('div', { class: 'pdv-row mt-3' },
      h('span', { class: 'pdv-row-label' }, 'Dinheiro na gaveta'),
      h('span', { class: 'pdv-row-value lf-num' }, fmtBRL(state.summary?.cashOnHandCents ?? 0))),
    h('div', { class: 'pdv-row' },
      h('span', { class: 'pdv-row-label' }, `Vendas da sessão${t ? ` (${t.salesCount})` : ''}`),
      h('span', { class: 'pdv-row-value lf-num' }, fmtBRL(t?.salesCents ?? 0))),
    h('div', { class: 'pdv-btn-group' },
      h('button', { class: 'pdv-btn', onclick: () => sangriaOuSuprimento('sangria') }, 'Sangria'),
      h('button', { class: 'pdv-btn', onclick: () => sangriaOuSuprimento('suprimento') }, 'Suprimento'),
      h('a', { class: 'pdv-btn text-center', href: `/sessao.html?id=${state.session.id}` }, 'Fechar')));
}

const atalho = (tecla, texto) => h('span', {}, h('span', { class: 'pdv-key' }, tecla), texto);

function render() {
  const itens = state.items;
  const valorTotal = total();

  const fita = itens.length
    ? h('ul', { class: 'pdv-tape-list' }, itens.map(linhaItem))
    : h('div', { class: 'pdv-empty' },
        h('div', { class: 'pdv-empty-code' }, '||‖|‖||‖|‖‖|||‖|'),
        h('strong', {}, 'Passe o produto pelo leitor'),
        h('span', {}, 'Ou digite o nome no campo ao lado e pressione Enter.'));

  root.replaceChildren(
    h('header', { class: 'pdv-rail' },
      h('span', { class: 'pdv-brand d-flex align-items-center gap-2' },
        h('img', { src: '/icons/brand-white.png', alt: 'Blue', style: 'height:20px;width:auto' }),
        h('span', {}, 'PDV')),
      h('span', { class: 'pdv-rail-sep' }),
      h('span', { class: 'pdv-rail-item' }, 'Operador ', h('strong', {}, state.me.user.name)),
      h('span', { class: 'pdv-rail-item d-none d-lg-inline' }, state.me.company.tradeName || state.me.company.name),
      h('div', { class: 'pdv-rail-right' },
        h('span', { id: 'lf-pdv-fila' }),
        h('span', { class: 'pdv-clock lf-num' }, relogio()),
        h('button', { class: 'pdv-exit', onclick: () => { location.href = '/'; } }, 'Sair do PDV'))),

    h('section', { class: 'pdv-tape' },
      h('div', { class: 'pdv-tape-head' },
        h('span', { class: 'pdv-tape-title' }, 'Itens da venda'),
        h('span', { class: 'pdv-tape-count lf-num' },
          `${itens.length} item(ns) · ${fmtQty(itens.reduce((s, i) => s + i.quantity, 0))} un.`)),
      fita),

    h('aside', { class: 'pdv-side' },
      h('div', { class: 'pdv-card' },
        h('label', { class: 'pdv-label', for: 'lf-scan' }, 'Código de barras ou produto'),
        busca,
        h('div', { class: 'pdv-hint' }, 'O leitor digita e envia sozinho. Enter adiciona ao cupom.')),
      h('div', { class: 'pdv-card' },
        h('div', { class: 'pdv-row' },
          h('div', {},
            h('span', { class: 'pdv-label mb-0' }, 'Cliente'),
            h('div', { class: 'pdv-customer' }, state.customer?.name ?? 'Não identificado')),
          h('button', { class: 'pdv-btn', onclick: escolherCliente },
            h('span', { class: 'pdv-key' }, 'F4'), ' Trocar'))),
      painelCaixa(),
      h('div', { class: 'pdv-shortcuts' },
        atalho('F2', 'buscar'), atalho('F4', 'cliente'),
        atalho('F6', 'desconto'), atalho('F8', 'suspender'),
        atalho('F9', 'recuperar'), atalho('F10', 'finalizar'),
        atalho('DEL', 'remover item'), atalho('ESC', 'limpar venda'))),

    h('footer', { class: 'pdv-total' },
      h('div', {},
        h('div', { class: 'pdv-stat-label' }, 'Subtotal'),
        h('div', { class: 'pdv-stat-value lf-num' }, fmtBRL(subtotal()))),
      h('div', {},
        h('div', { class: 'pdv-stat-label' }, 'Descontos'),
        h('div', { class: 'pdv-stat-value lf-num' }, fmtBRL(itemDiscounts() + state.discountCents))),
      h('div', {},
        h('div', { class: 'pdv-stat-label' }, 'Itens'),
        h('div', { class: 'pdv-stat-value lf-num' }, String(itens.length))),
      h('div', { class: 'pdv-display', id: 'lf-display' },
        h('div', { class: 'pdv-display-label' }, 'Total a pagar'),
        h('div', { class: 'pdv-display-value lf-num' }, fmtBRL(valorTotal))),
      h('button', { class: 'pdv-hold', onclick: suspender }, 'Suspender', h('span', { class: 'pdv-key ms-2' }, 'F8')),
      h('button', { class: 'pdv-finish', onclick: finalizar }, 'Finalizar', h('span', { class: 'pdv-key' }, 'F10'))),
  );

  // o display pisca quando o total muda — é o que o operador confere de longe
  if (valorTotal !== ultimoTotal) {
    const display = document.getElementById('lf-display');
    display?.classList.add('is-changed');
    setTimeout(() => display?.classList.remove('is-changed'), 260);
    ultimoTotal = valorTotal;
  }

  busca.focus();
  mostrarFila();
}

let ultimoTotal = 0;

async function mostrarFila() {
  const el = $('#lf-pdv-fila');
  if (!el) return;
  const fila = await pendentes();
  if (fila) {
    el.className = 'pdv-chip';
    el.dataset.tone = 'queue';
    el.textContent = `${fila} venda(s) na fila`;
  } else if (!navigator.onLine) {
    el.className = 'pdv-chip';
    el.dataset.tone = 'closed';
    el.textContent = 'sem conexão';
  } else {
    el.className = '';
    el.textContent = '';
  }
}

// ---------- atalhos ----------
function atalhos(e) {
  if (state.bloqueado) return; // caixa fechado: nada opera até abrir
  const dentroDeModal = !!document.querySelector('.modal.show');
  if (e.key === 'F2') { e.preventDefault(); busca.focus(); busca.select(); }
  if (e.key === 'F4') { e.preventDefault(); escolherCliente(); }
  if (e.key === 'F6') { e.preventDefault(); aplicarDesconto(); }
  if (e.key === 'F8') { e.preventDefault(); suspender(); }
  if (e.key === 'F9') { e.preventDefault(); recuperar(); }
  if (e.key === 'F10') {
    e.preventDefault();
    if (dentroDeModal) document.querySelector('.modal.show .pdv-finish')?.click();
    else finalizar();
  }
  if (e.key === 'Escape' && !dentroDeModal && state.items.length) {
    e.preventDefault();
    confirmAction('Limpar a venda atual?', { okLabel: 'Limpar' }).then((ok) => ok && limpar());
  }
  if (e.key === 'Delete' && !dentroDeModal && state.index >= 0) removeItem(state.index);
  if (e.key === 'ArrowUp' && !dentroDeModal && state.items.length) {
    e.preventDefault(); state.index = Math.max(0, state.index - 1); render();
  }
  if (e.key === 'ArrowDown' && !dentroDeModal && state.items.length) {
    e.preventDefault(); state.index = Math.min(state.items.length - 1, state.index + 1); render();
  }
}

async function boot() {
  busca = h('input', {
    class: 'pdv-scan', id: 'lf-scan', type: 'text', autocomplete: 'off',
    placeholder: 'Leia o código ou digite o nome…', 'aria-label': 'Buscar produto',
  });
  // leitor de código de barras se comporta como teclado: termina com Enter
  busca.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const termo = busca.value;
    busca.value = '';
    try { await buscar(termo); } catch (err) { toast(err.message, 'error'); }
  });

  try {
    state.me = await get('/auth/me');
  } catch { return; }
  if (!state.me.permissions.includes('pdv.acessar')) {
    root.replaceChildren(h('div', { class: 'lf-pdv-card m-4' }, 'Seu perfil não tem acesso ao PDV.'));
    return;
  }
  state.branchId = state.me.user.branchId || localStorage.getItem('lf.branch') || '';
  state.settings = state.me.company.settings;
  state.pixEnabled = state.me.company.pixEnabled;
  state.receiptFooter = state.me.company.settings?.receiptFooter;
  if (state.me.company.theme === 'dark') document.body.classList.add('dark-only');

  const { rows } = await get('/company/payment-methods');
  state.methods = rows.filter((m) => m.active);

  document.addEventListener('keydown', atalhos);
  window.addEventListener('online', async () => {
    const { enviados } = await sincronizar();
    if (enviados) toast(`${enviados} venda(s) enviada(s) ao servidor.`);
    mostrarFila();
  });
  document.addEventListener('lf:sincronizado', (e) => {
    if (e.detail?.enviados) toast(`${e.detail.enviados} venda(s) enviada(s) ao servidor.`);
    mostrarFila();
    carregarCaixa();
  });
  reenvioAutomatico();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  await carregarCaixa();
  render();
  if (!state.session) await abrirCaixa({ bloqueante: true });
  setInterval(() => {
    const el = document.querySelector('.pdv-clock');
    if (el) el.textContent = relogio();
  }, 30000);
}

boot();
