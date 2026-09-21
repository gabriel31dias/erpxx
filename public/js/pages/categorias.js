// Categorias de produtos: cadastro simples, tudo na mesma tela.
import { del, get, patch, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, card, confirmAction, dataList, field, h, icon, input, modal, refreshIcons, select, toast } from '../ui.js';

export default async function render({ content, can }) {
  const editavel = can('categoria.gerenciar');
  const lista = h('div', {});

  function formulario(row = {}) {
    const nome = input({ value: row.name ?? '', required: true });
    const descricao = input({ value: row.description ?? '' });
    const ativo = select([
      { value: 'true', label: 'Ativa', selected: row.active !== false },
      { value: 'false', label: 'Inativa', selected: row.active === false },
    ]);
    const salvar = h('button', { class: 'btn btn-primary' }, 'Salvar');
    const m = modal({
      title: row.id ? 'Editar categoria' : 'Nova categoria',
      body: h('div', { class: 'row g-3' },
        field('Nome', nome, { col: 'col-12' }),
        field('Descrição', descricao, { col: 'col-12' }),
        field('Situação', ativo, { col: 'col-12' })),
      footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar'), salvar],
    });
    salvar.onclick = async () => {
      try {
        const body = {
          name: nome.value.trim(), description: descricao.value.trim() || undefined,
          active: ativo.value === 'true',
        };
        row.id ? await patch(`/categories/${row.id}`, body) : await post('/categories', body);
        m.close();
        toast('Categoria salva.');
        carregar();
      } catch (e) { toast(e.message, 'error'); }
    };
    setTimeout(() => nome.focus(), 150);
  }

  const nova = editavel
    ? h('button', { class: 'btn btn-primary', onclick: () => formulario() }, icon('plus', 16), ' Nova categoria')
    : null;

  mount(content, pageTitle('Categorias', nova), card(null, lista));

  async function carregar() {
    lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:120px' }));
    const { rows } = await get('/categories');
    lista.replaceChildren(dataList({
      rows,
      empty: 'Nenhuma categoria cadastrada.',
      emptyAction: nova,
      columns: [
        { label: 'Nome', cell: (c) => h('strong', {}, c.name) },
        { label: 'Descrição', cell: (c) => c.description || '—' },
        { label: 'Produtos', className: 'text-end', cell: (c) => String(c.products) },
        {
          label: 'Situação',
          cell: (c) => h('span', { class: `badge text-bg-${c.active ? 'success' : 'secondary'}` }, c.active ? 'Ativa' : 'Inativa'),
        },
        {
          label: '', className: 'text-end',
          cell: (c) => editavel ? h('div', { class: 'd-flex gap-2 justify-content-end' },
            h('button', { class: 'btn btn-sm btn-outline-secondary', onclick: () => formulario(c) }, 'Editar'),
            h('button', {
              class: 'btn btn-sm btn-outline-danger', 'aria-label': `Excluir ${c.name}`,
              onclick: async () => {
                if (!(await confirmAction(`Excluir a categoria ${c.name}?`))) return;
                try {
                  await del(`/categories/${c.id}`);
                  toast('Categoria excluída.');
                  carregar();
                } catch (e) { toast(e.message, 'error'); }
              },
            }, icon('trash-2', 14))) : null,
        },
      ],
    }));
    refreshIcons(content);
  }

  await carregar();
}
