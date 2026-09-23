// Roteiros de visita dos vendedores externos: lista. A edição (com mapa) fica em roteiro.html.
import { del, get } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, card, confirmAction, dataList, fmtDate, h, icon, refreshIcons, select, toast } from '../ui.js';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** "Sempre (seg–sáb)" / "Seg, Qui" / "Esporádico · 25/09/2026". */
export function descreverRecorrencia(r) {
  if (r.recurrence === 'ALWAYS') return 'Sempre (seg a sáb)';
  if (r.recurrence === 'ONCE') return `Esporádico · ${fmtDate(r.date)}`;
  return DIAS.filter((_, i) => r.weekdays & (1 << i)).join(', ');
}

export default async function render({ content, can }) {
  const editavel = can('roteiro.gerenciar');
  const lista = h('div', {});
  const { sellers } = await get('/field/live');
  const vendedor = select([{ value: '', label: 'Todos os vendedores' },
    ...sellers.map((s) => ({ value: s.id, label: s.name }))], { class: 'form-select' });
  vendedor.onchange = () => carregar();

  const novo = editavel
    ? h('a', { class: 'btn btn-primary', href: '/roteiro.html' }, icon('plus', 16), ' Novo roteiro') : null;

  mount(content,
    pageTitle('Roteiros de visita', h('a', { class: 'btn btn-outline-primary', href: '/campo.html' }, icon('map', 16), ' Mapa de campo'), novo),
    card(null, h('div', {},
      h('div', { class: 'row g-2 mb-3' }, h('div', { class: 'col-12 col-md-4' }, vendedor)),
      lista)));

  async function carregar() {
    lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:120px' }));
    const { rows } = await get('/routes', { sellerId: vendedor.value || undefined });
    lista.replaceChildren(dataList({
      rows,
      empty: sellers.length ? 'Nenhum roteiro cadastrado.' : 'Cadastre um vendedor externo antes de criar roteiros.',
      emptyAction: sellers.length ? novo : null,
      columns: [
        { label: 'Roteiro', cell: (r) => h('a', { class: 'f-w-600', href: `/roteiro.html?id=${r.id}` }, r.name) },
        { label: 'Vendedor', cell: (r) => r.seller.name },
        { label: 'Quando', cell: (r) => descreverRecorrencia(r) },
        { label: 'Clientes', className: 'text-end', cell: (r) => String(r.stops) },
        {
          label: 'Situação',
          cell: (r) => h('span', { class: `badge text-bg-${r.active ? 'success' : 'secondary'}` }, r.active ? 'Ativo' : 'Inativo'),
        },
        {
          label: '', className: 'text-end',
          cell: (r) => h('div', { class: 'd-flex gap-2 justify-content-end' },
            h('a', { class: 'btn btn-sm btn-outline-secondary', href: `/roteiro.html?id=${r.id}` }, editavel ? 'Editar' : 'Abrir'),
            editavel ? h('button', {
              class: 'btn btn-sm btn-outline-danger', 'aria-label': `Excluir ${r.name}`,
              onclick: async () => {
                if (!(await confirmAction(`Excluir o roteiro ${r.name}? As visitas já feitas continuam no histórico.`))) return;
                try {
                  await del(`/routes/${r.id}`);
                  toast('Roteiro excluído.');
                  carregar();
                } catch (e) { toast(e.message, 'error'); }
              },
            }, icon('trash-2', 14)) : null),
        },
      ],
    }));
    refreshIcons(content);
  }

  await carregar();
}
