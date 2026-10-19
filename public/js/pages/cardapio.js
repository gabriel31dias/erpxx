// Cardápio digital: aparência, horário e entrega do app do cliente. Produtos entram pela tela de produto.
import { get, patch, uploadImage } from '../api.js';
import { pageTitle } from '../shell.js';
import { card, centsToInput, field, h, input, moneyInput, moneyToCents, mount, refreshIcons, textarea, toast } from '../ui.js';

/** chave liga/desliga com rótulo clicável */
function chave(label, checked, { help, disabled } = {}) {
  const el = h('input', { class: 'form-check-input', type: 'checkbox', role: 'switch', checked, disabled });
  const id = `c-${Math.random().toString(36).slice(2, 8)}`;
  el.id = id;
  return {
    el,
    node: h('div', { class: 'col-12 col-md-6' }, h('div', { class: 'form-check form-switch' }, el,
      h('label', { class: 'form-check-label', for: id }, label),
      help ? h('div', { class: 'form-text' }, help) : null)),
  };
}

/** campo de imagem: prévia + enviar + remover; grava na hora (`campo` = chave em settings) */
function imagem(label, campo, url, { help, onChange } = {}) {
  let atual = url || '';
  const previa = h('img', { alt: label, style: 'max-height:80px;max-width:100%;border-radius:6px' });
  const vazio = h('span', { class: 'txt-secondary f-12' }, 'Sem imagem');
  const arquivo = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'd-none' });
  const enviar = h('button', { type: 'button', class: 'btn btn-sm btn-outline-primary', onclick: () => arquivo.click() }, 'Enviar imagem');
  const gravar = async (nova) => {
    await patch('/menu/settings', { [campo]: nova });
    atual = nova;
    mostrar();
    onChange?.(nova);
    toast(nova ? `${label} salvo.` : `${label} removido.`);
  };
  const remover = h('button', {
    type: 'button', class: 'btn btn-sm btn-outline-danger', onclick: () => gravar('').catch((e) => toast(e.message, 'error')),
  }, 'Remover');
  const mostrar = () => {
    previa.src = atual;
    previa.classList.toggle('d-none', !atual);
    vazio.classList.toggle('d-none', !!atual);
    remover.classList.toggle('d-none', !atual);
  };
  arquivo.onchange = async () => {
    if (!arquivo.files[0]) return;
    enviar.disabled = true;
    try { await gravar(await uploadImage(arquivo.files[0])); } catch (e) { toast(e.message, 'error'); }
    finally { enviar.disabled = false; arquivo.value = ''; }
  };
  mostrar();
  return {
    value: () => atual,
    node: h('div', { class: 'col-12 col-md-4' },
      h('div', { class: 'form-label' }, label),
      h('div', { class: 'mb-2', style: 'min-height:80px' }, previa, vazio),
      h('div', { class: 'd-flex gap-2' }, enviar, remover, arquivo),
      help ? h('div', { class: 'form-text' }, help) : null),
  };
}

const LOGO_MIN = 20;
const LOGO_MAX = 120;

/**
 * Tamanho do logo: controle deslizante + prévia do topo do app (na cor de fundo, como no celular).
 * Na prévia dá para arrastar o canto do logo. `update` redesenha quando logo, nome ou slogan mudam.
 */
