// Caixa: sessão aberta do operador, sangria/suprimento e atalho para fechamento.
import { get, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount,
  card, emptyState, field, fmtBRL, h, icon, input, modal, moneyToCents, refreshIcons, select,
  statCard, toast,
} from '../ui.js';

export default async function render({ content, can, branchId }) {
  const conteudo = h('div', {});

  mount(content,
    pageTitle('Caixa',
      h('a', { class: 'btn btn-outline-secondary', href: '/sessoes.html' }, 'Aberturas e fechamentos'),
      can('pdv.acessar') ? h('a', { class: 'btn btn-primary', href: '/pdv.html' }, icon('shopping-cart', 16), ' PDV') : null),
    conteudo);

  async function abrir() {
    const { rows } = await get('/cash/registers', { branchId });
    const livres = rows.filter((r) => r.active && !r.openSession);
    if (!livres.length) return toast('Todos os PDVs já estão abertos.', 'warning');
    const pdv = select(livres.map((r) => ({ value: r.id, label: `${r.name} · ${r.branch}` })));
    const inicial = input({ inputmode: 'decimal', value: '0,00' });
    const ok = h('button', { class: 'btn btn-primary' }, 'Abrir caixa');
    const m = modal({
      title: 'Abertura de caixa',
      body: h('div', { class: 'row g-3' },
        field('PDV', pdv, { col: 'col-12' }),
        field('Valor inicial (fundo de troco)', inicial, { col: 'col-12' })),
      footer: [ok],
    });
    ok.onclick = async () => {
      try {
        const chosen = livres.find((r) => r.id === pdv.value);
        await post('/cash/open', {
          registerId: pdv.value, branchId: chosen?.branchId, openingCents: moneyToCents(inicial.value),
        });
        m.close();
        toast('Caixa aberto.');
        carregar();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  async function movimento(sessionId, tipo) {
    const valor = input({ inputmode: 'decimal', placeholder: '0,00' });
    const motivo = input({ placeholder: 'Motivo' });
    const ok = h('button', { class: 'btn btn-primary' }, 'Confirmar');
    const m = modal({
      title: tipo === 'sangria' ? 'Sangria (retirada)' : 'Suprimento (entrada)',
      body: h('div', { class: 'row g-3' }, field('Valor', valor, { col: 'col-12 col-md-6' }), field('Motivo', motivo, { col: 'col-12 col-md-6' })),
      footer: [ok],
    });
    ok.onclick = async () => {
      try {
        await post(`/cash/sessions/${sessionId}/${tipo}`, {
          amountCents: moneyToCents(valor.value), reason: motivo.value.trim(),
        });
        m.close();
        toast('Registrado.');
        carregar();
      } catch (e) { toast(e.message, 'error'); }
    };
    setTimeout(() => valor.focus(), 150);
  }

  async function carregar() {
    conteudo.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:140px' }));
    const data = await get('/cash/current', { branchId });

    if (!data.session) {
      conteudo.replaceChildren(card(null, emptyState(
        data.otherOpen
          ? `Nenhum caixa aberto para você. ${data.otherOpen.register?.name} está aberto por ${data.otherOpen.operator?.name ?? 'outro operador'}.`
          : 'Nenhum caixa aberto no momento.',
        can('caixa.abrir') ? h('button', { class: 'btn btn-primary', onclick: abrir }, 'Abrir caixa') : null)));
      return refreshIcons(content);
    }

    const s = data.session;
    const t = data.summary.totals;
    conteudo.replaceChildren(
      h('div', { class: 'row' },
        statCard('Abertura', fmtBRL(t.openingCents), { hint: s.openedAt, iconName: 'log-in' }),
        statCard('Vendas da sessão', fmtBRL(t.salesCents), { hint: `${t.salesCount} venda(s)`, iconName: 'shopping-bag', color: '#54ba4a' }),
        statCard('Sangrias', fmtBRL(t.sangriaCents), { iconName: 'arrow-up-circle', color: '#fc4438' }),
        statCard('Dinheiro esperado', fmtBRL(data.summary.cashOnHandCents), { iconName: 'briefcase', color: '#16c7f9' })),

      card(`${s.register.name} · ${s.branch.name}`, h('div', {},
        h('div', { class: 'table-responsive mb-3' }, h('table', { class: 'table align-middle mb-0' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Forma de pagamento'), h('th', { class: 'text-end' }, 'Esperado'))),
          h('tbody', {}, data.summary.byMethod.map((m) => h('tr', {},
            h('td', {}, m.name, m.isCash ? h('span', { class: 'badge text-bg-light ms-2' }, 'dinheiro') : null),
            h('td', { class: 'text-end f-w-600' }, fmtBRL(m.expectedCents))))))),
        h('div', { class: 'd-flex gap-2 flex-wrap' },
          can('caixa.sangria') ? h('button', { class: 'btn btn-outline-danger', onclick: () => movimento(s.id, 'sangria') }, 'Sangria') : null,
          can('caixa.suprimento') ? h('button', { class: 'btn btn-outline-success', onclick: () => movimento(s.id, 'suprimento') }, 'Suprimento') : null,
          h('a', { class: 'btn btn-outline-secondary', href: `/sessao.html?id=${s.id}` }, 'Ver movimentos'),
          can('caixa.fechar') ? h('a', { class: 'btn btn-primary ms-auto', href: `/sessao.html?id=${s.id}&fechar=1` }, 'Fechar caixa') : null))),
    );
    refreshIcons(content);
  }

  await carregar();
}
