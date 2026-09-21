// Lista de produtos: busca, filtros, paginação (tabela no desktop, cards no celular).
import { del, get } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount,
  confirmAction, dataList, debounce, fmtBRL, fmtQty, h, icon, input, paginator, refreshIcons,
  select, toast,
} from '../ui.js';

export default async function render({ content, can, branchId }) {
  const params = new URLSearchParams(location.search);
  const state = {
    q: params.get('q') || '', categoryId: '', status: '', stock: params.get('stock') || '',
    orderBy: 'name', page: 1, pageSize: 20, branchId,
  };
  const lista = h('div', {});
  const rodape = h('div', {});
  const editavel = can('produto.criar');

  const { rows: categorias } = await get('/categories');

  const busca = input({
    type: 'search', class: 'form-control', value: state.q,
    placeholder: 'Nome, SKU ou código de barras', 'aria-label': 'Buscar produtos',
  });
  busca.oninput = debounce(() => { state.q = busca.value; state.page = 1; carregar(); });

  const categoria = select(
    [{ value: '', label: 'Todas as categorias' }, ...categorias.map((c) => ({ value: c.id, label: c.name }))],
    { class: 'form-select', 'aria-label': 'Categoria' });
  categoria.onchange = () => { state.categoryId = categoria.value; state.page = 1; carregar(); };

  const estoque = select([
    { value: '', label: 'Todo o estoque' },
    { value: 'baixo', label: 'Estoque baixo', selected: state.stock === 'baixo' },
    { value: 'zerado', label: 'Sem estoque', selected: state.stock === 'zerado' },
  ], { class: 'form-select', 'aria-label': 'Filtro de estoque' });
  estoque.onchange = () => { state.stock = estoque.value; state.page = 1; carregar(); };

  const status = select([
    { value: '', label: 'Ativos e inativos' },
    { value: 'ativo', label: 'Somente ativos' },
    { value: 'inativo', label: 'Somente inativos' },
  ], { class: 'form-select', 'aria-label': 'Status' });
  status.onchange = () => { state.status = status.value; state.page = 1; carregar(); };

  const novo = editavel ? h('a', { class: 'btn btn-primary', href: '/produto.html' }, icon('plus', 16), ' Novo produto') : null;
  const acoes = [
    novo,
    h('a', { class: 'btn btn-outline-secondary', href: '/categorias.html' }, 'Categorias'),
    can('produto.importar') ? h('a', { class: 'btn btn-outline-secondary', href: '/importacao.html' }, 'Importar planilha') : null,
  ];

  mount(content,
    pageTitle('Produtos', ...acoes),
    h('div', { class: 'card' }, h('div', { class: 'card-body' },
      h('div', { class: 'row g-2 mb-3' },
        h('div', { class: 'col-12 col-md-4' }, busca),
        h('div', { class: 'col-6 col-md-3' }, categoria),
        h('div', { class: 'col-6 col-md-3' }, estoque),
        h('div', { class: 'col-12 col-md-2' }, status)),
      lista, rodape)));

  async function carregar() {
    lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:140px' }));
    const data = await get('/products', state);

    lista.replaceChildren(dataList({
      rows: data.rows,
      empty: 'Nenhum produto encontrado.',
      emptyAction: novo,
      columns: [
        {
          label: 'Produto',
          cell: (p) => h('div', {},
            h('a', { class: 'f-w-600', href: `/produto.html?id=${p.id}` }, p.name),
            h('small', { class: 'd-block txt-secondary' }, [p.sku, p.barcode].filter(Boolean).join(' · ') || '—')),
        },
        { label: 'Categoria', cell: (p) => p.category?.name ?? '—' },
        { label: 'Custo', className: 'text-end', cell: (p) => fmtBRL(p.costCents) },
        { label: 'Preço', className: 'text-end', cell: (p) => h('strong', {}, fmtBRL(p.priceCents)) },
        { label: 'Margem', className: 'text-end', cell: (p) => `${p.marginPct}%` },
        {
          label: 'Estoque', className: 'text-end',
          cell: (p) => h('span', {
            class: `badge text-bg-${p.outOfStock ? 'danger' : p.lowStock ? 'warning' : 'light'}`,
          }, fmtQty(p.stock, p.unit)),
        },
        {
          label: '', className: 'text-end',
          cell: (p) => h('div', { class: 'd-flex gap-2 justify-content-end' },
            h('a', { class: 'btn btn-sm btn-outline-secondary', href: `/produto.html?id=${p.id}` }, 'Abrir'),
            can('produto.excluir') ? h('button', {
              class: 'btn btn-sm btn-outline-danger', 'aria-label': `Excluir ${p.name}`,
              onclick: async () => {
                if (!(await confirmAction(`Excluir ${p.name}? O histórico de vendas é preservado.`))) return;
                await del(`/products/${p.id}`);
                toast('Produto excluído.');
                carregar();
              },
            }, icon('trash-2', 14)) : null),
        },
      ],
    }));
    rodape.replaceChildren(paginator(data, (p) => { state.page = p; carregar(); }));
    refreshIcons(content);
  }

  await carregar();
}
