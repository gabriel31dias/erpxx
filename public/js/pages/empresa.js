// Empresa: dados cadastrais, filiais, PDVs e formas de pagamento numa tela só.
import { del, get, patch, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount,
  card, centsToInput, confirmAction, dataList, field, h, icon, input, modal, refreshIcons, select,
  toast,
} from '../ui.js';

export default async function render({ content, can }) {
  if (!can('empresa.gerenciar')) return mount(content, card(null, 'Sem permissão.'));
  const empresa = await get('/company');

  const f = {
    name: input({ value: empresa.name ?? '' }),
    tradeName: input({ value: empresa.tradeName ?? '' }),
    document: input({ value: empresa.document ?? '' }),
    phone: input({ value: empresa.phone ?? '' }),
    whatsapp: input({ value: empresa.whatsapp ?? '' }),
    email: input({ value: empresa.email ?? '', type: 'email' }),
    zip: input({ value: empresa.zip ?? '' }),
    address: input({ value: empresa.address ?? '' }),
    number: input({ value: empresa.number ?? '' }),
    complement: input({ value: empresa.complement ?? '' }),
    district: input({ value: empresa.district ?? '' }),
    city: input({ value: empresa.city ?? '' }),
    state: input({ value: empresa.state ?? '', maxlength: '2' }),
    logoPath: input({ value: empresa.logoPath ?? '', placeholder: 'https://…' }),
    theme: select([
      { value: 'light', label: 'Claro', selected: empresa.theme === 'light' },
      { value: 'dark', label: 'Escuro', selected: empresa.theme === 'dark' },
    ]),
  };

  const salvar = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar dados');
  const form = h('form', { class: 'row g-3' },
    field('Razão social', f.name, { col: 'col-12 col-md-6' }),
    field('Nome fantasia', f.tradeName, { col: 'col-12 col-md-6' }),
    field('CNPJ/CPF', f.document, { col: 'col-6 col-md-3' }),
    field('Telefone', f.phone, { col: 'col-6 col-md-3' }),
    field('WhatsApp', f.whatsapp, { col: 'col-6 col-md-3' }),
    field('E-mail', f.email, { col: 'col-6 col-md-3' }),
    field('CEP', f.zip, { col: 'col-6 col-md-2' }),
    field('Endereço', f.address, { col: 'col-12 col-md-5' }),
    field('Número', f.number, { col: 'col-6 col-md-2' }),
    field('Complemento', f.complement, { col: 'col-6 col-md-3' }),
    field('Bairro', f.district, { col: 'col-6 col-md-4' }),
    field('Cidade', f.city, { col: 'col-6 col-md-4' }),
    field('UF', f.state, { col: 'col-6 col-md-2' }),
    field('Tema', f.theme, { col: 'col-6 col-md-2' }),
    field('Logo (URL)', f.logoPath, { col: 'col-12 col-md-6' }),
    h('div', { class: 'col-12 text-end' }, salvar));

  form.onsubmit = async (e) => {
    e.preventDefault();
    salvar.disabled = true;
    try {
      await patch('/company', Object.fromEntries(
        Object.entries(f).map(([k, el]) => [k, el.value.trim?.() ?? el.value])));
      toast('Dados salvos.');
    } catch (err) { toast(err.message, 'error'); } finally { salvar.disabled = false; }
  };

  // ---------- filiais ----------
  const filiais = h('div', {});
  function formularioFilial(row = {}) {
    const nome = input({ value: row.name ?? '' });
    const doc = input({ value: row.document ?? '' });
    const fone = input({ value: row.phone ?? '' });
    const end = input({ value: row.address ?? '' });
    const cidade = input({ value: row.city ?? '' });
    const uf = input({ value: row.state ?? '', maxlength: '2' });
    const ativo = select([
      { value: 'true', label: 'Ativa', selected: row.active !== false },
      { value: 'false', label: 'Inativa', selected: row.active === false },
    ]);
    const ok = h('button', { class: 'btn btn-primary' }, 'Salvar');
    const m = modal({
      title: row.id ? `Editar ${row.name}` : 'Nova filial',
      body: h('div', { class: 'row g-3' },
        field('Nome', nome, { col: 'col-12 col-md-6' }),
        field('CNPJ', doc, { col: 'col-6 col-md-6' }),
        field('Telefone', fone, { col: 'col-6 col-md-4' }),
        field('Endereço', end, { col: 'col-12 col-md-8' }),
        field('Cidade', cidade, { col: 'col-6 col-md-4' }),
        field('UF', uf, { col: 'col-3 col-md-2' }),
        field('Situação', ativo, { col: 'col-6 col-md-3' })),
      footer: [ok],
    });
    ok.onclick = async () => {
      try {
        const body = {
          name: nome.value.trim(), document: doc.value.trim() || undefined,
          phone: fone.value.trim() || undefined, address: end.value.trim() || undefined,
          city: cidade.value.trim() || undefined, state: uf.value.trim() || undefined,
          active: ativo.value === 'true',
        };
        row.id ? await patch(`/company/branches/${row.id}`, body) : await post('/company/branches', body);
        m.close();
        toast('Filial salva.');
        carregarFiliais();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  async function carregarFiliais() {
    const { rows } = await get('/company/branches');
    filiais.replaceChildren(dataList({
      rows,
      empty: 'Nenhuma filial.',
      columns: [
        { label: 'Nome', cell: (b) => h('div', {}, h('strong', {}, b.name), b.isMain ? h('span', { class: 'badge text-bg-light ms-2' }, 'principal') : null) },
        { label: 'Cidade', cell: (b) => [b.city, b.state].filter(Boolean).join('/') || '—' },
        { label: 'PDVs', className: 'text-end', cell: (b) => String(b.counts.registers) },
        { label: 'Usuários', className: 'text-end', cell: (b) => String(b.counts.users) },
        { label: 'Vendas', className: 'text-end', cell: (b) => String(b.counts.sales) },
        {
          label: 'Situação',
          cell: (b) => h('span', { class: `badge text-bg-${b.active ? 'success' : 'secondary'}` }, b.active ? 'Ativa' : 'Inativa'),
        },
        {
          label: '', className: 'text-end',
          cell: (b) => h('div', { class: 'd-flex gap-2 justify-content-end' },
            h('button', { class: 'btn btn-sm btn-outline-secondary', onclick: () => formularioFilial(b) }, 'Editar'),
            !b.isMain ? h('button', {
              class: 'btn btn-sm btn-outline-danger',
              onclick: async () => {
                if (!(await confirmAction(`Excluir a filial ${b.name}?`))) return;
                try { await del(`/company/branches/${b.id}`); toast('Filial excluída.'); carregarFiliais(); }
                catch (e) { toast(e.message, 'error'); }
              },
            }, icon('trash-2', 14)) : null),
        },
      ],
    }));
    refreshIcons(content);
  }

  // ---------- PDVs ----------
  const pdvs = h('div', {});
  async function carregarPdvs() {
    const [{ rows }, { rows: branches }] = await Promise.all([get('/cash/registers'), get('/company/branches')]);
    const novo = h('button', { class: 'btn btn-sm btn-primary' }, 'Novo PDV');
    novo.onclick = () => {
      const nome = input({ value: '' });
      const filial = select(branches.map((b) => ({ value: b.id, label: b.name })));
      const ok = h('button', { class: 'btn btn-primary' }, 'Criar');
      const m = modal({
        title: 'Novo PDV',
        body: h('div', { class: 'row g-3' }, field('Nome', nome, { col: 'col-12 col-md-6' }), field('Filial', filial, { col: 'col-12 col-md-6' })),
        footer: [ok],
      });
      ok.onclick = async () => {
        try {
          await post('/cash/registers', { name: nome.value.trim(), branchId: filial.value });
          m.close(); toast('PDV criado.'); carregarPdvs();
        } catch (e) { toast(e.message, 'error'); }
      };
    };

    pdvs.replaceChildren(
      h('div', { class: 'd-flex justify-content-end mb-2' }, novo),
      dataList({
        rows,
        empty: 'Nenhum PDV cadastrado.',
        columns: [
          { label: 'PDV', cell: (r) => h('strong', {}, r.name) },
          { label: 'Filial', cell: (r) => r.branch },
          {
            label: 'Situação',
            cell: (r) => h('span', { class: `badge text-bg-${r.openSession ? 'primary' : 'light'}` },
              r.openSession ? `aberto por ${r.openSession.operator ?? '—'}` : 'fechado'),
          },
          {
            label: '', className: 'text-end',
            cell: (r) => h('button', {
              class: 'btn btn-sm btn-outline-secondary',
              onclick: async () => {
                await patch(`/cash/registers/${r.id}`, { name: r.name, active: !r.active });
                toast(r.active ? 'PDV desativado.' : 'PDV ativado.');
                carregarPdvs();
              },
            }, r.active ? 'Desativar' : 'Ativar'),
          },
        ],
      }));
  }

  // ---------- formas de pagamento ----------
  const pagamentos = h('div', {});
  const TIPOS = ['dinheiro', 'pix', 'debito', 'credito', 'vale', 'crediario', 'outro'];

  function formularioPagamento(row = {}) {
    const nome = input({ value: row.name ?? '' });
    const tipo = select(TIPOS.map((t) => ({ value: t, label: t, selected: t === row.type })));
    const troco = h('input', { type: 'checkbox', class: 'form-check-input', checked: row.requiresChange ?? false });
    const parcela = h('input', { type: 'checkbox', class: 'form-check-input', checked: row.allowsInstallments ?? false });
    const maxParcelas = input({ type: 'number', min: '1', max: '24', value: String(row.maxInstallments ?? 1) });
    const taxa = input({ inputmode: 'decimal', value: String(row.feePct ?? 0) });
    const ativo = select([
      { value: 'true', label: 'Ativa', selected: row.active !== false },
      { value: 'false', label: 'Inativa', selected: row.active === false },
    ]);
    const ok = h('button', { class: 'btn btn-primary' }, 'Salvar');
    const m = modal({
      title: row.id ? `Editar ${row.name}` : 'Nova forma de pagamento',
      body: h('div', { class: 'row g-3' },
        field('Nome', nome, { col: 'col-12 col-md-6' }),
        field('Tipo', tipo, { col: 'col-6 col-md-3' }),
        field('Situação', ativo, { col: 'col-6 col-md-3' }),
        h('div', { class: 'col-12 col-md-6' },
          h('div', { class: 'form-check' }, troco, h('label', { class: 'form-check-label' }, 'Exige troco (dinheiro em espécie)')),
          h('div', { class: 'form-check' }, parcela, h('label', { class: 'form-check-label' }, 'Permite parcelamento'))),
        field('Máximo de parcelas', maxParcelas, { col: 'col-6 col-md-3' }),
        field('Taxa (%)', taxa, { col: 'col-6 col-md-3' })),
      footer: [ok],
    });
    ok.onclick = async () => {
      try {
        const body = {
          name: nome.value.trim(), type: tipo.value, active: ativo.value === 'true',
          requiresChange: troco.checked, allowsInstallments: parcela.checked,
          maxInstallments: Number(maxParcelas.value) || 1, feePct: Number(taxa.value.replace(',', '.')) || 0,
        };
        row.id ? await patch(`/company/payment-methods/${row.id}`, body) : await post('/company/payment-methods', body);
        m.close(); toast('Forma de pagamento salva.'); carregarPagamentos();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  async function carregarPagamentos() {
    const { rows } = await get('/company/payment-methods');
    const nova = h('button', { class: 'btn btn-sm btn-primary', onclick: () => formularioPagamento() }, 'Nova forma');
    pagamentos.replaceChildren(
      h('div', { class: 'd-flex justify-content-end mb-2' }, nova),
      dataList({
        rows,
        empty: 'Nenhuma forma de pagamento.',
        columns: [
          { label: 'Nome', cell: (m) => h('strong', {}, m.name) },
          { label: 'Tipo', cell: (m) => m.type },
          { label: 'Troco', cell: (m) => (m.requiresChange ? 'sim' : '—') },
          { label: 'Parcelas', cell: (m) => (m.allowsInstallments ? `até ${m.maxInstallments}x` : 'à vista') },
          { label: 'Taxa', className: 'text-end', cell: (m) => `${m.feePct}%` },
          {
            label: 'Situação',
            cell: (m) => h('span', { class: `badge text-bg-${m.active ? 'success' : 'secondary'}` }, m.active ? 'Ativa' : 'Inativa'),
          },
          {
            label: '', className: 'text-end',
            cell: (m) => h('div', { class: 'd-flex gap-2 justify-content-end' },
              h('button', { class: 'btn btn-sm btn-outline-secondary', onclick: () => formularioPagamento(m) }, 'Editar'),
              h('button', {
                class: 'btn btn-sm btn-outline-danger',
                onclick: async () => {
                  if (!(await confirmAction(`Remover ${m.name}?`))) return;
                  const r = await del(`/company/payment-methods/${m.id}`);
                  toast(r.deactivated ? 'Forma desativada (há vendas usando ela).' : 'Forma removida.');
                  carregarPagamentos();
                },
              }, icon('trash-2', 14))),
          },
        ],
      }));
    refreshIcons(content);
  }

  mount(content,
    pageTitle('Empresa e filiais',
      h('button', { class: 'btn btn-primary', onclick: () => formularioFilial() }, icon('plus', 16), ' Nova filial')),
    card('Dados da empresa', form),
    card('Filiais', filiais),
    card('PDVs (caixas)', pdvs),
    card('Formas de pagamento', pagamentos));

  await Promise.all([carregarFiliais(), carregarPdvs(), carregarPagamentos()]);
}
