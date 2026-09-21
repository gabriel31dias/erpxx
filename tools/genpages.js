// Gera as páginas HTML usando a marcação real do tema Riho (page-wrapper/sidebar/page-header).
// O PDV tem template próprio: tela cheia, sem menu, feito para teclado.
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'public');

const CSS = `<link rel="icon" href="/assets/images/favicon.png" type="image/x-icon">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#363afe">
<meta name="mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="stylesheet" href="/fonts.css">
<link rel="stylesheet" type="text/css" href="/assets/css/font-awesome.css">
<link rel="stylesheet" type="text/css" href="/assets/css/vendors/icofont.css">
<link rel="stylesheet" type="text/css" href="/assets/css/vendors/themify.css">
<link rel="stylesheet" type="text/css" href="/assets/css/vendors/feather-icon.css">
<link rel="stylesheet" type="text/css" href="/assets/css/vendors/scrollbar.css">
<link rel="stylesheet" type="text/css" href="/assets/css/vendors/bootstrap.css">
<link rel="stylesheet" type="text/css" href="/assets/css/style.css">
<link id="color" rel="stylesheet" href="/assets/css/color-1.css" media="screen">
<link rel="stylesheet" type="text/css" href="/assets/css/responsive.css">
<link rel="stylesheet" href="/app.css">`;

const THEME_JS = `<script src="/assets/js/jquery.min.js"></script>
<script src="/assets/js/bootstrap/bootstrap.bundle.min.js"></script>
<script src="/assets/js/icons/feather-icon/feather.min.js"></script>
<script src="/assets/js/icons/feather-icon/feather-icon.js"></script>
<script src="/assets/js/scrollbar/simplebar.js"></script>
<script src="/assets/js/scrollbar/custom.js"></script>
<script src="/assets/js/config.js"></script>
<script src="/assets/js/sidebar-menu.js"></script>
<script src="/assets/js/sidebar-pin.js"></script>
<script src="/assets/js/script.js"></script>`;

const sprite = (id) => `<svg class="stroke-icon"><use href="/assets/svg/icon-sprite.svg#stroke-${id}"></use></svg><svg class="fill-icon"><use href="/assets/svg/icon-sprite.svg#fill-${id}"></use></svg>`;

const MENU = [
  { group: 'Operação' },
  { key: 'dashboard', href: '/', label: 'Dashboard', icon: 'home', perm: 'dashboard.visualizar' },
  { key: 'pdv', href: '/pdv.html', label: 'PDV', icon: 'ecommerce', perm: 'pdv.acessar' },
  { key: 'vendas', href: '/vendas.html', label: 'Vendas', icon: 'file', perm: 'venda.visualizar' },
  { key: 'caixa', href: '/caixa.html', label: 'Caixa', icon: 'bonus-kit', perm: 'caixa.visualizar' },
  { group: 'Cadastros' },
  { key: 'produtos', href: '/produtos.html', label: 'Produtos', icon: 'to-do', perm: 'produto.visualizar' },
  { key: 'estoque', href: '/estoque.html', label: 'Estoque', icon: 'charts', perm: 'estoque.visualizar' },
  { key: 'clientes', href: '/clientes.html', label: 'Clientes', icon: 'contact', perm: 'cliente.visualizar' },
  { key: 'fornecedores', href: '/fornecedores.html', label: 'Fornecedores', icon: 'social', perm: 'fornecedor.visualizar' },
  { group: 'Gestão' },
  { key: 'financeiro', href: '/financeiro.html', label: 'Financeiro', icon: 'ecommerce', perm: 'financeiro.visualizar' },
  { key: 'bancos', href: '/bancos.html', label: 'Bancos e fluxo', icon: 'bonus-kit', perm: 'financeiro.visualizar' },
  { key: 'notas', href: '/notas.html', label: 'Notas fiscais', icon: 'file', perm: 'venda.visualizar' },
  { key: 'relatorios', href: '/relatorios.html', label: 'Relatórios', icon: 'charts', perm: 'relatorio.visualizar' },
  { group: 'Administração' },
  { key: 'usuarios', href: '/usuarios.html', label: 'Equipe e permissões', icon: 'user', perm: 'usuario.gerenciar' },
  { key: 'empresa', href: '/empresa.html', label: 'Empresa e filiais', icon: 'others', perm: 'empresa.gerenciar' },
  { key: 'configuracoes', href: '/configuracoes.html', label: 'Configurações', icon: 'others', perm: 'empresa.gerenciar' },
  { key: 'assinatura', href: '/assinatura.html', label: 'Assinatura', icon: 'bonus-kit', perm: 'plano.gerenciar' },
  { key: 'auditoria', href: '/auditoria.html', label: 'Auditoria', icon: 'file', perm: 'auditoria.visualizar' },
];

