// Assinatura: plano atual, uso × limites e troca de plano.
import { get, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, card, confirmAction, fmtBRL, h, refreshIcons, toast } from '../ui.js';

const LIMITE = (used, max) => (max < 0 ? `${used} · ilimitado` : `${used} de ${max}`);
const PCT = (used, max) => (max < 0 ? 10 : Math.min(100, Math.round((used / max) * 100)));

export default async function render({ content, can }) {
  const dados = await get('/subscription');
  const atual = dados.plan;
  const uso = dados.usage;

  const barra = (label, used, max) => h('div', { class: 'mb-3' },
    h('div', { class: 'd-flex justify-content-between' },
      h('span', {}, label), h('strong', {}, LIMITE(used, max))),
    h('div', { class: 'progress', style: 'height:6px' },
      h('div', {
        class: `progress-bar bg-${PCT(used, max) >= 100 ? 'danger' : PCT(used, max) >= 80 ? 'warning' : 'primary'}`,
        style: `width:${PCT(used, max)}%`,
      })));

  const trocar = async (plan) => {
    if (!(await confirmAction(`Mudar para o plano ${plan.name} por ${fmtBRL(plan.priceCents)}/mês?`,
      { okLabel: 'Confirmar', danger: false }))) return;
    try {
      const r = await post('/subscription', { planCode: plan.code });
      toast(r.message);
      location.reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  const planos = h('div', { class: 'row' }, dados.plans.map((p) => h('div', { class: 'col-12 col-md-4' },
    h('div', { class: `card ${p.code === atual.code ? 'border-primary' : ''}` },
      h('div', { class: 'card-body' },
        h('h5', {}, p.name),
        h('div', { class: 'lf-money mb-2' }, fmtBRL(p.priceCents), h('small', {}, 'por mês')),
        h('ul', { class: 'list-unstyled f-12 mb-3' },
          h('li', {}, `Usuários: ${p.maxUsers < 0 ? 'ilimitados' : p.maxUsers}`),
          h('li', {}, `Filiais: ${p.maxBranches < 0 ? 'ilimitadas' : p.maxBranches}`),
          h('li', {}, `PDVs: ${p.maxRegisters < 0 ? 'ilimitados' : p.maxRegisters}`),
          h('li', {}, `Produtos: ${p.maxProducts < 0 ? 'ilimitados' : p.maxProducts}`),
          ...p.features.map((feat) => h('li', {}, `✓ ${feat}`))),
        p.code === atual.code
          ? h('span', { class: 'badge text-bg-primary' }, 'Plano atual')
          : can('plano.gerenciar')
            ? h('button', { class: 'btn btn-outline-primary w-100', onclick: () => trocar(p) }, 'Escolher este plano')
            : null)))));

  const sub = dados.subscription;
  const situacao = {
    trial: ['Período de teste', 'warning'], active: ['Ativa', 'success'],
    past_due: ['Pagamento pendente', 'danger'], cancelled: ['Cancelada', 'secondary'],
    suspended: ['Suspensa', 'danger'],
  }[sub?.status] ?? ['—', 'light'];

  const cancelar = h('button', { class: 'btn btn-outline-danger' }, 'Cancelar assinatura');
  cancelar.onclick = async () => {
    if (!(await confirmAction('Cancelar a assinatura? O acesso continua até o fim do período pago.'))) return;
    try {
      await post('/subscription/cancel', {});
      toast('Assinatura cancelada.');
      location.reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  mount(content,
    pageTitle('Assinatura'),
    h('div', { class: 'row' },
      h('div', { class: 'col-12 col-lg-5' },
        card('Situação', h('div', {},
          h('div', { class: 'd-flex justify-content-between mb-2' },
            h('span', {}, 'Plano'), h('strong', {}, atual.name)),
          h('div', { class: 'd-flex justify-content-between mb-2' },
            h('span', {}, 'Status'), h('span', { class: `badge text-bg-${situacao[1]}` }, situacao[0])),
          sub?.trialEndsAt ? h('div', { class: 'd-flex justify-content-between mb-2' },
            h('span', {}, 'Teste até'), h('strong', {}, new Date(sub.trialEndsAt).toLocaleDateString('pt-BR'))) : null,
          sub?.nextChargeAt ? h('div', { class: 'd-flex justify-content-between mb-3' },
            h('span', {}, 'Próxima cobrança'), h('strong', {}, new Date(sub.nextChargeAt).toLocaleDateString('pt-BR'))) : null,
          can('plano.gerenciar') && sub?.status !== 'cancelled' ? cancelar : null))),
      h('div', { class: 'col-12 col-lg-7' },
        card('Uso do plano', h('div', {},
          barra('Usuários', uso.users, uso.limits.users),
          barra('Filiais', uso.branches, uso.limits.branches),
          barra('PDVs', uso.registers, uso.limits.registers),
          barra('Produtos', uso.products, uso.limits.products))))),
    card('Planos disponíveis', planos),
    h('p', { class: 'txt-secondary f-12' },
      'A cobrança automática ainda não está plugada: a troca de plano vale na hora. '
      + 'O ponto de integração com o gateway é o endpoint POST /api/subscription.'));
  refreshIcons(content);
}
