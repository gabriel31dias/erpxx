// Telas públicas: login, cadastro, recuperação e aceite de convite.
import { post } from './api.js';

const page = document.documentElement.dataset.page;
const form = document.querySelector('form');
const alertBox = document.getElementById('lf-alert');

function show(message, type = 'danger') {
  alertBox.className = `alert alert-${type}`;
  alertBox.textContent = message;
  alertBox.classList.remove('d-none');
}

const token = new URLSearchParams(location.search).get('token') || '';
const tokenField = document.getElementById('token');
if (tokenField) tokenField.value = token;
if ((page === 'reset-password' || page === 'aceitar-convite') && !token) {
  show('Link inválido ou incompleto. Solicite um novo.');
}

const ENDPOINTS = {
  login: '/auth/login',
  cadastro: '/auth/register',
  'esqueci-senha': '/auth/forgot-password',
  'reset-password': '/auth/reset-password',
  'aceitar-convite': '/auth/accept-invite',
};

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertBox.classList.add('d-none');
  const button = form.querySelector('button[type=submit]');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Aguarde…';

  try {
    const body = Object.fromEntries(new FormData(form).entries());
    if (page === 'cadastro' && body.password !== body.passwordConfirm) {
      throw new Error('As senhas não conferem.');
    }
    delete body.passwordConfirm;

    const res = await post(ENDPOINTS[page], body);
    if (res.redirect) {
      const next = new URLSearchParams(location.search).get('next');
      location.href = page === 'login' && next ? next : res.redirect;
      return;
    }
    show(res.message || 'Tudo certo!', 'success');
    if (res.devLink) {
      const link = document.createElement('a');
      link.href = res.devLink;
      link.textContent = 'Abrir link de redefinição (ambiente de desenvolvimento)';
      link.className = 'd-block mt-2';
      alertBox.append(link);
    }
    form.reset();
  } catch (err) {
    show(err.message || 'Não foi possível concluir. Tente novamente.');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});
