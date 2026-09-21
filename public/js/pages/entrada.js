// Entrada de mercadoria: página dedicada. O formulário vive em entrada-form.js
// (reusado também na aba "Nova entrada" do estoque). Aqui ficam a moldura da
// página e a visualização/impressão de uma entrada já lançada (?id=).
import { get } from '../api.js';
import { pageTitle } from '../shell.js';
import { card, fmtBRL, fmtQty, h, icon, mount, refreshIcons } from '../ui.js';
import { entradaForm } from './entrada-form.js';

export default async function render({ content, can, branchId }) {
  const id = new URLSearchParams(location.search).get('id');
  if (id) return detalhe(content, id);
  if (!can('estoque.entrada')) return mount(content, card(null, 'Sem permissão para lançar entradas.'));

  const form = await entradaForm({ branchId, onSaved: (e) => { location.href = `/entrada.html?id=${e.id}`; } });
  mount(content,
    pageTitle('Nova entrada de mercadoria',
      h('a', { class: 'btn btn-light', href: '/estoque.html?tab=entradas' }, 'Voltar')),
    form);
  refreshIcons(content);
}

async function detalhe(content, id) {
  const entrada = await get(`/stock/entries/${id}`);
  mount(content,
    pageTitle(`Entrada de ${entrada.createdAtLocal}`,
      h('a', { class: 'btn btn-light', href: '/estoque.html?tab=entradas' }, 'Voltar'),
      h('button', { class: 'btn btn-outline-secondary', onclick: () => window.print() }, icon('printer', 16), ' Imprimir')),
    card('Dados', h('div', { class: 'row' },
      info('Fornecedor', entrada.supplier?.name ?? '—'),
      info('Documento', entrada.document ?? '—'),
      info('Filial', entrada.branch.name),
      info('Lançado por', entrada.user?.name ?? '—'),
      info('Total', fmtBRL(entrada.totalCents)))),
    card('Itens', h('div', { class: 'table-responsive' }, h('table', { class: 'table align-middle mb-0' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Produto'), h('th', { class: 'text-end' }, 'Qtd'),
        h('th', { class: 'text-end' }, 'Custo'), h('th', { class: 'text-end' }, 'Total'),
        h('th', {}, 'Lote'), h('th', {}, 'Validade'))),
      h('tbody', {}, entrada.items.map((i) => h('tr', {},
        h('td', {}, h('a', { href: `/produto.html?id=${i.product.id}` }, i.product.name)),
        h('td', { class: 'text-end' }, fmtQty(i.quantity, i.product.unit)),
        h('td', { class: 'text-end' }, fmtBRL(i.costCents)),
        h('td', { class: 'text-end' }, fmtBRL(Math.round(i.costCents * i.quantity))),
        h('td', {}, i.lot ?? '—'),
        h('td', {}, i.expiresAt ?? '—'))))))),
    entrada.notes ? card('Observações', h('p', { class: 'mb-0' }, entrada.notes)) : null);
  refreshIcons(content);
}

const info = (label, value) => h('div', { class: 'col-6 col-md-3 mb-2' },
  h('div', { class: 'lf-stat-label' }, label), h('div', { class: 'f-w-600' }, value));