const menuHtml = (active) => MENU.map((m) => m.group
  ? `<li class="sidebar-main-title"><div><h6>${m.group}</h6></div></li>`
  : `<li class="sidebar-list${m.key === active ? ' active' : ''}" data-key="${m.key}"${m.perm ? ` data-perm="${m.perm}"` : ''}><i class="fa fa-thumb-tack"></i>
       <a class="sidebar-link sidebar-title link-nav${m.key === active ? ' active' : ''}" href="${m.href}">${sprite(m.icon)}<span>${m.label}</span></a>
     </li>`).join('\n              ');

function appPage(key, title, extraJs = '', extraCss = '') {
  return `<!doctype html>
<html lang="pt-BR" data-page="${key}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="LojaFlow — ERP e PDV para lojas: vendas, estoque, caixa, financeiro e relatórios.">
<title>${title} · LojaFlow</title>
${CSS}
${extraCss}
</head>
<body>
<div class="loader-wrapper"><div class="loader"><div class="loader4"></div></div></div>
<div class="tap-top"><i data-feather="chevrons-up"></i></div>
<div class="page-wrapper compact-wrapper" id="pageWrapper">
  <div class="page-header close_icon">
    <div class="header-wrapper row m-0">
      <div class="header-logo-wrapper col-auto p-0">
        <div class="logo-wrapper"><a href="/" class="lf-brand"><img src="/icons/brand-white.png" alt="Blue Vision" class="lf-logo"></a></div>
        <div class="toggle-sidebar"><i class="status_toggle middle sidebar-toggle" data-feather="align-center"></i></div>
      </div>
      <div class="left-header col-xxl-5 col-xl-6 col-lg-5 col-md-4 col-sm-3 p-0">
        <div class="d-flex align-items-center gap-2"><h4 class="f-w-600 mb-0" id="lf-greeting">Bem-vindo</h4></div>
        <div class="welcome-content d-xl-block d-none"><span class="text-truncate col-12" id="lf-company"></span></div>
      </div>
      <div class="nav-right col-xxl-7 col-xl-6 col-md-7 col-8 pull-right right-header p-0 ms-auto">
        <ul class="nav-menus">
          <li class="d-none d-lg-block"><select class="form-select form-select-sm" id="lf-branch" aria-label="Filial"></select></li>
          <li class="d-md-block d-none lf-search-wrapper">
            <div class="form search-form mb-0">
              <div class="input-group"><span class="input-icon">
                <svg><use href="/assets/svg/icon-sprite.svg#search-header"></use></svg>
                <input class="w-100" id="lf-search" type="search" placeholder="Buscar produto, cliente, venda…" aria-label="Busca global"></span>
              </div>
            </div>
            <div class="lf-results d-none" id="lf-search-results"></div>
          </li>
          <li><a class="btn btn-primary btn-sm" href="/pdv.html" id="lf-pdv-link">PDV</a></li>
          <li><div class="mode"><i class="moon" data-feather="moon"></i></div></li>
          <li class="onhover-dropdown notification-down">
            <div class="notification-box"><svg><use href="/assets/svg/icon-sprite.svg#notification-header"></use></svg><span class="badge rounded-pill badge-secondary" id="lf-unread" style="display:none"></span></div>
            <div class="onhover-show-div notification-dropdown">
              <div class="card mb-0">
                <div class="card-header p-3">
                  <div class="common-space d-flex justify-content-between align-items-center">
                    <h4 class="text-start f-w-600 mb-0">Notificações</h4>
                    <a class="f-w-500" href="/notificacoes.html">Ver todas</a>
                  </div>
                </div>
                <div class="card-body p-0"><ul class="list-group list-group-flush" id="lf-notifications"></ul></div>
              </div>
            </div>
          </li>
          <li class="profile-nav onhover-dropdown">
            <div class="media profile-media">
              <div class="media-body">
                <div class="d-flex align-items-center gap-2"><span id="lf-username">…</span><i class="middle fa fa-angle-down"></i></div>
                <p class="mb-0 font-roboto" id="lf-role"></p>
              </div>
            </div>
            <ul class="profile-dropdown onhover-show-div">
              <li><a href="/perfil.html"><i data-feather="user"></i><span>Meu perfil</span></a></li>
              <li><a href="/notificacoes.html"><i data-feather="bell"></i><span>Notificações</span></a></li>
              <li><a href="/sincronizacao.html"><i data-feather="refresh-cw"></i><span>Sincronização</span></a></li>
              <li><a class="btn btn-pill btn-outline-primary btn-sm" href="#" id="lf-logout">Sair</a></li>
            </ul>
          </li>
        </ul>
      </div>
    </div>
  </div>
  <div class="page-body-wrapper">
    <div class="sidebar-wrapper close_icon" data-layout="stroke-svg">
      <div class="logo-wrapper"><a href="/" class="lf-brand"><img src="/icons/brand-white.png" alt="Blue Vision" class="lf-logo"></a>
        <div class="back-btn"><i class="fa fa-angle-left"></i></div>
        <div class="toggle-sidebar"><i class="status_toggle middle sidebar-toggle" data-feather="grid"></i></div>
      </div>
      <div class="logo-icon-wrapper"><a href="/"><i data-feather="shopping-bag"></i></a></div>
      <nav class="sidebar-main">
        <div class="left-arrow" id="left-arrow"><i data-feather="arrow-left"></i></div>
        <div id="sidebar-menu">
          <ul class="sidebar-links" id="simple-bar">
            <li class="back-btn"><a href="/"><i data-feather="shopping-bag"></i></a>
              <div class="mobile-back text-end"><span>Voltar</span><i class="fa fa-angle-right ps-2" aria-hidden="true"></i></div>
            </li>
            <li class="pin-title sidebar-main-title"><div><h6>Fixados</h6></div></li>
            ${menuHtml(key)}
          </ul>
        </div>
        <div class="right-arrow" id="right-arrow"><i data-feather="arrow-right"></i></div>
      </nav>
    </div>
    <div class="page-body">
      <div class="container-fluid">
        <div class="page-title">
          <div class="row">
            <div class="col-6"><h3 id="lf-title">${title}</h3></div>
            <div class="col-6">
              <ol class="breadcrumb">
                <li class="breadcrumb-item"><a href="/"><svg class="stroke-icon"><use href="/assets/svg/icon-sprite.svg#stroke-home"></use></svg></a></li>
                <li class="breadcrumb-item active" id="lf-crumb">${title}</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
      <div class="container-fluid" id="lf-content">
        <div class="row"><div class="col-12"><div class="card"><div class="card-body text-center py-5">
          <div class="spinner-border text-primary" role="status"><span class="sr-only">Carregando…</span></div>
        </div></div></div></div>
      </div>
    </div>
    <footer class="footer">
      <div class="container-fluid"><div class="row"><div class="col-md-12 footer-copyright text-center">
        <p class="mb-0">LojaFlow · ERP e PDV para lojas varejistas</p>
      </div></div></div>
    </footer>
  </div>
</div>
${THEME_JS}
${extraJs}
<script type="module" src="/js/shell.js"></script>
</body>
</html>
`;
}

