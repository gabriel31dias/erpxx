// Notas fiscais: lista de documentos emitidos (NFC-e/NF-e) e a configuração
// fiscal (dados da empresa + provedor de API). Consome /api/fiscal/*.
// A emissão em si sai da tela da venda (venda.html).
import { get, patch, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { card, confirmAction, dataList, field, h, icon, input, modal, mount, paginator, refreshIcons, select, toast } from '../ui.js';

const PROVEDORES = [
  ['', 'Selecione…'], ['stub', 'Simulação (homologação, para testes)'],
  ['focusnfe', 'Focus NFe'], ['nfeio', 'NFe.io'], ['plugnotas', 'PlugNotas'],
  ['webmania', 'Webmania'], ['enotas', 'eNotas'], ['tecnospeed', 'Tecnospeed'],
];
const STATUS = {
  draft: ['secondary', 'rascunho'], processing: ['info', 'processando'], authorized: ['success', 'autorizada'],
  rejected: ['danger', 'rejeitada'], cancelled: ['dark', 'cancelada'], error: ['danger', 'erro'],
};
const badge = (s) => { const [c, l] = STATUS[s] || ['secondary', s]; return h('span', { class: `badge text-bg-${c}` }, l); };

export default async function render({ content, can }) {
  const params = new URLSearchParams(location.search);
  const podeConfig = can('empresa.gerenciar');
  const ABAS = [{ key: 'emitidas', label: 'Emitidas' }];
  if (podeConfig) ABAS.push({ key: 'config', label: 'Configuração' });
  const aba = ABAS.some((a) => a.key === params.get('tab')) ? params.get('tab') : 'emitidas';

  const corpo = h('div', {});
  const abas = h('ul', { class: 'nav nav-tabs mb-3' }, ABAS.map((a) => h('li', { class: 'nav-item' },
    h('a', { class: `nav-link${a.key === aba ? ' active' : ''}`, href: `/notas.html?tab=${a.key}` }, a.label))));
  mount(content, pageTitle('Notas fiscais'), card(null, h('div', {}, abas, corpo)));

  if (aba === 'config') await configTab(); else await emitidas();

  // ---------------- Emitidas ----------------
  async function emitidas() {
    const tipo = select([['', 'Todos os tipos'], ['nfce', 'NFC-e'], ['nfe', 'NF-e']].map(([v, l]) => ({ value: v, label: l })), { class: 'form-select' });
    const sit = select([['', 'Todas as situações'], ...Object.entries(STATUS).map(([k, v]) => [k, v[1]])].map((o) => Array.isArray(o) && o.length === 2 && typeof o[1] === 'string' ? { value: o[0], label: o[1] } : { value: o[0], label: o[1] }), { class: 'form-select' });
    const lista = h('div', {});
    const rodape = h('div', {});
    const state = { page: 1, pageSize: 20, type: '', status: '' };
    tipo.onchange = () => { state.type = tipo.value; state.page = 1; carregar(); };
    sit.onchange = () => { state.status = sit.value; state.page = 1; carregar(); };
    corpo.replaceChildren(
      h('div', { class: 'row g-2 mb-3' },
        h('div', { class: 'col-6 col-md-3' }, tipo), h('div', { class: 'col-6 col-md-3' }, sit)),
      lista, rodape);

    async function carregar() {
      lista.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:160px' }));
      const data = await get('/fiscal/documents', state);
      lista.replaceChildren(dataList({
        rows: data.rows,
        empty: 'Nenhuma nota emitida ainda. Emita a partir de uma venda.',
        columns: [
          { label: 'Emissão', cell: (d) => new Date(d.createdAt).toLocaleString('pt-BR') },
          { label: 'Tipo', cell: (d) => (d.type || '').toUpperCase() },
          { label: 'Nº / Série', cell: (d) => d.number ? `${d.number}/${d.serie}` : '—' },
          { label: 'Venda', cell: (d) => d.sale ? `#${d.sale.number}` : '—' },
          { label: 'Situação', cell: (d) => h('div', {}, badge(d.status),
            d.rejectionReason ? h('small', { class: 'd-block text-danger' }, d.rejectionReason) : null) },
          { label: 'Chave', cell: (d) => d.accessKey ? h('small', { class: 'txt-secondary' }, d.accessKey) : '—' },
          { label: '', className: 'text-end', cell: (d) => h('button', { class: 'btn btn-sm btn-outline-secondary', onclick: () => detalhe(d) }, 'Ver') },
        ],
      }));
      rodape.replaceChildren(paginator(data, (p) => { state.page = p; carregar(); }));
      refreshIcons(content);
    }
    await carregar();

    function detalhe(d) {
      const linhas = [
        ['Situação', STATUS[d.status]?.[1] || d.status], ['Tipo', (d.type || '').toUpperCase()],
        ['Número', d.number ? `${d.number} / série ${d.serie}` : '—'], ['Ambiente', d.environment],
        ['Chave de acesso', d.accessKey || '—'], ['Protocolo', d.protocol || '—'],
        ['Provedor', d.provider || '—'], d.rejectionReason ? ['Motivo', d.rejectionReason] : null,
        d.cancelReason ? ['Cancelamento', d.cancelReason] : null,
      ].filter(Boolean);
      const acoes = [];
      if (d.danfeUrl) acoes.push(h('a', { class: 'btn btn-outline-primary', href: d.danfeUrl, target: '_blank' }, 'DANFE'));
      if (d.xmlUrl) acoes.push(h('a', { class: 'btn btn-outline-secondary', href: d.xmlUrl, target: '_blank' }, 'XML'));
      if (d.status === 'authorized' && can('pdv.acessar')) acoes.push(h('button', { class: 'btn btn-outline-danger', onclick: () => cancelar(d, m) }, 'Cancelar nota'));
      const m = modal({
        title: `Nota ${d.number ? '#' + d.number : ''}`,
        body: h('div', {}, h('table', { class: 'table table-sm mb-2' }, h('tbody', {},
          linhas.map(([k, v]) => h('tr', {}, h('th', { style: 'width:150px' }, k), h('td', { class: 'text-break' }, String(v)))))),
          d.qrcode ? h('p', { class: 'small text-break' }, h('strong', {}, 'QR Code NFC-e: '), d.qrcode) : null),
        footer: acoes.length ? acoes : [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Fechar')],
      });
    }
    async function cancelar(d, m) {
      const motivo = input({ placeholder: 'Justificativa (mín. 15 caracteres)' });
      const ok = h('button', { class: 'btn btn-danger' }, 'Confirmar cancelamento');
      const cm = modal({ title: 'Cancelar nota', body: field('Motivo', motivo, { col: 'col-12' }), footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Voltar'), ok] });
      ok.onclick = async () => { try { await post(`/fiscal/documents/${d.id}/cancel`, { reason: motivo.value.trim() }); cm.close(); m.close(); toast('Nota cancelada.'); carregar(); } catch (e) { toast(e.message, 'error'); } };
    }
  }

  // ---------------- Configuração ----------------
  async function configTab() {
    corpo.replaceChildren(h('div', { class: 'lf-skeleton', style: 'height:280px' }));
    const cfg = await get('/fiscal/config');
    const e = cfg.empresa || {};
    const check = (checked) => h('input', { type: 'checkbox', class: 'form-check-input', checked });
    const f = {
      enabled: check(cfg.fiscalEnabled),
      ie: input({ value: cfg.ie ?? '' }), im: input({ value: cfg.im ?? '' }),
      crt: select([['1', '1 - Simples Nacional'], ['2', '2 - Simples (excesso)'], ['3', '3 - Regime normal']].map(([v, l]) => ({ value: v, label: l, selected: v === (cfg.crt ?? '1') })), { class: 'form-select' }),
      cnae: input({ value: cfg.cnae ?? '' }),
      provider: select(PROVEDORES.map(([v, l]) => ({ value: v, label: l, selected: v === (cfg.fiscalProvider ?? '') })), { class: 'form-select' }),
      env: select([['homologacao', 'Homologação (teste)'], ['producao', 'Produção']].map(([v, l]) => ({ value: v, label: l, selected: v === (cfg.fiscalEnv ?? 'homologacao') })), { class: 'form-select' }),
      token: input({ type: 'password', autocomplete: 'off', placeholder: cfg.tokenConfigured ? '•••••••• (salvo — deixe em branco para manter)' : 'Token / API key do provedor' }),
      nfceSerie: input({ type: 'number', min: '1', value: String(cfg.nfceSerie ?? 1) }),
      nfceProx: input({ type: 'number', min: '1', value: String(cfg.nfceProx ?? 1) }),
      cscId: input({ value: cfg.cscId ?? '' }),
      csc: input({ type: 'password', autocomplete: 'off', placeholder: cfg.cscConfigured ? '•••••••• (salvo)' : 'CSC (token NFC-e)' }),
    };
    const linha = (campo, titulo, desc) => h('div', { class: 'col-12' }, h('div', { class: 'form-check' }, campo, h('label', { class: 'form-check-label' }, h('strong', {}, titulo), h('small', { class: 'd-block txt-secondary' }, desc))));

    // checklist do que falta para emitir
    const req = [
      ['CNPJ da empresa', !!e.document], ['Cidade/UF', !!(e.city && e.state)], ['Inscrição Estadual', !!cfg.ie],
      ['Provedor selecionado', !!cfg.fiscalProvider], ['Token do provedor', cfg.tokenConfigured],
    ];
    const checklist = card('O que falta para emitir', h('ul', { class: 'list-group list-group-flush' },
      req.map(([nome, ok]) => h('li', { class: 'list-group-item d-flex justify-content-between align-items-center px-0' },
        h('span', {}, nome), h('span', { class: `badge text-bg-${ok ? 'success' : 'secondary'}` }, ok ? 'ok' : 'pendente'))),
      h('li', { class: 'list-group-item px-0' }, e.document ? null : h('a', { href: '/empresa.html' }, 'Completar dados da empresa (CNPJ, endereço) →'))));

    const salvar = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar configuração');
    const form = h('form', { class: 'row g-3' },
      linha(f.enabled, 'Habilitar emissão de notas', 'Permite emitir NFC-e/NF-e a partir das vendas.'),
      field('Provedor de NF-e', f.provider, { col: 'col-12 col-md-6', help: 'Envie o certificado A1 no painel do provedor.' }),
      field('Ambiente', f.env, { col: 'col-6 col-md-3' }),
      field('Token / API key', f.token, { col: 'col-12 col-md-6', help: 'Guardado só no servidor.' }),
      field('CSC ID (NFC-e)', f.cscId, { col: 'col-6 col-md-3' }),
      field('CSC (token NFC-e)', f.csc, { col: 'col-6 col-md-3' }),
      h('div', { class: 'col-12' }, h('hr', {}), h('h6', { class: 'txt-primary mb-0' }, 'Dados fiscais da empresa')),
      field('Inscrição Estadual', f.ie, { col: 'col-6 col-md-3' }),
      field('Inscrição Municipal', f.im, { col: 'col-6 col-md-3' }),
      field('Regime tributário (CRT)', f.crt, { col: 'col-6 col-md-3' }),
      field('CNAE', f.cnae, { col: 'col-6 col-md-3' }),
      field('Série da NFC-e', f.nfceSerie, { col: 'col-6 col-md-3' }),
      field('Próximo nº da NFC-e', f.nfceProx, { col: 'col-6 col-md-3' }),
      h('div', { class: 'col-12 text-end' }, salvar));

    form.onsubmit = async (ev) => {
      ev.preventDefault();
      salvar.disabled = true;
      try {
        const body = {
          fiscalEnabled: f.enabled.checked, fiscalProvider: f.provider.value || undefined,
          fiscalEnv: f.env.value, ie: f.ie.value.trim(), im: f.im.value.trim(),
          crt: f.crt.value, cnae: f.cnae.value.trim(),
          nfceSerie: Number(f.nfceSerie.value) || 1, nfceProx: Number(f.nfceProx.value) || 1,
          cscId: f.cscId.value.trim(),
        };
        if (f.token.value.trim()) body.fiscalToken = f.token.value.trim();
        if (f.csc.value.trim()) body.csc = f.csc.value.trim();
        await patch('/fiscal/config', body);
        toast('Configuração salva.');
        configTab();
      } catch (err) { toast(err.message, 'error'); } finally { salvar.disabled = false; }
    };

    corpo.replaceChildren(h('div', { class: 'row' },
      h('div', { class: 'col-12 col-lg-8' }, form),
      h('div', { class: 'col-12 col-lg-4' }, checklist)));
    refreshIcons(content);
  }
}
