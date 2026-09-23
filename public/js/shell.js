// Liga a casca do tema Riho (já renderizada no HTML) à API: permissões do menu,
// usuário, filial selecionada, busca global, notificações e carregamento da página.
import { get, post } from './api.js';
import { estado, pendentes, reenvioAutomatico, sincronizar } from './offline.js';
import { $, debounce, emptyState, fmtBRL, h, icon, modal, refreshIcons, toast } from './ui.js';

export const ctx = { me: null, can: () => false, branchId: '' };

/** Filial escolhida no cabeçalho (fica no aparelho). */
const BRANCH_KEY = 'lf.branch';
export const branchId = () => ctx.branchId || '';

// telas de detalhe destacam o item de menu da seção a que pertencem
const PARENT = {
  produto: 'produtos', categorias: 'produtos', importacao: 'produtos',
  entrada: 'estoque',
  cliente: 'clientes', fornecedor: 'fornecedores',
  lancamento: 'financeiro', venda: 'vendas',
  sessoes: 'caixa', sessao: 'caixa',
  empresa: 'empresa', filiais: 'empresa', pagamentos: 'empresa',
};

function fillUser(me, page) {
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  set('#lf-greeting', `Olá, ${me.user.name.split(' ')[0]}`);
  set('#lf-company', me.company.tradeName || me.company.name);
  set('#lf-username', me.user.name);
  set('#lf-role', me.user.roleLabel);

  // itens do menu sem permissão simplesmente não existem para este usuário
  document.querySelectorAll('.sidebar-list[data-perm]').forEach((li) => {
    if (!ctx.can(li.dataset.perm)) li.remove();
  });
  if (!ctx.can('pdv.acessar')) $('#lf-pdv-link')?.remove();

  document.querySelectorAll('.sidebar-list[data-key]').forEach((li) => {
    const atual = li.dataset.key === (PARENT[page] || page);
    li.classList.toggle('active', atual);
    li.querySelector('a')?.classList.toggle('active', atual);
  });

  $('#lf-logout')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await post('/auth/logout');
    location.href = '/login.html';
  });
}

/**
 * Menu lateral: nasce fechado (a tela é do trabalho, não do menu) e lembra a
 * escolha — cada navegação recarrega a página, e reabrir a toda hora cansa.
 */
const MENU_KEY = 'lf.menu';
// até 991px o tema trata o menu como gaveta sobre a tela (mesmo corte do sidebar-menu.js)
const menuGaveta = () => window.matchMedia('(max-width: 991px)').matches;
function wireSidebar() {
  const header = document.querySelector('.page-header');
  const nav = document.querySelector('.sidebar-wrapper');
  if (!header || !nav) return;
  // celular/tablet: sempre começa fechado — a escolha lembrada vale só no desktop
  // (antes, abrir o menu para navegar fazia a próxima página nascer com ele aberto)
  const aberto = !menuGaveta() && localStorage.getItem(MENU_KEY) === 'aberto';
  header.classList.toggle('close_icon', !aberto);
  nav.classList.toggle('close_icon', !aberto);
  document.querySelector('.bg-overlay')?.remove();

  document.querySelectorAll('.sidebar-toggle').forEach((botao) => {
    botao.addEventListener('click', () => {
      if (menuGaveta()) return;
      // o tema troca a classe no próprio clique; lemos o resultado depois dele
      setTimeout(() => {
        localStorage.setItem(MENU_KEY, nav.classList.contains('close_icon') ? 'fechado' : 'aberto');
      }, 60);
    });
  });

  // celular: tocar num item do menu fecha a gaveta antes de navegar
  nav.addEventListener('click', (e) => {
    if (!menuGaveta() || !e.target.closest('a.sidebar-link[href]')) return;
    header.classList.add('close_icon');
    nav.classList.add('close_icon');
    document.querySelector('.bg-overlay')?.remove();
  });
}