function tamanhoLogo(inicial) {
  let altura = Math.min(LOGO_MAX, Math.max(LOGO_MIN, Number(inicial) || 32));
  const faixa = h('input', { type: 'range', class: 'form-range', min: LOGO_MIN, max: LOGO_MAX, step: 1, value: altura, 'aria-label': 'Altura do logo' });
  const valor = h('span', { class: 'badge bg-light text-dark f-12' });

  const logo = h('img', { alt: '', draggable: 'false', style: 'display:block;width:auto;max-width:220px;object-fit:contain;user-select:none' });
  const semLogo = h('div', { style: 'width:24px;height:24px;border-radius:50%' });
  const alca = h('span', {
    title: 'Arraste para mudar o tamanho',
    style: 'position:absolute;right:-7px;bottom:-7px;width:14px;height:14px;border-radius:50%;background:#fff;'
      + 'border:2px solid var(--theme-default,#363afe);cursor:nwse-resize;touch-action:none',
  });
  const moldura = h('div', { style: 'position:relative;outline:1px dashed;outline-offset:3px' }, logo, alca);
  const nome = h('div', { style: 'font-size:17px;font-weight:900;letter-spacing:.05em;text-transform:uppercase;line-height:1;margin-top:2px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' });
  const slogan = h('div', { style: 'font-size:7.5px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;opacity:.8;line-height:1;margin-top:4px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' });
  const pilula = h('div', { style: 'background:#1A1A1E;border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:6px 12px;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px;flex:0 0 auto' },
    h('span', { style: 'width:8px;height:8px;border-radius:50%;background:#34d399' }), 'Aberto');
  const topo = h('div', { style: 'background:#000;border-radius:12px;padding:14px 16px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;max-width:390px;min-height:64px' },
    h('div', { style: 'font-size:22px;line-height:1;width:36px' }, '☰'),
    h('div', { style: 'display:flex;flex-direction:column;align-items:center;min-width:0;padding:0 8px' }, moldura, semLogo, nome, slogan),
    pilula);

  const pintar = () => {
    faixa.value = altura;
    valor.textContent = `${altura}px`;
    logo.style.height = `${altura}px`;
  };
  faixa.oninput = () => { altura = Number(faixa.value); pintar(); };

  // arrastar a alça: para baixo/direita aumenta
  alca.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    alca.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const x0 = e.clientX;
    const a0 = altura;
    const mover = (ev) => {
      const delta = Math.max(ev.clientY - y0, (ev.clientX - x0) / 2);
      altura = Math.round(Math.min(LOGO_MAX, Math.max(LOGO_MIN, a0 + delta)));
      pintar();
    };
    const soltar = () => { alca.removeEventListener('pointermove', mover); alca.removeEventListener('pointerup', soltar); alca.removeEventListener('pointercancel', soltar); };
    alca.addEventListener('pointermove', mover);
    alca.addEventListener('pointerup', soltar);
    alca.addEventListener('pointercancel', soltar);
  });

  const menu = topo.firstChild;
  const update = ({ logoUrl, name, showName, subtitle, showSubtitle, color, background }) => {
    // mesma regra do app (cardapio/src/lib/api.js onColor): texto escuro em fundo claro
    const n = parseInt(background.slice(1), 16);
    const claro = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6;
    const texto = claro ? '#111111' : '#ffffff';
    topo.style.background = background;
    menu.style.color = texto;
    nome.style.color = texto;
    slogan.style.color = texto;
    moldura.style.outlineColor = claro ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.35)';
    logo.src = logoUrl || '';
    moldura.style.display = logoUrl ? '' : 'none';
    semLogo.style.display = logoUrl ? 'none' : '';
    semLogo.style.background = color;
    nome.textContent = name;
    nome.style.display = showName ? '' : 'none';
    slogan.textContent = subtitle;
    slogan.style.display = showSubtitle && subtitle ? '' : 'none';
  };
  pintar();

  return {
    value: () => altura,
    update,
    node: h('div', { class: 'col-12' },
      h('div', { class: 'd-flex align-items-center justify-content-between' },
        h('label', { class: 'form-label mb-0' }, 'Tamanho do logo'), valor),
      h('div', { class: 'd-flex align-items-center gap-2 mb-2', style: 'max-width:390px' },
        h('span', { class: 'f-12 text-muted' }, 'A'), faixa, h('span', { class: 'f-18 text-muted' }, 'A')),
      topo,
      h('div', { class: 'form-text' }, 'Prévia do topo do cardápio no celular. Arraste a barra ou o canto do logo; vale ao clicar em Salvar.')),
  };
}

