// Lista de clientes.
import { del, get } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount,
  confirmAction, dataList, debounce, h, icon, input, paginator, refreshIcons, select, toast,
} from '../ui.js';

export default async function render({ content, can }) {
  const state = { q: '', status: '', page: 1, pageSize: 20 };
  const lista = h('div', {});
  const rodape = h('div', {});
  const editavel = can('cliente.gerenciar');

  const busca = input({ type: 'search', class: 'form-control', placeholder: 'Nome, telefone, CPF ou e-mail' });
  busca.oninput = debounce(() => { state.q = busca.value; state.page = 1; carregar(); });

  const status = select([
    { value: '', label: 'Todos' }, { value: 'ativo', label: 'Ativos' }, { value: 'inativo', label: 'Inativos' },
  ], { class: 'form-select' });
  status.onchange = () => { state.status = status.value; state.page = 1; carregar(); };

  const novo = editavel ? h('a', { class: 'btn btn-primary', href: '/cliente.html' }, icon('plus', 16), ' Novo cliente') : null;

  mount(content,
    pageTitle('Clientes', novo),
    h('div', { class: 'card' }, h('div', { class: 'card-body' },
      h('div', { class: 'row g-2 mb-3' },
        h('div', { class: 'col-12 col-md-6' }, busca),
        h('div', { class: 'col-6 col-md-3' }, status)),
      lista, rodape)));

  async function carregar() {
    lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:120px' }));
    const data = await get('/customers', state);
    lista.replaceChildren(dataList({
      rows: data.rows,
      empty: 'Nenhum cliente encontrado.',
      emptyAction: novo,
      columns: [
        { label: 'Nome', cell: (c) => h('a', { class: 'f-w-600', href: `/cliente.html?id=${c.id}` }, c.name) },
        { label: 'Telefone', cell: (c) => c.phone || '—' },
        { label: 'CPF/CNPJ', cell: (c) => c.document || '—' },
        { label: 'E-mail', cell: (c) => c.email || '—' },
        {
          label: 'Situação',
          cell: (c) => h('span', { class: `badge text-bg-${c.active ? 'success' : 'secondary'}` }, c.active ? 'Ativo' : 'Inativo'),
        },
        {
          label: '', className: 'text-end',
          cell: (c) => h('div', { class: 'd-flex gap-2 justify-content-end' },
            h('a', { class: 'btn btn-sm btn-outline-secondary', href: `/cliente.html?id=${c.id}` }, 'Abrir'),
            editavel ? h('button', {
              class: 'btn btn-sm btn-outline-danger', 'aria-label': `Excluir ${c.name}`,
              onclick: async () => {
                if (!(await confirmAction(`Excluir ${c.name}? O histórico de compras é preservado.`))) return;
                await del(`/customers/${c.id}`);
                toast('Cliente excluído.');
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
