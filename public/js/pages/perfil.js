// Meu perfil: nome, tema e troca de senha.
import { get, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, card, field, h, input, refreshIcons, select, toast } from '../ui.js';

export default async function render({ content, me }) {
  const nome = input({ value: me.user.name });
  const tema = select([
    { value: 'light', label: 'Claro', selected: me.company.theme === 'light' },
    { value: 'dark', label: 'Escuro', selected: me.company.theme === 'dark' },
  ]);
  const salvar = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar');
  const perfil = h('form', { class: 'row g-3' },
    field('Nome', nome, { col: 'col-12 col-md-6' }),
    field('Tema do sistema', tema, { col: 'col-6 col-md-3' }),
    h('div', { class: 'col-12 text-end' }, salvar));
  perfil.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await post('/auth/profile', { name: nome.value.trim(), theme: tema.value });
      toast('Perfil atualizado.');
      location.reload();
    } catch (err) { toast(err.message, 'error'); }
  };

  const atual = input({ type: 'password' });
  const nova = input({ type: 'password' });
  const confirmar = input({ type: 'password' });
  const trocar = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Alterar senha');
  const senha = h('form', { class: 'row g-3' },
    field('Senha atual', atual, { col: 'col-12 col-md-4' }),
    field('Nova senha', nova, { col: 'col-12 col-md-4', help: 'Mínimo de 8 caracteres.' }),
    field('Confirmar nova senha', confirmar, { col: 'col-12 col-md-4' }),
    h('div', { class: 'col-12 text-end' }, trocar));
  senha.onsubmit = async (e) => {
    e.preventDefault();
    if (nova.value !== confirmar.value) return toast('As senhas não conferem.', 'warning');
    try {
      await post('/auth/change-password', { currentPassword: atual.value, newPassword: nova.value });
      toast('Senha alterada.');
      senha.reset();
    } catch (err) { toast(err.message, 'error'); }
  };

  mount(content,
    pageTitle('Meu perfil'),
    card('Dados', perfil),
    card('Segurança', senha),
    card('Acesso', h('div', {},
      h('div', { class: 'd-flex justify-content-between' }, h('span', {}, 'E-mail'), h('strong', {}, me.user.email)),
      h('div', { class: 'd-flex justify-content-between' }, h('span', {}, 'Perfil'), h('strong', {}, me.user.roleLabel)),
      h('div', { class: 'd-flex justify-content-between' }, h('span', {}, 'Empresa'), h('strong', {}, me.company.tradeName || me.company.name)))));
  refreshIcons(content);
}