function wireBranch(me) {
  const select = $('#lf-branch');
  const saved = localStorage.getItem(BRANCH_KEY) || '';
  const valid = me.branches.some((b) => b.id === saved);
  ctx.branchId = me.user.branchId || (valid ? saved : '');

  if (!select) return;
  if (me.branches.length < 2 || me.user.branchId) {
    select.closest('li')?.classList.add('d-none');
    return;
  }
  select.replaceChildren(
    h('option', { value: '' }, 'Todas as filiais'),
    ...me.branches.map((b) => h('option', { value: b.id, selected: b.id === ctx.branchId }, b.name)),
  );
  select.onchange = () => {
    localStorage.setItem(BRANCH_KEY, select.value);
    location.reload();
  };
}

function wireSearch() {
  const input = $('#lf-search');
  const box = $('#lf-search-results');
  if (!input || !box) return;

  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) return box.classList.add('d-none');
    const r = await get('/search', { q });
    const group = (title, items, render) => (items.length
      ? [h('h6', { class: 'dropdown-header text-uppercase f-12 mb-0' }, title), ...items.map(render)]
      : []);
    const link = (href, main, sub) => h('a', { class: 'lf-result', href },
      h('span', { class: 'd-block f-w-500' }, main),
      sub ? h('span', { class: 'd-block f-12 txt-secondary' }, sub) : null);

    const children = [
      ...group('Produtos', r.products, (p) => link(`/produto.html?id=${p.id}`, p.name, `${p.sku || ''} · ${fmtBRL(p.priceCents)}`)),
      ...group('Clientes', r.customers, (c) => link(`/cliente.html?id=${c.id}`, c.name, c.phone || '')),
      ...group('Vendas', r.sales, (s) => link(`/venda.html?id=${s.id}`, s.label, fmtBRL(s.totalCents))),
      ...group('Fornecedores', r.suppliers, (f) => link(`/fornecedor.html?id=${f.id}`, f.name, f.phone || '')),
    ];
    box.replaceChildren(children.length
      ? h('div', { class: 'py-2' }, children)
      : h('div', { class: 'p-3 txt-secondary f-12' }, 'Nada encontrado.'));
    box.classList.remove('d-none');
  });

  input.addEventListener('input', run);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.lf-search-wrapper')) box.classList.add('d-none');
  });
}

async function loadNotifications() {
  const list = $('#lf-notifications');
  const badge = $('#lf-unread');
  if (!list) return;
  try {
    const { rows, unread } = await get('/notifications', { pageSize: 6 });
    if (badge) {
      badge.textContent = unread || '';
      badge.style.display = unread ? '' : 'none';
    }
    list.replaceChildren(...(rows.length
      ? rows.map((n) => h('li', { class: 'list-group-item' },
          h('a', { class: 'd-block', href: n.link || '#' },
            h('span', { class: 'f-w-500 d-block' }, n.title),
            n.body ? h('span', { class: 'f-12 txt-secondary' }, n.body) : null)))
      : [h('li', { class: 'list-group-item txt-secondary f-12' }, 'Nenhuma notificação.')]));
  } catch { /* o sino não pode derrubar a página */ }
}

/** Cabeçalho da página: atualiza título/breadcrumb do tema e devolve a barra de ações. */
export function pageTitle(title, ...actions) {
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  set('#lf-title', title);
  set('#lf-crumb', title);
  document.title = `${title} · LojaFlow`;
  const visible = actions.filter(Boolean);
  if (!visible.length) return h('span', { class: 'd-none' });
  return h('div', { class: 'd-flex flex-wrap gap-2 justify-content-end mb-3 lf-no-print' }, visible);
}

