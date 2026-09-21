// Estoque numa tela só: posição, movimentações e entradas de mercadoria.
// ponytail: três abas no lugar de três itens de menu — é a mesma pergunta
// ("o que tem, como mudou, como chegou") vista de três ângulos.
import { get, post } from '../api.js';
import { pageTitle } from '../shell.js';
import {
  card, dataList, debounce, field, fmtBRL, fmtQty, h, icon, input, modal, mount, paginator,
  parseQty, refreshIcons, select, statCard, toast, todayStr,
} from '../ui.js';
import { entradaForm } from './entrada-form.js';

const ABAS = [
  { key: 'posicao', label: 'Posição' },
  { key: 'movimentacoes', label: 'Movimentações' },
  { key: 'entradas', label: 'Entradas de mercadoria' },
  { key: 'nova', label: 'Nova entrada', perm: 'estoque.entrada' },
];

const TIPOS = ['ENTRADA', 'SAIDA', 'VENDA', 'DEVOLUCAO', 'AJUSTE', 'PERDA', 'TRANSFERENCIA', 'CANCELAMENTO'];
const COR = {
  ENTRADA: 'success', DEVOLUCAO: 'success', CANCELAMENTO: 'success',
  VENDA: 'primary', SAIDA: 'secondary', AJUSTE: 'warning', PERDA: 'danger', TRANSFERENCIA: 'info',
};

