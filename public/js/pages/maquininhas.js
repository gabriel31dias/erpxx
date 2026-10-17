// Maquininhas (POS) integradas: aparecem sozinhas na primeira venda com o id do aparelho.
import { get, patch } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount,
  card, dataList, field, fmtBRL, h, input, modal, refreshIcons, select, statCard, toast,
} from '../ui.js';

const ATUALIZA_MS = 30_000;

const STATUS = {
  online: ['Em uso agora', 'success'],
  active: ['Ativa', 'primary'],
  idle: ['Parada', 'warning'],
  disabled: ['Desativada', 'secondary'],
};

/** "há 5 min", "há 3 h", "há 2 dias" */
function ha(date) {
  const min = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60_000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} dias`;
}

export default async function render({ content, can, branchId }) {
  const cards = h('div', { class: 'row' });
  const lista = h('div', {});
  const filtro = select([
    { value: 'ativas', label: 'Só ativas' },
    { value: '', label: 'Todas' },
  ], { class: 'form-select form-select-sm', style: 'width:auto' });
  filtro.onchange = () => carregar();

  function editar(t) {
    const nome = input({ value: t.name ?? '', maxlength: 60, placeholder: 'Ex.: Caixa 2, Balcão, Entrega' });
    const ativo = select([
      { value: 'true', label: 'Ativa', selected: t.active },
      { value: 'false', label: 'Desativada', selected: !t.active },
    ]);
    const salvar = h('button', { class: 'btn btn-primary' }, 'Salvar');
    const m = modal({
      title: `Maquininha ${t.serial}`,
      body: h('div', { class: 'row g-3' },
        field('Apelido', nome, { col: 'col-12', help: 'Como ela aparece nas vendas e relatórios.' }),
        field('Situação', ativo, {
          col: 'col-12', help: 'Desativada some da lista de ativas. Se voltar a vender, reativa sozinha.',
        })),
      footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar'), salvar],
    });
    salvar.onclick = async () => {
      salvar.disabled = true;
      try {
        await patch(`/terminals/${t.id}`, { name: nome.value.trim(), active: ativo.value === 'true' });
        m.close();
        toast('Maquininha salva.');
        carregar();
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        salvar.disabled = false;
      }
    };
  }

  mount(content,
    pageTitle('Maquininhas'),
    cards,
    card('Maquininhas integradas', lista, filtro));

  async function carregar() {
    const { rows, summary } = await get('/terminals', { branchId });
    cards.replaceChildren(
      statCard('Ativas', String(summary.active), {
        iconName: 'smartphone', hint: `${summary.total} vinculada(s) no total`,
      }),
      statCard('Em uso agora', String(summary.online), {
        iconName: 'activity', color: '#54ba4a', hint: 'venda nos últimos 30 min',
      }),
      statCard('Vendas hoje', String(summary.todayCount), { iconName: 'file-text', color: '#16c7f9' }),
      statCard('Faturamento hoje', fmtBRL(summary.todayCents), { iconName: 'trending-up', color: '#ffaa05' }),
    );

    const visiveis = filtro.value === 'ativas'
      ? rows.filter((t) => t.status === 'online' || t.status === 'active') : rows;
    lista.replaceChildren(dataList({
      rows: visiveis,
      empty: rows.length
        ? 'Nenhuma maquininha vendeu nos últimos 7 dias. Escolha "Todas" para ver as paradas.'
        : 'Nenhuma maquininha vinculada ainda. Ela aparece aqui sozinha na primeira venda que mandar o terminalId.',
      columns: [
        {
          label: 'Maquininha',
          cell: (t) => h('div', {},
            h('strong', {}, t.name || t.serial),
            h('small', { class: 'd-block txt-secondary' },
              [t.name ? t.serial : null, t.model, t.branch?.name].filter(Boolean).join(' · '))),
        },
        {
          label: 'Situação',
          cell: (t) => h('span', { class: `badge text-bg-${STATUS[t.status][1]}` }, STATUS[t.status][0]),
        },
        {
          label: 'Última venda',
          cell: (t) => h('div', {}, ha(t.lastSeenAt),
            h('small', { class: 'd-block txt-secondary' }, t.lastOperator ? `por ${t.lastOperator}` : '')),
        },
        {
          label: 'Hoje', className: 'text-end',
          cell: (t) => h('div', {}, fmtBRL(t.todayCents),
            h('small', { class: 'd-block txt-secondary' }, `${t.todayCount} venda(s)`)),
        },
        {
          label: '7 dias', className: 'text-end',
          cell: (t) => h('div', {}, fmtBRL(t.weekCents),
            h('small', { class: 'd-block txt-secondary' }, `${t.weekCount} venda(s)`)),
        },
        {
          label: '', className: 'text-end',
          cell: (t) => h('div', { class: 'd-flex gap-2 justify-content-end' },
            h('a', { class: 'btn btn-sm btn-outline-primary', href: `/vendas.html?terminalId=${encodeURIComponent(t.id)}` }, 'Vendas'),
            can('empresa.gerenciar')
              ? h('button', { class: 'btn btn-sm btn-outline-secondary', onclick: () => editar(t) }, 'Editar') : null),
        },
      ],
    }));
    refreshIcons(content);
  }

  lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:140px' }));
  await carregar();
  const timer = setInterval(() => {
    if (!content.isConnected) return clearInterval(timer);
    if (!document.hidden) carregar().catch(() => {});
  }, ATUALIZA_MS);
}
