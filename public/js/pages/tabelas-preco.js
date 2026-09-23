// Tabelas de preço: lista e criação. O preço de cada produto é editado na tela da tabela.
import { del, get, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, card, confirmAction, dataList, field, h, icon, input, modal, parseQty, refreshIcons, toast } from '../ui.js';

/** −1000 pontos-base → "−10%". */
export const fmtAjuste = (bp) => bp === 0 ? 'Preço do cadastro'
  : `${bp > 0 ? '+' : '−'}${(Math.abs(bp) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% sobre o cadastro`;

export default async function render({ content, can }) {
  const editavel = can('tabela_preco.gerenciar');
  const lista = h('div', {});

  function nova() {
    const nome = input({ required: true, placeholder: 'Ex.: Atacado, Revenda, Funcionários' });
    const ajuste = input({ inputmode: 'decimal', value: '0' });
    const salvar = h('button', { class: 'btn btn-primary' }, 'Criar e definir preços');
    const m = modal({
      title: 'Nova tabela de preço',
      body: h('div', { class: 'row g-3' },
        field('Nome', nome, { col: 'col-12' }),
        field('Ajuste sobre o preço do cadastro (%)', ajuste, {
          col: 'col-12',
          help: 'Vale para os produtos sem preço fixo na tabela. Negativo é abaixo do cadastro: −10 cobra 10% a menos.',
        })),
      footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar'), salvar],
    });
    salvar.onclick = async () => {
      try {
        const t = await post('/price-lists', { name: nome.value.trim(), adjustBp: Math.round(parseQty(ajuste.value) * 100) });
        m.close();
        location.href = `/tabela-preco.html?id=${t.id}`;
      } catch (e) { toast(e.message, 'error'); }
    };
    setTimeout(() => nome.focus(), 150);
  }

  const novaBtn = editavel
    ? h('button', { class: 'btn btn-primary', onclick: nova }, icon('plus', 16), ' Nova tabela')
    : null;

  mount(content, pageTitle('Tabelas de preço', novaBtn),
    card(null, h('div', {},
      h('p', { class: 'txt-secondary' },
        'O preço do cadastro do produto é a base. Cada tabela cobra um preço fixo por produto ou um ajuste ',
        'sobre o cadastro, e vale para os clientes vinculados a ela — no PDV e no app dos vendedores.'),
      lista)));

  async function carregar() {
    lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:120px' }));
    const { rows } = await get('/price-lists');
    lista.replaceChildren(dataList({
      rows,
      empty: 'Nenhuma tabela de preço. Todos os clientes pagam o preço do cadastro.',
      emptyAction: novaBtn,
      columns: [
        { label: 'Tabela', cell: (t) => h('a', { class: 'f-w-600', href: `/tabela-preco.html?id=${t.id}` }, t.name) },
        { label: 'Regra geral', cell: (t) => fmtAjuste(t.adjustBp) },
        { label: 'Preços fixos', className: 'text-end', cell: (t) => String(t.items) },
        { label: 'Clientes', className: 'text-end', cell: (t) => String(t.customers) },
        {
          label: 'Situação',
          cell: (t) => h('span', { class: `badge text-bg-${t.active ? 'success' : 'secondary'}` }, t.active ? 'Ativa' : 'Inativa'),
        },
        {
          label: '', className: 'text-end',
          cell: (t) => h('div', { class: 'd-flex gap-2 justify-content-end' },
            h('a', { class: 'btn btn-sm btn-outline-secondary', href: `/tabela-preco.html?id=${t.id}` }, 'Abrir'),
            editavel ? h('button', {
              class: 'btn btn-sm btn-outline-danger', 'aria-label': `Excluir ${t.name}`,
              onclick: async () => {
                const aviso = t.customers
                  ? `Excluir ${t.name}? ${t.customers} cliente(s) voltam a pagar o preço do cadastro.`
                  : `Excluir ${t.name}?`;
                if (!(await confirmAction(aviso))) return;
                try {
                  await del(`/price-lists/${t.id}`);
                  toast('Tabela excluída.');
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