export default async function render({ content, can }) {
  const s = await get('/menu/settings');
  const editavel = can('cardapio.gerenciar');

  const c = {
    enabled: chave('Cardápio publicado', s.enabled, { help: 'Desligado, o link do cardápio mostra "não encontrado".' }),
    isOpen: chave('Loja aberta para pedidos', s.isOpen),
    acceptsDelivery: chave('Faz entrega', s.acceptsDelivery),
    acceptsPickup: chave('Aceita retirada no local', s.acceptsPickup),
    whatsappEnabled: chave('Pedido pelo WhatsApp', s.whatsappEnabled, { help: 'Usa o WhatsApp do cadastro da empresa.' }),
    pixEnabled: chave('Pix no cardápio', s.pixEnabled && s.pixReady, {
      disabled: !s.pixReady,
      help: s.pixReady ? 'Cobrança pelo gateway PIX da empresa; confirma sozinho.' : 'Configure o PIX em Configurações para liberar.',
    }),
    showName: chave('Mostrar o nome embaixo do logo', s.showName),
    showSubtitle: chave('Mostrar o slogan embaixo do logo', s.showSubtitle),
  };
  const f = {
    deliveryFee: moneyInput({ value: centsToInput(s.deliveryFeeCents) }),
    deliveryTime: input({ value: s.deliveryTime, placeholder: '30 - 50 min' }),
    hours: input({ value: s.hours, placeholder: '18:00 às 23:00' }),
    subtitle: input({ value: s.subtitle, maxlength: 80 }),
    description: textarea({ value: s.description, maxlength: 1000 }),
    instagram: input({ value: s.instagram, placeholder: '@sualoja' }),
    primaryColor: input({ type: 'color', value: s.primaryColor, style: 'height:38px' }),
    backgroundColor: input({ type: 'color', value: s.backgroundColor, style: 'height:38px' }),
    tables: input({ type: 'number', min: 0, max: 500, value: s.tables }),
    serviceFeePercent: input({ type: 'number', min: 0, max: 30, value: s.serviceFeePercent }),
  };
  const logoSize = tamanhoLogo(s.logoSize);
  const previa = () => logoSize.update({
    logoUrl: img.logo.value() || s.companyLogo,
    name: s.companyName,
    showName: c.showName.el.checked,
    subtitle: f.subtitle.value.trim(),
    showSubtitle: c.showSubtitle.el.checked,
    color: f.primaryColor.value,
    background: f.backgroundColor.value,
  });
  const img = {
    logo: imagem('Logo', 'logoUrl', s.logoUrl, { help: 'Vazio usa o logo da empresa.', onChange: () => previa() }),
    banner: imagem('Banner', 'bannerUrl', s.bannerUrl),
    cover: imagem('Foto de capa', 'coverUrl', s.coverUrl),
  };

  const link = s.menuUrl
    ? h('a', { href: s.menuUrl, target: '_blank', rel: 'noopener', class: 'btn btn-outline-primary' }, 'Abrir cardápio')
    : null;
  const salvar = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar');
  const form = h('form', { class: 'row g-3' },
    h('h6', { class: 'col-12 txt-primary mb-0' }, 'Funcionamento'),
    c.enabled.node, c.isOpen.node, c.acceptsDelivery.node, c.acceptsPickup.node, c.whatsappEnabled.node, c.pixEnabled.node,
    field('Taxa de entrega (R$)', f.deliveryFee, { col: 'col-6 col-md-3' }),
    field('Tempo de entrega', f.deliveryTime, { col: 'col-6 col-md-3' }),
    field('Horário', f.hours, { col: 'col-12 col-md-6' }),
    field('Mesas no salão', f.tables, { col: 'col-6 col-md-3', help: 'Para o app do garçom (/garcom). 0 = sem mesas.' }),
    field('Taxa de serviço (%)', f.serviceFeePercent, { col: 'col-6 col-md-3', help: 'Na conta da mesa; o caixa pode tirar ao fechar. 0 = sem taxa.' }),
    h('div', { class: 'col-12' }, h('hr', {})),
    h('h6', { class: 'col-12 txt-primary mb-0' }, 'Aparência'),
    field('Slogan', f.subtitle, { col: 'col-12 col-md-6' }),
    field('Instagram', f.instagram, { col: 'col-6 col-md-3' }),
    field('Cor principal', f.primaryColor, { col: 'col-6 col-md-3' }),
    field('Cor de fundo', f.backgroundColor, { col: 'col-6 col-md-3', help: 'Abertura e topo do cardápio, atrás do logo.' }),
    field('Sobre a loja', f.description, { col: 'col-12' }),
    img.logo.node, img.banner.node, img.cover.node,
    c.showName.node, c.showSubtitle.node,
    logoSize.node,
    h('div', { class: 'col-12 d-flex gap-2 justify-content-end' }, editavel ? salvar : null));

  previa();
  for (const el of [c.showName.el, c.showSubtitle.el, f.subtitle, f.primaryColor, f.backgroundColor]) el.addEventListener('input', previa);
  for (const el of [c.showName.el, c.showSubtitle.el]) el.addEventListener('change', previa);

  form.onsubmit = async (e) => {
    e.preventDefault();
    salvar.disabled = true;
    try {
      await patch('/menu/settings', {
        ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.el.checked])),
        deliveryFeeCents: moneyToCents(f.deliveryFee.value),
        deliveryTime: f.deliveryTime.value.trim(),
        hours: f.hours.value.trim(),
        subtitle: f.subtitle.value.trim(),
        description: f.description.value.trim(),
        instagram: f.instagram.value.trim(),
        primaryColor: f.primaryColor.value,
        backgroundColor: f.backgroundColor.value,
        logoSize: logoSize.value(),
        tables: Math.max(0, Number(f.tables.value) || 0),
        serviceFeePercent: Math.min(30, Math.max(0, Number(f.serviceFeePercent.value) || 0)),
        logoUrl: img.logo.value(),
        bannerUrl: img.banner.value(),
        coverUrl: img.cover.value(),
      });
      toast('Cardápio salvo.');
    } catch (err) { toast(err.message, 'error'); } finally { salvar.disabled = false; }
  };

  mount(content,
    pageTitle('Cardápio digital', link, h('a', { class: 'btn btn-outline-secondary', href: '/pedidos.html' }, 'Pedidos')),
    s.menuUrl ? null : h('div', { class: 'alert alert-light' }, `Link do cardápio: <endereço do app>/${s.slug} (defina MENU_URL no servidor para mostrar o link aqui).`),
    card('Configuração', form),
    card('Produtos no cardápio', h('p', { class: 'mb-0' },
      'Abra o produto e, em "Cardápio digital", marque "Mostrar no cardápio" e cadastre tamanhos, adicionais e escolhas. ',
      'Pizza meio a meio: em Categorias, defina quantos sabores a categoria aceita. ',
      h('a', { href: '/produtos.html' }, 'Ir para produtos'))));
  refreshIcons(content);
}
