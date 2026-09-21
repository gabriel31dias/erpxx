// Primeiros passos: o que falta para a loja começar a vender.
import { get, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, card, h, icon, refreshIcons, toast } from '../ui.js';

export default async function render({ content }) {
  const data = await get('/company/onboarding');
  const pct = Math.round((data.done / data.total) * 100);

  const passos = h('div', { class: 'list-group' }, data.steps.map((s, i) => h('a', {
    class: 'list-group-item list-group-item-action d-flex align-items-center gap-3',
    href: s.link,
  },
    h('span', {
      class: `lf-stat-icon ${s.done ? 'text-success' : 'txt-secondary'}`,
      style: `background:${s.done ? 'rgba(84,186,74,.15)' : 'rgba(0,0,0,.05)'}`,
    }, s.done ? '✓' : String(i + 1)),
    h('span', { class: 'flex-grow-1' },
      h('strong', {}, s.label),
      h('small', { class: 'd-block txt-secondary' }, s.done ? 'concluído' : 'pendente')),
    icon('chevron-right', 16))));

  const concluir = h('button', { class: 'btn btn-primary' }, 'Ir para o sistema');
  concluir.onclick = async () => {
    await post('/company/onboarded');
    location.href = '/';
  };

  mount(content,
    pageTitle('Primeiros passos'),
    card(null, h('div', {},
      h('h5', {}, `Sua loja está ${pct}% configurada`),
      h('div', { class: 'progress mb-3', style: 'height:8px' },
        h('div', { class: 'progress-bar', style: `width:${pct}%` })),
      passos,
      h('div', { class: 'd-flex justify-content-end mt-3' }, concluir))));
  refreshIcons(content);
}
