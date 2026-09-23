// Vendedores externos: acesso ao app de pedidos (login por usuário e senha).
import { del, get, patch, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount,
  card, confirmAction, dataList, field, h, icon, input, modal, refreshIcons, select, toast,
} from '../ui.js';

const soDigitos = (s) => (s || '').replace(/\D+/g, '');
const fmtCpf = (s) => soDigitos(s).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');

/** Máscara leve enquanto digita: 000.000.000-00 */
function mascaraCpf(el) {
  el.addEventListener('input', () => {
    const d = soDigitos(el.value).slice(0, 11);
    el.value = d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  });
  return el;
}

export default async function render({ content }) {
  const lista = h('div', {});

  function formulario(row = {}) {
    const nome = input({ value: row.name ?? '', autocomplete: 'off' });
    const telefone = input({ value: row.phone ?? '', type: 'tel', placeholder: '(00) 00000-0000' });
    const email = input({ value: row.email ?? '', type: 'email' });
    const cpf = mascaraCpf(input({ value: row.cpf ? fmtCpf(row.cpf) : '', inputmode: 'numeric', placeholder: '000.000.000-00' }));
    const usuario = input({ value: row.username ?? '', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    const senha = input({
      type: 'password', autocomplete: 'new-password',
      placeholder: row.id ? 'deixe vazio para manter' : 'mínimo 8 caracteres',
    });
    const ativo = select([
      { value: 'true', label: 'Ativo', selected: row.active !== false },
      { value: 'false', label: 'Bloqueado', selected: row.active === false },
    ]);
    // sugestão de usuário a partir do nome (só no cadastro novo e se ninguém mexeu)
    if (!row.id) {
      nome.addEventListener('input', () => {
        if (usuario.dataset.editado) return;
        const partes = nome.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
          .replace(/[^a-z\s]/g, '').trim().split(/\s+/).filter(Boolean);
        usuario.value = partes.length > 1 ? `${partes[0]}.${partes[partes.length - 1]}` : (partes[0] || '');
      });
      usuario.addEventListener('input', () => { usuario.dataset.editado = '1'; });
    }
    const salvar = h('button', { class: 'btn btn-primary' }, 'Salvar');

    const m = modal({
      title: row.id ? `Editar ${row.name}` : 'Novo vendedor externo',
      body: h('div', { class: 'row g-3' },
        field('Nome', nome, { col: 'col-12' }),
        field('Telefone', telefone, { col: 'col-12 col-md-6' }),
        field('E-mail', email, { col: 'col-12 col-md-6' }),
        field('CPF', cpf, { col: 'col-12 col-md-6' }),
        field('Situação', ativo, { col: 'col-12 col-md-6' }),
        field('Usuário', usuario, { col: 'col-12 col-md-6', help: 'Usado para entrar no app. Letras minúsculas, números, ponto ou hífen.' }),
        field(row.id ? 'Nova senha' : 'Senha', senha, { col: 'col-12 col-md-6' })),
      footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar'), salvar],
    });

    salvar.onclick = async () => {
      if (!row.id && senha.value.length < 8) return toast('A senha precisa de ao menos 8 caracteres.', 'error');
      salvar.disabled = true;
      try {
        const body = {
          name: nome.value.trim(),
          phone: telefone.value.trim() || undefined,
          email: email.value.trim() || undefined,
          cpf: soDigitos(cpf.value),
          username: usuario.value.trim().toLowerCase(),
          active: ativo.value === 'true',
        };
        if (row.id) {
          await patch(`/sellers/${row.id}`, body);
          if (senha.value) await post(`/sellers/${row.id}/password`, { password: senha.value });
        } else {
          await post('/sellers', { ...body, password: senha.value });
        }
        m.close();
        toast('Vendedor salvo.');
        carregar();
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        salvar.disabled = false;
      }
    };
  }

  mount(content,
    pageTitle('Vendedores externos',
      h('button', { class: 'btn btn-primary', onclick: () => formulario() }, icon('plus', 16), ' Novo vendedor')),
    card('Vendedores', lista));

  async function carregar() {
    lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:120px' }));
    const { rows } = await get('/sellers');

    lista.replaceChildren(dataList({
      rows,
      empty: 'Nenhum vendedor externo cadastrado.',
      emptyAction: h('button', { class: 'btn btn-primary btn-sm', onclick: () => formulario() }, 'Cadastrar vendedor'),
      columns: [
        { label: 'Nome', cell: (s) => h('div', {}, h('strong', {}, s.name), h('small', { class: 'd-block txt-secondary' }, fmtCpf(s.cpf))) },
        { label: 'Usuário', cell: (s) => h('code', {}, s.username) },
        { label: 'Contato', cell: (s) => h('div', {}, s.phone || '—', h('small', { class: 'd-block txt-secondary' }, s.email || '')) },
        { label: 'Último acesso', cell: (s) => (s.lastLoginAt ? new Date(s.lastLoginAt).toLocaleString('pt-BR').slice(0, 17) : 'nunca') },
        {
          label: 'Situação',
          cell: (s) => h('span', { class: `badge text-bg-${s.active ? 'success' : 'danger'}` }, s.active ? 'Ativo' : 'Bloqueado'),
        },
        {
          label: '', className: 'text-end',
          cell: (s) => h('div', { class: 'd-flex gap-2 justify-content-end' },
            h('button', { class: 'btn btn-sm btn-outline-secondary', onclick: () => formulario(s) }, 'Editar'),
            h('button', {
              class: 'btn btn-sm btn-outline-danger', 'aria-label': `Excluir ${s.name}`,
              onclick: async () => {
                if (!(await confirmAction(`Excluir ${s.name}? As vendas dele continuam registradas.`))) return;
                try {
                  await del(`/sellers/${s.id}`);
                  toast('Vendedor excluído.');
                  carregar();
                } catch (e) { toast(e.message, 'error'); }
              },
            }, icon('trash-2', 14))),
        },
      ],
    }));
    refreshIcons(content);
  }

  await carregar();
}
