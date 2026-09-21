// Ficha do fornecedor: cadastro + histórico de entradas e contas em aberto.
import { get, patch, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, card, field, fmtBRL, h, input, refreshIcons, select, statCard, textarea, toast } from '../ui.js';

export default async function render({ content, can }) {
  const id = new URLSearchParams(location.search).get('id');
  const data = id ? await get(`/suppliers/${id}`) : null;
  const s = data?.supplier ?? {};
  const editavel = can('fornecedor.gerenciar');

  const f = {
    name: input({ value: s.name ?? '', required: true }),
    tradeName: input({ value: s.tradeName ?? '' }),
    document: input({ value: s.document ?? '' }),
    phone: input({ value: s.phone ?? '', type: 'tel' }),
    whatsapp: input({ value: s.whatsapp ?? '', type: 'tel' }),
    email: input({ value: s.email ?? '', type: 'email' }),
    address: input({ value: s.address ?? '' }),
    notes: textarea({ value: s.notes ?? '' }),
    active: select([
      { value: 'true', label: 'Ativo', selected: s.active !== false },
      { value: 'false', label: 'Inativo', selected: s.active === false },
    ]),
  };

  const salvar = h('button', { class: 'btn btn-primary', type: 'submit' }, id ? 'Salvar' : 'Cadastrar fornecedor');
  const form = h('form', { class: 'row g-3' },
    field('Razão social', f.name, { col: 'col-12 col-md-6' }),
    field('Nome fantasia', f.tradeName, { col: 'col-12 col-md-6' }),
    field('CNPJ/CPF', f.document, { col: 'col-6 col-md-3' }),
    field('Telefone', f.phone, { col: 'col-6 col-md-3' }),
    field('WhatsApp', f.whatsapp, { col: 'col-6 col-md-3' }),
    field('E-mail', f.email, { col: 'col-6 col-md-3' }),
    field('Endereço', f.address, { col: 'col-12 col-md-9' }),
    field('Situação', f.active, { col: 'col-6 col-md-3' }),
    field('Observações', f.notes, { col: 'col-12' }),
    h('div', { class: 'col-12 d-flex gap-2 justify-content-end' },
      h('a', { class: 'btn btn-light', href: '/fornecedores.html' }, 'Voltar'),
      editavel ? salvar : null));

  form.onsubmit = async (e) => {
    e.preventDefault();
    salvar.disabled = true;
    try {
      const body = {
        name: f.name.value.trim(),
        tradeName: f.tradeName.value.trim() || undefined,
        document: f.document.value.trim() || undefined,
        phone: f.phone.value.trim() || undefined,
        whatsapp: f.whatsapp.value.trim() || undefined,
        email: f.email.value.trim() || undefined,
        address: f.address.value.trim() || undefined,
        notes: f.notes.value.trim() || undefined,
        active: f.active.value === 'true',
      };
      const saved = id ? await patch(`/suppliers/${id}`, body) : await post('/suppliers', body);
      toast('Fornecedor salvo.');
      if (!id) location.href = `/fornecedor.html?id=${saved.id}`;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      salvar.disabled = false;
    }
  };

  const stats = data ? h('div', { class: 'row' },
    statCard('Total comprado', fmtBRL(data.stats.totalCents), { iconName: 'truck' }),
    statCard('Entradas', String(data.stats.entriesCount), { iconName: 'package', color: '#16c7f9' }),
    statCard('Em aberto (a pagar)', fmtBRL(data.stats.openPayableCents), { iconName: 'alert-circle', color: '#fc4438' }),
    statCard('Última entrada', data.stats.lastEntryAt ?? '—', { iconName: 'calendar', color: '#ffaa05' })) : null;

  const historico = data ? card('Entradas deste fornecedor', data.entries.length
    ? h('div', { class: 'table-responsive' }, h('table', { class: 'table align-middle mb-0' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Data'), h('th', {}, 'Documento'), h('th', {}, 'Filial'),
          h('th', { class: 'text-end' }, 'Itens'), h('th', { class: 'text-end' }, 'Total'), h('th', {}))),
        h('tbody', {}, data.entries.map((e) => h('tr', {},
          h('td', {}, e.createdAtLocal), h('td', {}, e.document ?? '—'), h('td', {}, e.branch),
          h('td', { class: 'text-end' }, String(e.items)),
          h('td', { class: 'text-end f-w-600' }, fmtBRL(e.totalCents)),
          h('td', { class: 'text-end' },
            h('a', { class: 'btn btn-sm btn-outline-secondary', href: `/entrada.html?id=${e.id}` }, 'Abrir')))))))
    : h('p', { class: 'txt-secondary mb-0' }, 'Nenhuma entrada registrada.')) : null;

  mount(content,
    pageTitle(id ? s.name : 'Novo fornecedor'),
    stats,
    card('Dados do fornecedor', form),
    historico);
  refreshIcons(content);
}
