// Aprovação de contas: quem se cadastra pelo site fica pendente até um aprovador liberar.
import { get, post } from './api.js';
import {
  $, h, badge, confirmAction, dataList, fmtDateTime, loadingRows, modal, paginator, textarea, toast,
} from './ui.js';

const TABS = [
  { status: 'pendente', label: 'Pendentes' },
  { status: 'aprovada', label: 'Aprovadas' },
  { status: 'recusada', label: 'Recusadas' },
];
const COR = { pendente: '#f2a900', aprovada: '#28a745', recusada: '#dc3545' };

let status = 'pendente';
let page = 1;

const contato = (c) => h('div', {},
  c.owner ? h('div', {}, c.owner.name) : null,
  h('div', { class: 'small text-muted' }, c.owner?.email || c.email || ''),
  c.phone ? h('div', { class: 'small text-muted' }, c.phone) : null);

function acoes(c) {
  if (c.status !== 'pendente') {
    return h('div', { class: 'small text-muted' },
      `${c.status === 'aprovada' ? 'Aprovada' : 'Recusada'} por ${c.reviewedBy || '—'} em ${fmtDateTime(c.reviewedAt)}`,
      c.rejectReason ? h('div', {}, `Motivo: ${c.rejectReason}`) : null);
  }
  return h('div', { class: 'd-flex gap-2 justify-content-end' },
    h('button', { class: 'btn btn-sm btn-success', onclick: () => aprovar(c) }, 'Aprovar'),
    h('button', { class: 'btn btn-sm btn-outline-danger', onclick: () => recusar(c) }, 'Recusar'));
}

async function aprovar(c) {
  const ok = await confirmAction(`Liberar o acesso de "${c.name}"? O teste grátis começa a contar agora.`,
    { title: 'Aprovar conta', okLabel: 'Aprovar', danger: false });
  if (!ok) return;
  try {
    await post(`/platform/accounts/${c.id}/approve`, {});
    toast(`${c.name} aprovada.`);
  } catch (e) { toast(e.message, 'error'); }
  carregar();
}

function recusar(c) {
  const motivo = textarea({ class: 'form-control', maxlength: 500, placeholder: 'Opcional — fica registrado' });
  const ok = h('button', { class: 'btn btn-danger' }, 'Recusar');
  const m = modal({
    title: `Recusar "${c.name}"`,
    body: h('div', {}, h('label', { class: 'form-label' }, 'Motivo'), motivo),
    footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar'), ok],
  });
  ok.onclick = async () => {
    ok.disabled = true;
    try {
      await post(`/platform/accounts/${c.id}/reject`, { reason: motivo.value });
      toast(`${c.name} recusada.`);
      m.close();
    } catch (e) { toast(e.message, 'error'); ok.disabled = false; }
    carregar();
  };
}

function abas(counts) {
  $('#lf-tabs').replaceChildren(...TABS.map((t) => h('li', { class: 'nav-item' },
    h('button', {
      class: `nav-link ${t.status === status ? 'active' : ''}`, type: 'button',
      onclick: () => { status = t.status; page = 1; carregar(); },
    }, `${t.label} (${counts[t.status] ?? 0})`))));
}

async function carregar() {
  const list = $('#lf-list');
  list.replaceChildren(h('table', { class: 'table mb-0' }, h('tbody', {}, loadingRows(4, 3))));
  try {
    const data = await get('/platform/accounts', { status, page });
    abas(data.counts);
    list.replaceChildren(
      dataList({
        rows: data.rows,
        empty: status === 'pendente' ? 'Nenhuma conta aguardando aprovação.' : 'Nenhuma conta aqui.',
        columns: [
          { label: 'Loja', cell: (c) => h('div', {}, h('div', { class: 'f-w-600' }, c.name), badge(c.status, COR[c.status])) },
          { label: 'Responsável', cell: contato },
          { label: 'Cadastro', cell: (c) => fmtDateTime(c.createdAt) },
          { label: '', className: 'text-end', cell: acoes },
        ],
      }),
      paginator(data, (p) => { page = p; carregar(); }));
  } catch (e) {
    list.replaceChildren(h('div', { class: 'p-3 text-danger' }, e.message));
  }
}

$('#lf-logout').onclick = async () => {
  const res = await post('/auth/logout', {});
  location.href = res.redirect;
};

get('/platform/me').then(({ approver }) => { $('#lf-approver').textContent = approver.name; carregar(); });