/** Tela do PDV: sem menu, sem breadcrumb, feita para teclado e leitor. */
function pdvPage() {
  return `<!doctype html>
<html lang="pt-BR" data-page="pdv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>PDV · LojaFlow</title>
<link rel="icon" href="/assets/images/favicon.png" type="image/x-icon">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0e141a">
<link rel="stylesheet" href="/fonts.css">
<link rel="stylesheet" type="text/css" href="/assets/css/vendors/bootstrap.css">
<link rel="stylesheet" href="/pdv.css">
</head>
<body class="lf-pdv-body">
<div id="lf-pdv" class="lf-pdv">
  <div class="lf-pdv-loading">Abrindo o PDV…</div>
</div>
<script src="/assets/js/bootstrap/bootstrap.bundle.min.js"></script>
<script type="module" src="/js/pdv.js"></script>
</body>
</html>
`;
}

function authPage(key, title, subtitle, fields, footer) {
  return `<!doctype html>
<html lang="pt-BR" data-page="${key}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} · LojaFlow</title>
${CSS}
</head>
<body>
<div class="container-fluid p-0">
  <div class="row m-0">
    <div class="col-12 p-0">
      <div class="login-card login-dark">
        <div>
          <div><a class="logo lf-brand" href="/"><img src="/icons/brand-white.png" alt="Blue Vision" class="lf-logo"></a></div>
          <div class="login-main">
            <form class="theme-form" novalidate>
              <h4>${title}</h4>
              <p>${subtitle}</p>
              <div id="lf-alert" class="alert d-none" role="alert"></div>
${fields}
            </form>
            <p class="mt-4 mb-0 text-center">${footer}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<script src="/assets/js/jquery.min.js"></script>
<script src="/assets/js/bootstrap/bootstrap.bundle.min.js"></script>
<script src="/assets/js/icons/feather-icon/feather.min.js"></script>
<script src="/assets/js/icons/feather-icon/feather-icon.js"></script>
<script type="module" src="/js/auth.js"></script>
</body>
</html>
`;
}

