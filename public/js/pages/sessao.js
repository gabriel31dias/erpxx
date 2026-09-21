// Sessão de caixa: movimentos, conferência e fechamento (esperado × contado).
import { get, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount,
  card, centsToInput, fmtBRL, h, icon, input, modal, moneyToCents, refreshIcons, statCard,
  textarea, toast,
} from '../ui.js';

export default async function render({ content, can }) {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const { session, summary } = await get(`/cash/sessions/${id}`);
  const aberta = session.status === 'open';

  function fechar() {
    const campos = new Map();
    const linhas = summary.byMethod.map((m) => {
      const campo = input({ class: 'form-control', inputmode: 'decimal', value: centsToInput(m.expectedCents) });
      campos.set(m.paymentMethodId, { method: m, campo });
      const diferenca = h('span', { class: 'f-12 txt-secondary' });
      campo.oninput = () => {
        const d = moneyToCents(campo.value) - m.expectedCents;
        diferenca.textContent = d === 0 ? 'confere' : `${d > 0 ? 'sobra' : 'falta'} ${fmtBRL(Math.abs(d))}`;
        diferenca.className = `f-12 ${d === 0 ? 'text-success' : 'text-danger'}`;
      };
      return h('tr', {},
        h('td', {}, m.name, m.isCash ? h('span', { class: 'badge text-bg-light ms-2' }, 'dinheiro') : null),
        h('td', { class: 'text-end' }, fmtBRL(m.expectedCents)),
        h('td', { style: 'width:180px' }, campo),
        h('td', {}, diferenca));
    });
    const obs = textarea({ rows: 2, placeholder: 'Observações do fechamento' });
    const ok = h('button', { class: 'btn btn-primary' }, 'Fechar caixa');

    const m = modal({
      title: 'Fechamento de caixa',
      size: 'modal-lg',
      body: h('div', {},
        h('p', { class: 'txt-secondary' }, 'Confira o valor contado de cada forma de pagamento. A diferença fica registrada.'),
        h('div', { class: 'table-responsive' }, h('table', { class: 'table align-middle' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Forma'), h('th', { class: 'text-end' }, 'Esperado'),
            h('th', {}, 'Contado'), h('th', {}, ''))),
          h('tbody', {}, linhas))),
        obs),
      footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar'), ok],
    });

    ok.onclick = async () => {
      const counted = {};
      let cash = 0;
      for (const [methodId, { method, campo }] of campos) {
        const cents = moneyToCents(campo.value);
        counted[methodId] = cents;
        if (method.isCash) cash += cents;
      }
      try {
        await post(`/cash/sessions/${id}/close`, {
          countedCents: cash, counted, notes: obs.value.trim() || undefined,
        });
        m.close();
        toast('Caixa fechado.');
        location.reload();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  if (aberta && params.get('fechar') && can('caixa.fechar')) setTimeout(fechar, 300);

  const fechamento = session.closingData?.byMethod?.length
    ? card('Fechamento registrado', h('div', { class: 'table-responsive' },
        h('table', { class: 'table align-middle mb-0' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Forma'), h('th', { class: 'text-end' }, 'Esperado'),
            h('th', { class: 'text-end' }, 'Contado'), h('th', { class: 'text-end' }, 'Diferença'))),
          h('tbody', {}, session.closingData.byMethod.map((m) => h('tr', {},
            h('td', {}, m.name),
            h('td', { class: 'text-end' }, fmtBRL(m.expectedCents)),
            h('td', { class: 'text-end' }, fmtBRL(m.countedCents)),
            h('td', { class: 'text-end' }, h('span', {
              class: `badge text-bg-${m.differenceCents === 0 ? 'success' : 'danger'}`,
            }, fmtBRL(m.differenceCents)))))))))
    : null;

  const TIPO = { abertura: 'Abertura', venda: 'Venda', sangria: 'Sangria', suprimento: 'Suprimento', estorno: 'Estorno' };

  mount(content,
    pageTitle(`Caixa de ${session.openedAt}`,
      h('a', { class: 'btn btn-light', href: '/sessoes.html' }, 'Voltar'),
      h('button', { class: 'btn btn-outline-secondary', onclick: () => window.print() }, icon('printer', 16), ' Imprimir'),
      aberta && can('caixa.fechar') ? h('button', { class: 'btn btn-primary', onclick: fechar }, 'Fechar caixa') : null),

    h('div', { class: 'row' },
      statCard('Abertura', fmtBRL(summary.totals.openingCents), { hint: session.operator?.name, iconName: 'log-in' }),
      statCard('Vendas', fmtBRL(summary.totals.salesCents), { hint: `${summary.totals.salesCount} venda(s)`, iconName: 'shopping-bag', color: '#54ba4a' }),
      statCard('Sangrias / suprimentos', `${fmtBRL(summary.totals.sangriaCents)} / ${fmtBRL(summary.totals.suprimentoCents)}`, { iconName: 'repeat', color: '#ffaa05' }),
      statCard(aberta ? 'Dinheiro esperado' : 'Diferença no fechamento',
        aberta ? fmtBRL(summary.cashOnHandCents) : fmtBRL(session.differenceCents ?? 0),
        { iconName: 'briefcase', color: aberta ? '#16c7f9' : (session.differenceCents ? '#fc4438' : '#54ba4a') })),

    fechamento,

    card('Movimentos', h('div', { class: 'table-responsive' }, h('table', { class: 'table align-middle mb-0' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Hora'), h('th', {}, 'Tipo'), h('th', {}, 'Descrição'),
        h('th', {}, 'Usuário'), h('th', { class: 'text-end' }, 'Valor'))),
      h('tbody', {}, session.movements.map((m) => h('tr', {},
        h('td', {}, m.createdAtLocal.slice(11)),
        h('td', {}, h('span', { class: 'badge text-bg-light' }, TIPO[m.type] ?? m.type)),
        h('td', {}, m.description ?? '—'),
        h('td', {}, m.user?.name ?? '—'),
        h('td', { class: `text-end f-w-600 ${m.amountCents < 0 ? 'text-danger' : ''}` }, fmtBRL(m.amountCents)))))))),
  );
  refreshIcons(content);
}