/** Aviso fixo de "sem conexão" + contador de alterações na fila. */
function montarAvisoOffline() {
  const texto = h('span', {});
  const link = h('a', { class: 'btn btn-sm btn-light ms-auto', href: '/sincronizacao.html' }, 'Ver pendências');
  const barra = h('div', {
    class: 'alert alert-warning d-none d-flex align-items-center gap-2 mb-3 lf-no-print',
    role: 'status', 'aria-live': 'polite',
  }, texto, link);
  document.getElementById('lf-content')?.before(barra);

  const hora = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    return ` (dados de ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')})`;
  };

  const atualizar = async () => {
    const fila = await pendentes();
    const offline = !navigator.onLine || estado.semServidor;
    if (!offline && !fila) return barra.classList.add('d-none');
    barra.classList.remove('d-none');
    texto.textContent = offline
      ? `Sem conexão com o servidor${hora(estado.dadosDe)}. `
        + (fila ? `${fila} alteração(ões) aguardando envio.` : 'Mostrando o que está guardado neste aparelho.')
      : `${fila} alteração(ões) aguardando envio ao servidor.`;
    link.classList.toggle('d-none', !fila);
  };

  const aoVoltar = async () => {
    const { enviados, falhas } = await sincronizar();
    if (enviados) toast(`${enviados} alteração(ões) enviada(s) ao servidor.`);
    if (falhas) toast(`${falhas} alteração(ões) precisam de revisão.`, 'warning');
    atualizar();
  };

  window.addEventListener('online', aoVoltar);
  window.addEventListener('offline', atualizar);
  ['lf:offline', 'lf:online', 'lf:enfileirado', 'lf:sincronizado']
    .forEach((e) => document.addEventListener(e, atualizar));
  atualizar();
  if (navigator.onLine) aoVoltar();
  reenvioAutomatico();
}

/**
 * Registra o service worker que guarda as telas no aparelho.
 * Navegador só permite isso em origem segura (https:// ou localhost).
 */
export function registrarServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('service worker:', e.message));
    return;
  }
  const aviso = h('div', { class: 'alert alert-info d-flex align-items-center gap-2 mb-3 lf-no-print' },
    h('span', {},
      h('strong', {}, 'Este endereço não funciona sem conexão. '),
      'Para usar o PDV offline, acesse por https:// (o navegador só guarda o app no aparelho em endereços seguros). '
      + `Você está em ${location.protocol}//${location.host}.`));
  document.getElementById('lf-content')?.before(aviso);
}

function montarInstalar() {
  const jaInstalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (jaInstalado) return;

  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const botao = h('button', { class: 'btn btn-sm btn-outline-primary' }, icon('download', 16),
    h('span', { class: 'd-none d-md-inline' }, ' Instalar app'));
  const item = h('li', { class: 'd-none' }, botao);
  document.querySelector('.nav-menus')?.prepend(item);

  let convite = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    convite = e;
    item.classList.remove('d-none');
  });
  if (iOS && window.isSecureContext) item.classList.remove('d-none');

  botao.onclick = async () => {
    if (convite) {
      convite.prompt();
      convite = null;
      item.classList.add('d-none');
      return;
    }
    modal({
      title: 'Instalar no aparelho',
      body: h('div', {},
        h('p', {}, iOS
          ? 'No iPhone/iPad, use o Safari: toque em Compartilhar e escolha "Adicionar à Tela de Início".'
          : 'No Chrome, abra o menu (⋮) e escolha "Instalar aplicativo".'),
        window.isSecureContext ? null : h('div', { class: 'alert alert-warning mb-0' },
          'Este endereço não é seguro (http). A instalação com uso offline só funciona em https://.')),
    });
  };
  refreshIcons(document.querySelector('.nav-menus'));
}

export async function boot() {
  const page = document.documentElement.dataset.page;
  const content = document.getElementById('lf-content');

  let me;
  try {
    me = await get('/auth/me');
  } catch {
    return; // api.js já redirecionou para o login
  }
  ctx.me = me;
  ctx.can = (perm) => me.permissions.includes(perm);

  if (me.company.theme === 'dark') document.body.classList.add('dark-only');
  if (!me.company.onboarded && page !== 'onboarding') {
    location.href = '/onboarding.html';
    return;
  }

  fillUser(me, page);
  wireSidebar();
  wireBranch(me);
  wireSearch();
  registrarServiceWorker();
  montarAvisoOffline();
  montarInstalar();
  loadNotifications();
  setInterval(loadNotifications, 120000);

  try {
    const mod = await import(`./pages/${page}.js`);
    content.replaceChildren();
    await mod.default({ ...ctx, content, me, branchId: ctx.branchId });
  } catch (e) {
    console.error(e);
    content.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'card-body' },
      emptyState(e.message || 'Não foi possível carregar esta tela.'))));
    toast(e.message || 'Erro ao carregar a tela.', 'error');
  }
  refreshIcons();
  document.querySelector('.loader-wrapper')?.style.setProperty('display', 'none');
}

boot();
