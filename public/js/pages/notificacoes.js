// Notificações da loja (estoque baixo, contas, caixa).
import { get, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, card, dataList, h, paginator, refreshIcons, toast } from '../ui.js';

export default async function render({ content }) {
  const state = { page: 1, pageSize: 25 };
  const lista = h('div', {});
  const rodape = h('div', {});

  const marcar = h('button', { class: 'btn btn-outline-secondary' }, 'Marcar todas como lidas');
  marcar.onclick = async () => { await post('/notifications/read'); toast('Tudo lido.'); carregar(); };

  mount(content, pageTitle('Notificações', marcar), card(null, h('div', {}, lista, rodape)));

  async function carregar() {
    lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:120px' }));
    const data = await get('/notifications', state);
    lista.replaceChildren(dataList({
      rows: data.rows,
      empty: 'Nenhuma notificação.',
      columns: [
        {
          label: 'Notificação',
          cell: (n) => h('div', {},
            h('a', { class: 'f-w-600', href: n.link || '#' }, n.title),
            h('small', { class: 'd-block txt-secondary' }, n.body || '')),
        },
        { label: 'Tipo', cell: (n) => h('span', { class: 'badge text-bg-light' }, n.type) },
        { label: 'Quando', cell: (n) => new Date(n.createdAt).toLocaleString('pt-BR') },
        {
          label: 'Situação',
          cell: (n) => h('span', { class: `badge text-bg-${n.readAt ? 'light' : 'primary'}` }, n.readAt ? 'lida' : 'nova'),
        },
      ],
    }));
    rodape.replaceChildren(paginator(data, (p) => { state.page = p; carregar(); }));
    refreshIcons(content);
  }

  await carregar();
}