export default async function render({ content, can, branchId }) {
  const params = new URLSearchParams(location.search);
  const abasVisiveis = ABAS.filter((a) => !a.perm || can(a.perm));
  const aba = abasVisiveis.some((a) => a.key === params.get('tab')) ? params.get('tab') : 'posicao';
  const podeMover = can('estoque.movimentar');

  const cards = h('div', { class: 'row' });
  const corpo = h('div', {});

  const abas = h('ul', { class: 'nav nav-tabs mb-3' }, abasVisiveis.map((a) => h('li', { class: 'nav-item' },
    h('a', {
      class: `nav-link${a.key === aba ? ' active' : ''}`,
      href: `/estoque.html?tab=${a.key}`,
    }, a.label))));

  mount(content,
    pageTitle('Estoque',
      can('estoque.entrada')
        ? h('a', { class: 'btn btn-primary', href: '/estoque.html?tab=nova' }, icon('plus', 16), ' Nova entrada')
        : null),
    cards,
    card(null, h('div', {}, abas, corpo)));

  // ---------- posição ----------
  function movimentar(produto, tipo) {
    const quantidade = input({ inputmode: 'decimal', value: tipo === 'AJUSTE' ? fmtQty(produto.quantity) : '' });
    const motivo = input({ value: '' });
    const salvar = h('button', { class: 'btn btn-primary' }, 'Confirmar');
    const m = modal({
      title: tipo === 'AJUSTE' ? `Ajustar estoque — ${produto.name}` : `${tipo} — ${produto.name}`,
      body: h('div', { class: 'row g-3' },
        h('div', { class: 'col-12' }, h('div', { class: 'alert alert-light mb-0' },
          `Saldo atual: ${fmtQty(produto.quantity, produto.unit)}`)),
        field(tipo === 'AJUSTE' ? 'Novo saldo' : 'Quantidade', quantidade, { col: 'col-12 col-md-6' }),
        field('Motivo', motivo, { col: 'col-12 col-md-6' })),
      footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar'), salvar],
    });
    salvar.onclick = async () => {
      try {
        const body = {
          productId: produto.id, branchId: branchId || undefined,
          reason: motivo.value.trim() || 'Sem motivo informado',
        };
        if (tipo === 'AJUSTE') await post('/stock/adjust', { ...body, quantity: parseQty(quantidade.value) });
        else await post('/stock/move', { ...body, type: tipo, quantity: parseQty(quantidade.value) });
        m.close();
        toast('Movimentação registrada.');
        posicao();
      } catch (e) { toast(e.message, 'error'); }
    };
    setTimeout(() => quantidade.focus(), 150);
  }

  async function posicao() {
    const state = { q: '', filter: params.get('filter') || '', page: 1, pageSize: 20, branchId };
    const lista = h('div', {});
    const rodape = h('div', {});

    const busca = input({ type: 'search', class: 'form-control', placeholder: 'Produto, SKU ou código' });
    busca.oninput = debounce(() => { state.q = busca.value; state.page = 1; carregar(); });

    const filtro = select([
      { value: '', label: 'Todos os produtos' },
      { value: 'baixo', label: 'Estoque baixo', selected: state.filter === 'baixo' },
      { value: 'zerado', label: 'Sem estoque', selected: state.filter === 'zerado' },
    ], { class: 'form-select' });
    filtro.onchange = () => { state.filter = filtro.value; state.page = 1; carregar(); };

    corpo.replaceChildren(
      h('div', { class: 'row g-2 mb-3' },
        h('div', { class: 'col-12 col-md-6' }, busca),
        h('div', { class: 'col-12 col-md-3' }, filtro)),
      lista, rodape);

    async function carregar() {
      lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:140px' }));
      const data = await get('/stock', state);
      const s = data.summary;

      cards.replaceChildren(
        statCard('Produtos', String(s.products), { iconName: 'package', color: '#7366ff' }),
        statCard('Unidades em estoque', fmtQty(s.units), { iconName: 'layers', color: '#16c7f9' }),
        statCard('Custo do estoque', fmtBRL(s.costCents), { iconName: 'dollar-sign', color: '#54ba4a' }),
        statCard('Alertas', `${s.low} baixo · ${s.out} zerado`, { iconName: 'alert-triangle', color: '#fc4438' }),
      );

      lista.replaceChildren(dataList({
        rows: data.rows,
        empty: 'Nenhum produto encontrado.',
        columns: [
          {
            label: 'Produto',
            cell: (p) => h('div', {},
              h('a', { class: 'f-w-600', href: `/produto.html?id=${p.id}` }, p.name),
              h('small', { class: 'd-block txt-secondary' }, [p.sku, p.category].filter(Boolean).join(' · '))),
          },
          {
            label: 'Saldo', className: 'text-end',
            cell: (p) => h('span', {
              class: `badge text-bg-${p.outOfStock ? 'danger' : p.lowStock ? 'warning' : 'light'}`,
            }, fmtQty(p.quantity, p.unit)),
          },
          { label: 'Mínimo', className: 'text-end', cell: (p) => fmtQty(p.minStock) },
          { label: 'Custo total', className: 'text-end', cell: (p) => fmtBRL(p.totalCostCents) },
          {
            label: '', className: 'text-end',
            cell: (p) => h('div', { class: 'd-flex gap-2 justify-content-end' },
              podeMover ? h('button', { class: 'btn btn-sm btn-outline-success', onclick: () => movimentar(p, 'ENTRADA') }, 'Entrada') : null,
              podeMover ? h('button', { class: 'btn btn-sm btn-outline-warning', onclick: () => movimentar(p, 'PERDA') }, 'Perda') : null,
              podeMover ? h('button', { class: 'btn btn-sm btn-outline-secondary', onclick: () => movimentar(p, 'AJUSTE') }, 'Ajustar') : null,
              h('a', {
                class: 'btn btn-sm btn-outline-secondary',
                href: `/estoque.html?tab=movimentacoes&productId=${p.id}`,
              }, 'Histórico')),
          },
        ],
      }));
      rodape.replaceChildren(paginator(data, (p) => { state.page = p; carregar(); }));
      refreshIcons(content);
    }

    await carregar();
  }

  // ---------- movimentações ----------
  async function movimentacoes() {
    const state = {
      productId: params.get('productId') || '', type: '',
      from: '', to: todayStr(), page: 1, pageSize: 25, branchId,
    };
    const lista = h('div', {});
    const rodape = h('div', {});

    const tipo = select([{ value: '', label: 'Todos os tipos' }, ...TIPOS.map((t) => ({ value: t, label: t }))],
      { class: 'form-select' });
    tipo.onchange = () => { state.type = tipo.value; state.page = 1; carregar(); };

    const de = input({ type: 'date', class: 'form-control' });
    const ate = input({ type: 'date', class: 'form-control', value: state.to });
    de.onchange = () => { state.from = de.value; state.page = 1; carregar(); };
    ate.onchange = () => { state.to = ate.value; state.page = 1; carregar(); };

    corpo.replaceChildren(
      h('div', { class: 'row g-2 mb-3' },
        h('div', { class: 'col-12 col-md-3' }, tipo),
        h('div', { class: 'col-6 col-md-3' }, de),
        h('div', { class: 'col-6 col-md-3' }, ate),
        state.productId
          ? h('div', { class: 'col-12 col-md-3' },
              h('a', { class: 'btn btn-outline-secondary w-100', href: '/estoque.html?tab=movimentacoes' },
                'Ver todos os produtos'))
          : h('div', { class: 'd-none' })),
      lista, rodape);
    cards.replaceChildren();

    async function carregar() {
      lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:140px' }));
      const data = await get('/stock/movements', state);
      lista.replaceChildren(dataList({
        rows: data.rows,
        empty: 'Nenhuma movimentação no período.',
        columns: [
          { label: 'Data', cell: (m) => m.createdAtLocal },
          { label: 'Produto', cell: (m) => h('a', { href: `/produto.html?id=${m.product.id}` }, m.product.name) },
          { label: 'Tipo', cell: (m) => h('span', { class: `badge text-bg-${COR[m.type] ?? 'light'}` }, m.type) },
          { label: 'Qtd', className: 'text-end', cell: (m) => fmtQty(m.quantity, m.product.unit) },
          { label: 'Antes', className: 'text-end', cell: (m) => fmtQty(m.before) },
          { label: 'Depois', className: 'text-end', cell: (m) => fmtQty(m.after) },
          { label: 'Motivo', cell: (m) => m.reason ?? '—' },
          { label: 'Usuário', cell: (m) => m.user?.name ?? '—' },
        ],
      }));
      rodape.replaceChildren(paginator(data, (p) => { state.page = p; carregar(); }));
      refreshIcons(content);
    }

    await carregar();
  }

  // ---------- entradas de mercadoria ----------
  async function entradas() {
    const state = { supplierId: '', page: 1, pageSize: 20, branchId };
    const lista = h('div', {});
    const rodape = h('div', {});
    const { rows: fornecedores } = await get('/suppliers', { pageSize: 100 });

    const fornecedor = select(
      [{ value: '', label: 'Todos os fornecedores' }, ...fornecedores.map((s) => ({ value: s.id, label: s.name }))],
      { class: 'form-select' });
    fornecedor.onchange = () => { state.supplierId = fornecedor.value; state.page = 1; carregar(); };

    corpo.replaceChildren(
      h('div', { class: 'row g-2 mb-3' }, h('div', { class: 'col-12 col-md-4' }, fornecedor)),
      lista, rodape);
    cards.replaceChildren();

    async function carregar() {
      lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:120px' }));
      const data = await get('/stock/entries', state);
      lista.replaceChildren(dataList({
        rows: data.rows,
        empty: 'Nenhuma entrada registrada.',
        emptyAction: can('estoque.entrada')
          ? h('a', { class: 'btn btn-primary', href: '/entrada.html' }, 'Lançar entrada')
          : null,
        columns: [
          { label: 'Data', cell: (e) => e.createdAtLocal },
          { label: 'Fornecedor', cell: (e) => e.supplier?.name ?? '—' },
          { label: 'Documento', cell: (e) => e.document ?? '—' },
          { label: 'Itens', className: 'text-end', cell: (e) => String(e.items) },
          { label: 'Total', className: 'text-end', cell: (e) => h('strong', {}, fmtBRL(e.totalCents)) },
          { label: 'Filial', cell: (e) => e.branch.name },
          {
            label: '', className: 'text-end',
            cell: (e) => h('a', { class: 'btn btn-sm btn-outline-secondary', href: `/entrada.html?id=${e.id}` }, 'Abrir'),
          },
        ],
      }));
      rodape.replaceChildren(paginator(data, (p) => { state.page = p; carregar(); }));
      refreshIcons(content);
    }

    await carregar();
  }

  // ---------- nova entrada (formulário embutido) ----------
  async function nova() {
    cards.replaceChildren();
    corpo.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:200px' }));
    const form = await entradaForm({
      branchId,
      onSaved: (e) => { location.href = `/entrada.html?id=${e.id}`; },
    });
    corpo.replaceChildren(form);
    refreshIcons(content);
  }

  await { posicao, movimentacoes, entradas, nova }[aba]();
}