const APEX = '<script src="/assets/js/chart/apex-chart/apex-chart.js"></script>';

const pages = [
  ['dashboard', 'Dashboard', 'index.html', APEX],
  ['vendas', 'Vendas', 'vendas.html', ''],
  ['venda', 'Venda', 'venda.html', ''],
  ['caixa', 'Caixa', 'caixa.html', ''],
  ['sessoes', 'Aberturas e fechamentos', 'sessoes.html', ''],
  ['sessao', 'Sessão de caixa', 'sessao.html', ''],
  ['produtos', 'Produtos', 'produtos.html', ''],
  ['produto', 'Produto', 'produto.html', ''],
  ['categorias', 'Categorias', 'categorias.html', ''],
  ['estoque', 'Estoque', 'estoque.html', ''],
  ['entrada', 'Entrada de mercadoria', 'entrada.html', ''],
  ['importacao', 'Importar produtos', 'importacao.html', ''],
  ['clientes', 'Clientes', 'clientes.html', ''],
  ['cliente', 'Cliente', 'cliente.html', ''],
  ['fornecedores', 'Fornecedores', 'fornecedores.html', ''],
  ['fornecedor', 'Fornecedor', 'fornecedor.html', ''],
  ['financeiro', 'Financeiro', 'financeiro.html', APEX],
  ['bancos', 'Bancos e fluxo', 'bancos.html', APEX],
  ['notas', 'Notas fiscais', 'notas.html', ''],
  ['lancamento', 'Lançamento financeiro', 'lancamento.html', ''],
  ['relatorios', 'Relatórios', 'relatorios.html', APEX],
  ['usuarios', 'Equipe e permissões', 'usuarios.html', ''],
  ['empresa', 'Empresa e filiais', 'empresa.html', ''],
  ['configuracoes', 'Configurações', 'configuracoes.html', ''],
  ['assinatura', 'Assinatura', 'assinatura.html', ''],
  ['auditoria', 'Auditoria', 'auditoria.html', ''],
  ['perfil', 'Meu perfil', 'perfil.html', ''],
  ['notificacoes', 'Notificações', 'notificacoes.html', ''],
  ['sincronizacao', 'Sincronização', 'sincronizacao.html', ''],
  ['onboarding', 'Primeiros passos', 'onboarding.html', ''],
];
for (const [key, title, file, extra, extraCss] of pages) {
  fs.writeFileSync(path.join(OUT, file), appPage(key, title, extra, extraCss || ''));
}
fs.writeFileSync(path.join(OUT, 'pdv.html'), pdvPage());

const group = (label, input, help = '') =>
  `              <div class="form-group">
                <label class="col-form-label" for="${input.id}">${label}</label>
                ${input.html}
                ${help ? `<div class="form-text">${help}</div>` : ''}
              </div>`;

const text = (id, name, type = 'text', attrs = '') => ({
  id, html: `<input class="form-control" id="${id}" name="${name}" type="${type}" ${attrs}>`,
});

const submit = (label) =>
  `              <div class="form-group mb-0">
                <div class="text-end mt-3"><button class="btn btn-primary btn-block w-100" type="submit">${label}</button></div>
              </div>`;

