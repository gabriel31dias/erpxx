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
function imagem(label, campo, url, { help } = {}) {
  let atual = url || '';
  const previa = h('img', { alt: label, style: 'max-height:80px;max-width:100%;border-radius:6px' });
  const vazio = h('span', { class: 'txt-secondary f-12' }, 'Sem imagem');
  const arquivo = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'd-none' });
  const enviar = h('button', { type: 'button', class: 'btn btn-sm btn-outline-primary', onclick: () => arquivo.click() }, 'Enviar imagem');
  const gravar = async (nova) => {
    await patch('/menu/settings', { [campo]: nova });
    atual = nova;
    mostrar();
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
    logoSize: input({ type: 'number', min: 20, max: 120, value: s.logoSize }),
    tables: input({ type: 'number', min: 0, max: 500, value: s.tables }),
    serviceFeePercent: input({ type: 'number', min: 0, max: 30, value: s.serviceFeePercent }),
  };
  const img = {
    logo: imagem('Logo', 'logoUrl', s.logoUrl, { help: 'Vazio usa o logo da empresa.' }),
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
    field('Sobre a loja', f.description, { col: 'col-12' }),
    img.logo.node, img.banner.node, img.cover.node,
    field('Altura do logo (px)', f.logoSize, { col: 'col-6 col-md-3' }),
    c.showName.node, c.showSubtitle.node,
    h('div', { class: 'col-12 d-flex gap-2 justify-content-end' }, editavel ? salvar : null));

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
        logoSize: Number(f.logoSize.value) || 32,
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
