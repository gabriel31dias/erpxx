// Equipe: usuários, convites e a matriz de permissões por função.
import { del, get, patch, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount,
  card, confirmAction, dataList, field, fmtDateTime, h, icon, input, modal, refreshIcons, select,
  toast,
} from '../ui.js';

export default async function render({ content, me }) {
  const lista = h('div', {});
  const convites = h('div', {});
  const { roles, permissions } = await get('/users/roles');
  const filiais = me.branches;

  const opcoesPerfil = roles.filter((r) => r.value !== 'proprietario')
    .map((r) => ({ value: r.value, label: r.label }));
  const opcoesFilial = [{ value: '', label: 'Todas as filiais' },
    ...filiais.map((b) => ({ value: b.id, label: b.name }))];

  function formularioUsuario(row = {}) {
    const nome = input({ value: row.name ?? '' });
    const email = input({ value: row.email ?? '', type: 'email', disabled: !!row.id });
    const senha = input({ type: 'password', placeholder: row.id ? 'deixe vazio para manter' : 'mínimo 8 caracteres' });
    const perfil = select(opcoesPerfil.map((o) => ({ ...o, selected: o.value === row.role })));
    const filial = select(opcoesFilial.map((o) => ({ ...o, selected: o.value === (row.branchId ?? '') })));
    const ativo = select([
      { value: 'true', label: 'Ativo', selected: row.active !== false },
      { value: 'false', label: 'Bloqueado', selected: row.active === false },
    ]);
    const salvar = h('button', { class: 'btn btn-primary' }, 'Salvar');

    const m = modal({
      title: row.id ? `Editar ${row.name}` : 'Novo usuário',
      body: h('div', { class: 'row g-3' },
        field('Nome', nome, { col: 'col-12 col-md-6' }),
        field('E-mail', email, { col: 'col-12 col-md-6' }),
        field('Perfil', perfil, { col: 'col-6 col-md-4' }),
        field('Filial', filial, { col: 'col-6 col-md-4', help: 'Restringe o acesso a uma loja.' }),
        field('Situação', ativo, { col: 'col-6 col-md-4' }),
        field(row.id ? 'Nova senha' : 'Senha', senha, { col: 'col-12 col-md-6' })),
      footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar'), salvar],
    });

    salvar.onclick = async () => {
      try {
        const body = {
          name: nome.value.trim(), role: perfil.value,
          branchId: filial.value || undefined, active: ativo.value === 'true',
        };
        if (row.id) {
          await patch(`/users/${row.id}`, body);
          if (senha.value) await post(`/users/${row.id}/password`, { password: senha.value });
        } else {
          await post('/users', { ...body, email: email.value.trim(), password: senha.value });
        }
        m.close();
        toast('Usuário salvo.');
        carregar();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  function convidar() {
    const email = input({ type: 'email' });
    const perfil = select(opcoesPerfil);
    const filial = select(opcoesFilial);
    const enviar = h('button', { class: 'btn btn-primary' }, 'Gerar convite');
    const m = modal({
      title: 'Convidar para a equipe',
      body: h('div', { class: 'row g-3' },
        field('E-mail', email, { col: 'col-12 col-md-6' }),
        field('Perfil', perfil, { col: 'col-6 col-md-3' }),
        field('Filial', filial, { col: 'col-6 col-md-3' })),
      footer: [enviar],
    });
    enviar.onclick = async () => {
      try {
        const { link } = await post('/users/invite', {
          email: email.value.trim(), role: perfil.value, branchId: filial.value || undefined,
        });
        m.close();
        const url = `${location.origin}${link}`;
        modal({
          title: 'Convite criado',
          body: h('div', {},
            h('p', {}, 'Envie este link para a pessoa entrar na equipe (validade de 7 dias):'),
            h('input', { class: 'form-control', value: url, readonly: true, onclick: (e) => e.target.select() })),
        });
        carregar();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  function verPermissoes() {
    modal({
      title: 'Funções e permissões',
      size: 'modal-xl',
      body: h('div', { class: 'table-responsive' }, h('table', { class: 'table table-sm align-middle' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Permissão'), ...roles.map((r) => h('th', { class: 'text-center' }, r.label)))),
        h('tbody', {}, permissions.map((p) => h('tr', {},
          h('td', {}, h('code', {}, p)),
          ...roles.map((r) => h('td', { class: 'text-center' },
            r.permissions.includes(p) ? h('span', { class: 'text-success' }, '✓') : h('span', { class: 'txt-secondary' }, '—')))))))),
    });
  }

  mount(content,
    pageTitle('Equipe e permissões',
      h('button', { class: 'btn btn-outline-secondary', onclick: verPermissoes }, 'Ver permissões'),
      h('button', { class: 'btn btn-outline-primary', onclick: convidar }, 'Convidar'),
      h('button', { class: 'btn btn-primary', onclick: () => formularioUsuario() }, icon('plus', 16), ' Novo usuário')),
    card('Usuários', lista),
    card('Convites pendentes', convites));

  async function carregar() {
    lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:120px' }));
    const data = await get('/users');

    lista.replaceChildren(dataList({
      rows: data.rows,
      empty: 'Nenhum usuário.',
      columns: [
        { label: 'Nome', cell: (u) => h('div', {}, h('strong', {}, u.name), h('small', { class: 'd-block txt-secondary' }, u.email)) },
        { label: 'Perfil', cell: (u) => u.roleLabel },
        { label: 'Filial', cell: (u) => u.branch },
        { label: 'Último acesso', cell: (u) => (u.lastLoginAt ? fmtDateTime(u.lastLoginAt.replace('T', ' ')) : 'nunca') },
        {
          label: 'Situação',
          cell: (u) => h('span', { class: `badge text-bg-${u.active ? 'success' : 'danger'}` }, u.active ? 'Ativo' : 'Bloqueado'),
        },
        {
          label: '', className: 'text-end',
          cell: (u) => h('div', { class: 'd-flex gap-2 justify-content-end' },
            h('button', { class: 'btn btn-sm btn-outline-secondary', onclick: () => formularioUsuario(u) }, 'Editar'),
            u.role !== 'proprietario' ? h('button', {
              class: 'btn btn-sm btn-outline-danger', 'aria-label': `Excluir ${u.name}`,
              onclick: async () => {
                if (!(await confirmAction(`Excluir ${u.name}? O histórico de vendas continua registrado.`))) return;
                try {
                  await del(`/users/${u.id}`);
                  toast('Usuário excluído.');
                  carregar();
                } catch (e) { toast(e.message, 'error'); }
              },
            }, icon('trash-2', 14)) : null),
        },
      ],
    }));

    convites.replaceChildren(data.invites.length
      ? h('div', { class: 'list-group' }, data.invites.map((i) => h('div', {
          class: 'list-group-item d-flex justify-content-between align-items-center gap-2',
        },
          h('span', {}, h('strong', {}, i.email), h('small', { class: 'd-block txt-secondary' }, `perfil ${i.role}`)),
          h('span', { class: 'd-flex gap-2' },
            h('button', {
              class: 'btn btn-sm btn-outline-secondary',
              onclick: () => navigator.clipboard?.writeText(`${location.origin}/aceitar-convite.html?token=${i.token}`)
                .then(() => toast('Link copiado.')),
            }, 'Copiar link'),
            h('button', {
              class: 'btn btn-sm btn-outline-danger',
              onclick: async () => { await del(`/users/invite/${i.id}`); toast('Convite removido.'); carregar(); },
            }, '×')))))
      : h('p', { class: 'txt-secondary mb-0' }, 'Nenhum convite pendente.'));
    refreshIcons(content);
  }

  await carregar();
}