fs.writeFileSync(path.join(OUT, 'login.html'), authPage('login', 'Entrar na sua conta', 'Informe e-mail e senha para acessar a loja.',
  [group('E-mail', text('email', 'email', 'email', 'autocomplete="email" required')),
   group('Senha', text('password', 'password', 'password', 'autocomplete="current-password" required')),
   submit('Entrar'),
   `              <p class="text-muted mt-3 mb-0 f-12">Demonstração: <strong>proprietaria@bompreco.com.br</strong> · senha <strong>senha1234</strong></p>`].join('\n'),
  '<a href="/esqueci-senha.html">Esqueci minha senha</a><span class="mx-2">·</span><a href="/cadastro.html">Cadastrar minha loja</a>'));

fs.writeFileSync(path.join(OUT, 'cadastro.html'), authPage('cadastro', 'Criar conta da loja', 'Teste grátis e comece a vender hoje.',
  [group('Nome da loja', text('companyName', 'companyName', 'text', 'required minlength="2"')),
   group('Seu nome', text('name', 'name', 'text', 'required minlength="2"')),
   group('E-mail', text('email', 'email', 'email', 'required autocomplete="email"')),
   group('WhatsApp da loja', text('phone', 'phone', 'tel', 'inputmode="tel" placeholder="(11) 99999-9999"')),
   group('Senha', text('password', 'password', 'password', 'required minlength="8"'), 'Mínimo de 8 caracteres.'),
   group('Confirmar senha', text('passwordConfirm', 'passwordConfirm', 'password', 'required minlength="8"')),
   submit('Criar conta')].join('\n'),
  'Já tem conta?<a class="ms-2" href="/login.html">Entrar</a>'));

fs.writeFileSync(path.join(OUT, 'esqueci-senha.html'), authPage('esqueci-senha', 'Recuperar senha', 'Enviaremos um link para você redefinir a senha.',
  [group('E-mail', text('email', 'email', 'email', 'required')), submit('Enviar link')].join('\n'),
  '<a href="/login.html">Voltar para o login</a>'));

fs.writeFileSync(path.join(OUT, 'reset-password.html'), authPage('reset-password', 'Definir nova senha', 'Escolha uma nova senha para sua conta.',
  [`              <input type="hidden" id="token" name="token">`,
   group('Nova senha', text('password', 'password', 'password', 'required minlength="8"'), 'Mínimo de 8 caracteres.'),
   submit('Redefinir senha')].join('\n'),
  '<a href="/login.html">Voltar para o login</a>'));

fs.writeFileSync(path.join(OUT, 'aceitar-convite.html'), authPage('aceitar-convite', 'Aceitar convite', 'Crie seu acesso para entrar na equipe.',
  [`              <input type="hidden" id="token" name="token">`,
   group('Seu nome', text('name', 'name', 'text', 'required minlength="2"')),
   group('Senha', text('password', 'password', 'password', 'required minlength="8"')),
   submit('Entrar na equipe')].join('\n'),
  '<a href="/login.html">Já tenho conta</a>'));

console.log(`páginas geradas: ${pages.length + 6}`);

// ---------- precache do service worker ----------
function listar(dir, filtro, base = OUT) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return listar(full, filtro, base);
    return filtro(full) ? ['/' + path.relative(base, full).split(path.sep).join('/')] : [];
  });
}

const locais = listar(OUT, (f) => /\.(html|css|js|woff2|png|webmanifest)$/.test(f))
  .filter((u) => !u.startsWith('/sw.js') && !u.startsWith('/precache.js'));

const doTema = new Set();
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(OUT, f), 'utf8');
  for (const m of html.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)) doTema.add(m[1]);
}
doTema.add('/assets/svg/icon-sprite.svg');

const precache = [...new Set(['/', ...locais, ...doTema])].sort();
const crypto = require('crypto');
const hash = crypto.createHash('sha1');
for (const u of locais) hash.update(u).update(fs.readFileSync(path.join(OUT, u.slice(1))));
const versao = hash.digest('hex').slice(0, 10);
fs.writeFileSync(path.join(OUT, 'precache.js'),
  `// Gerado por tools/genpages.js — arquivos que ficam no aparelho.\n`
  + `self.CACHE_VERSION = '${versao}';\n`
  + `self.PRECACHE = ${JSON.stringify(precache, null, 2)};\n`);
console.log(`precache: ${precache.length} arquivos`);
