// Helpers de interface: DOM, formatação pt-BR, modais, toasts e estados de tela.

/** h('div', {class:'x'}, 'texto', elFilho) — textos entram como texto, nunca como HTML (anti-XSS). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // só para ícones controlados por nós
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function icon(name, size = 18) {
  return h('i', { 'data-feather': name, style: `width:${size}px;height:${size}px` });
}

export function refreshIcons(root = document) {
  if (window.feather) window.feather.replace({ width: 18, height: 18 }, root);
}

// ---------- formatação ----------
export const fmtBRL = (cents) => ((cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtDate = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
export const fmtTime = (v) => (v ? String(v).slice(11, 16) : '');
export const fmtDateTime = (v) => (v ? `${fmtDate(v)} ${fmtTime(v)}` : '');
export const todayStr = () => new Date().toLocaleDateString('sv-SE');
export const nowStr = () => new Date().toLocaleString('sv-SE').slice(0, 16);

/** "1.234,56" ou "1234,56" -> 123456 centavos */
export function moneyToCents(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const clean = String(value).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  return Math.round((Number(clean) || 0) * 100);
}
export const centsToInput = (cents) => ((cents || 0) / 100).toFixed(2).replace('.', ',');

export function addMinutes(dt, min) {
  const [d, t] = dt.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const out = new Date(Date.UTC(y, mo - 1, da, hh, mm + min));
  const p = (n) => String(n).padStart(2, '0');
  return `${out.getUTCFullYear()}-${p(out.getUTCMonth() + 1)}-${p(out.getUTCDate())} ${p(out.getUTCHours())}:${p(out.getUTCMinutes())}`;
}

export const debounce = (fn, ms = 350) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

// ---------- feedback ----------
export function toast(message, type = 'success') {
  let box = $('#lf-toasts');
  if (!box) {
    box = h('div', { id: 'lf-toasts', class: 'position-fixed top-0 end-0 p-3', style: 'z-index:1090' });
    document.body.append(box);
  }
  const el = h('div', {
    class: `toast align-items-center text-bg-${type === 'error' ? 'danger' : type} border-0 show mb-2`,
    role: 'alert', 'aria-live': 'assertive',
  }, h('div', { class: 'd-flex' },
    h('div', { class: 'toast-body' }, message),
    h('button', { class: 'btn-close btn-close-white me-2 m-auto', 'aria-label': 'Fechar', onclick: () => el.remove() })));
  box.append(el);
  setTimeout(() => el.remove(), 5000);
}

/**
 * Modal do Bootstrap; devolve {el, close}.
 * `dismissible: false` = passo obrigatório: sem X, sem ESC, sem clique fora.
 */
export function modal({ title, body, footer, size = '', dismissible = true }) {
  const dialog = h('div', { class: `modal-dialog modal-dialog-centered modal-dialog-scrollable ${size}` },
    h('div', { class: 'modal-content' },
      h('div', { class: 'modal-header' },
        h('h5', { class: 'modal-title' }, title),
        dismissible
          ? h('button', { type: 'button', class: 'btn-close', 'data-bs-dismiss': 'modal', 'aria-label': 'Fechar' })
          : null),
      h('div', { class: 'modal-body' }, body),
      footer ? h('div', { class: 'modal-footer' }, footer) : null));

  const el = h('div', { class: 'modal fade', tabindex: '-1' }, dialog);
  document.body.append(el);
  const instance = new bootstrap.Modal(el, dismissible ? {} : { backdrop: 'static', keyboard: false });
  el.addEventListener('hidden.bs.modal', () => el.remove());
  instance.show();
  refreshIcons(el);
  return { el, close: () => instance.hide() };
}

/** Confirmação antes de ação destrutiva. */
export function confirmAction(message, { title = 'Confirmar', okLabel = 'Confirmar', danger = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const ok = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, okLabel);
    const m = modal({
      title,
      body: h('p', { class: 'mb-0' }, message),
      footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Cancelar'), ok],
    });
    ok.onclick = () => { finish(true); m.close(); };
    m.el.addEventListener('hidden.bs.modal', () => finish(false));
  });
}

/** Pede o motivo (atalhos + texto livre). Resolve com o texto, ou null se desistir. */
export function askReason(title, { quick = [], okLabel = 'Confirmar' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const texto = h('input', { type: 'text', class: 'form-control', maxlength: 200, placeholder: 'Motivo', 'aria-label': 'Motivo' });
    const ok = h('button', { class: 'btn btn-danger' }, okLabel);
    const m = modal({
      title,
      body: h('div', {},
        quick.length ? h('div', { class: 'd-flex flex-wrap gap-2 mb-3' }, quick.map((q) =>
          h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', onclick: () => { texto.value = q; texto.focus(); } }, q))) : null,
        texto),
      footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Voltar'), ok],
    });
    ok.onclick = () => {
      if (texto.value.trim().length < 3) { texto.classList.add('is-invalid'); texto.focus(); return; }
      finish(texto.value.trim());
      m.close();
    };
    m.el.addEventListener('shown.bs.modal', () => texto.focus());
    m.el.addEventListener('hidden.bs.modal', () => finish(null));
  });
}

// ---------- estados de tela ----------
export function emptyState(message, action) {
  return h('div', { class: 'lf-empty' }, icon('inbox', 40), h('p', { class: 'mt-2 mb-3' }, message), action || null);
}

/** Linhas de esqueleto para tabelas em carregamento. */
export function loadingRows(cols = 4, rows = 5) {
  return Array.from({ length: rows }, () =>
    h('tr', {}, Array.from({ length: cols }, () => h('td', {}, h('div', { class: 'lf-skeleton' })))));
}

export function badge(text, color) {
  return h('span', { class: 'lf-badge', style: `background:${color}` }, text);
}

export function paginator({ total, page, pageSize }, onGo) {
  const pages = Math.ceil(total / pageSize) || 1;
  if (pages <= 1) return h('div', { class: 'text-muted small p-2' }, `${total} registro(s)`);
  const btn = (label, target, disabled, active) =>
    h('li', { class: `page-item ${disabled ? 'disabled' : ''} ${active ? 'active' : ''}` },
      h('button', { class: 'page-link', onclick: () => !disabled && onGo(target) }, label));
  const items = [btn('‹', page - 1, page <= 1)];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p++) items.push(btn(String(p), p, false, p === page));
  items.push(btn('›', page + 1, page >= pages));
  return h('div', { class: 'd-flex justify-content-between align-items-center flex-wrap gap-2 p-2' },
    h('span', { class: 'text-muted small' }, `${total} registro(s) · página ${page} de ${pages}`),
    h('nav', { 'aria-label': 'Paginação' }, h('ul', { class: 'pagination pagination-sm mb-0' }, items)));
}

/** Campo de formulário rotulado (label sempre presente, por acessibilidade). */
export function field(label, input, { help, col = 'col-12 col-md-6' } = {}) {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  if (!input.classList.contains('form-check-input')) {
    input.classList.add(input.tagName === 'SELECT' ? 'form-select' : 'form-control');
  }
  return h('div', { class: col },
    h('label', { class: 'form-label', for: id }, label),
    input,
    help ? h('div', { class: 'form-text' }, help) : null);
}

export const input = (attrs = {}) => h('input', { type: 'text', ...attrs });
export const select = (options, attrs = {}) => h('select', attrs,
  options.map((o) => h('option', { value: o.value, selected: o.selected }, o.label)));
export const textarea = (attrs = {}) => h('textarea', { rows: 3, ...attrs });

export function card(title, content, actions) {
  return h('div', { class: 'card' },
    title ? h('div', { class: 'card-header d-flex justify-content-between align-items-center gap-2 flex-wrap' },
      h('h5', { class: 'mb-0' }, title), actions || null) : null,
    h('div', { class: 'card-body' }, content));
}

/**
 * Lista responsiva a partir de uma única definição de colunas:
 * tabela no desktop, cards no celular.
 */
export function dataList({
  columns, rows, empty = 'Nenhum registro encontrado.', emptyAction, card, exportName, fetchPage, exportRows,
}) {
  if (!rows.length) return emptyState(empty, emptyAction);

  const table = h('div', { class: 'table-responsive d-none d-md-block' },
    h('table', { class: 'table align-middle mb-0' },
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.className || '' }, c.label)))),
      h('tbody', {}, rows.map((r) =>
        h('tr', {}, columns.map((c) => h('td', { class: c.className || '' }, c.cell(r))))))));

  const cards = h('div', { class: 'd-md-none d-grid gap-2' }, rows.map((r) =>
    h('div', { class: 'card mb-0 lf-card-item' }, h('div', { class: 'card-body p-3' },
      card ? card(r) : defaultCard(columns, r)))));

  // exporta as colunas com rótulo; com fetchPage, todas as páginas do filtro atual
  const todas = fetchPage ? () => allPages(fetchPage) : exportRows ? async () => exportRows : async () => rows;
  return h('div', {}, exportBar(columns, todas, exportName), table, cards);
}

// ---------- exportação CSV / XML ----------
// a casca (shell.js) liga a regra de permissão/plano; devolve a mensagem de bloqueio ou null
let exportBlock = () => null;
export const setExportGate = (fn) => { exportBlock = fn; };

/** busca página a página (a API devolve no máximo 100 por vez) até completar o total */
export async function allPages(fetchPage) {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await fetchPage(page, 100);
    out.push(...r.rows);
    if (!r.rows.length || out.length >= r.total) return out;
  }
}

/** texto do que a célula mostra: selos, links e campos (valor); botões e ícones ficam de fora */
function cellText(v) {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(cellText).filter(Boolean).join(' ');
  if (!(v instanceof Node)) return String(v);
  if (v.nodeType === Node.TEXT_NODE) return v.textContent;
  if (v.nodeType !== Node.ELEMENT_NODE) return '';
  const tag = v.tagName;
  if (tag === 'BUTTON' || tag === 'svg' || tag === 'SCRIPT') return '';
  if (tag === 'SELECT') return v.selectedOptions[0]?.textContent ?? '';
  if (tag === 'INPUT') return v.type === 'checkbox' || v.type === 'radio' ? (v.checked ? 'Sim' : 'Não') : v.value;
  if (tag === 'TEXTAREA') return v.value;
  return [...v.childNodes].map(cellText).filter((t) => t.trim()).join(' ');
}
const limpa = (t) => t.replace(/\s+/g, ' ').trim();

/** nome do arquivo: título da tela + data */
function arquivo(nome, ext) {
  const base = (nome || document.getElementById('lf-title')?.textContent || document.title || 'registros')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${base || 'registros'}-${todayStr()}.${ext}`;
}

function baixar(conteudo, nome, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = h('a', { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV no padrão do Excel brasileiro: ponto e vírgula e BOM para os acentos */
export function toCsv(headers, linhas) {
  // célula que começa como fórmula (=, +, @, -texto) vira texto no Excel: nome vindo do cardápio público entra aqui
  const seguro = (t) => (/^[=+@\t\r]|^-(?![\d\s]|R\$)/.test(t) ? `'${t}` : t);
  const q = (t) => { const v = seguro(t); return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return `\ufeff${[headers, ...linhas].map((l) => l.map(q).join(';')).join('\r\n')}\r\n`;
}

/** XML: <registros><registro><campo>…; o nome da tag vem do rótulo da coluna */
export function toXml(headers, linhas) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // caracteres de controle não valem em XML 1.0
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const usadas = new Map();
  const tags = headers.map((l) => {
    let t = l.replace(/^n[º°]/i, 'numero').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'campo';
    if (/^(\d|xml)/.test(t)) t = `c_${t}`;
    const n = (usadas.get(t) ?? 0) + 1;
    usadas.set(t, n);
    return n > 1 ? `${t}_${n}` : t;
  });
  const corpo = linhas.map((l) => `  <registro>\n${l.map((v, i) => `    <${tags[i]}>${esc(v)}</${tags[i]}>`).join('\n')}\n  </registro>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<registros>\n${corpo.join('\n')}${corpo.length ? '\n' : ''}</registros>\n`;
}

/** exporta linhas já montadas (cabeçalho + valores em texto) no formato pedido */
export function baixarExportacao(formato, headers, linhas, nome) {
  if (formato === 'csv') baixar(toCsv(headers, linhas), arquivo(nome, 'csv'), 'text/csv;charset=utf-8');
  else baixar(toXml(headers, linhas), arquivo(nome, 'xml'), 'application/xml;charset=utf-8');
}

/** botões "CSV" e "XML" que exportam as colunas rotuladas das linhas que `getRows` devolver */
export function exportBar(columns, getRows, nome) {
  const cols = columns.filter((c) => c.label);
  const ir = async (formato, btn) => {
    const bloqueio = exportBlock();
    if (bloqueio) return toast(bloqueio, 'warning');
    btn.disabled = true;
    try {
      const rows = await getRows();
      const linhas = rows.map((r) => cols.map((c) => limpa(cellText(c.exportValue ? c.exportValue(r) : c.cell(r)))));
      baixarExportacao(formato, cols.map((c) => c.label), linhas, nome);
      toast(`${rows.length} registro(s) exportado(s) em ${formato.toUpperCase()}.`);
    } catch (e) {
      toast(e.message || 'Não foi possível exportar.', 'error');
    } finally {
      btn.disabled = false;
    }
  };
  const botao = (formato) => {
    const b = h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', title: `Exportar em ${formato.toUpperCase()}` },
      icon('download', 14), ` ${formato.toUpperCase()}`);
    b.onclick = () => ir(formato, b);
    return b;
  };
  return h('div', { class: 'lf-export d-flex justify-content-end align-items-center gap-1 mb-2' },
    h('span', { class: 'f-12 txt-secondary me-1' }, 'Exportar'), botao('csv'), botao('xml'));
}

/** Card padrão: primeira coluna vira título, as demais viram linhas rótulo/valor. */
function defaultCard(columns, row) {
  const [first, ...rest] = columns;
  return h('div', {},
    h('div', { class: 'f-w-600 mb-2' }, first.cell(row)),
    rest.filter((c) => c.label).map((c) => h('div', { class: 'd-flex justify-content-between gap-2 py-1 border-top' },
      h('span', { class: 'f-12 txt-secondary' }, c.label),
      h('span', { class: 'text-end' }, c.cell(row)))),
    ...rest.filter((c) => !c.label).map((c) => h('div', { class: 'pt-2 text-end' }, c.cell(row))));
}

// ---------- extras do ERP ----------
/** Quantidade: inteiro some as casas, peso mostra até 3 decimais. */
export const fmtQty = (n, unit = '') => {
  const value = Number(n || 0);
  const text = Number.isInteger(value) ? String(value) : value.toFixed(3).replace('.', ',').replace(/0+$/, '').replace(/,$/, '');
  return unit ? `${text} ${unit}` : text;
};

/** "1,5" / "1.5" -> 1.5 (aceita o que o operador digitar). */
export const parseQty = (value) => {
  if (value === '' || value === null || value === undefined) return 0;
  const clean = String(value).replace(/[^\d,.-]/g, '');
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  return Number(normalized) || 0;
};

/** Campo de dinheiro em reais que devolve centavos no submit. */
export function moneyInput(attrs = {}) {
  const el = input({ inputmode: 'decimal', placeholder: '0,00', ...attrs });
  el.addEventListener('blur', () => { el.value = centsToInput(moneyToCents(el.value)); });
  return el;
}

export const statusBadge = (label, kind) =>
  h('span', { class: `badge text-bg-${kind}` }, label);

/** Card de indicador do dashboard. */
export function statCard(label, value, { hint, iconName = 'trending-up', color = '#7366ff', col = 'col-6 col-xl-3' } = {}) {
  // coluna flex + card w-100: todos os cards da linha com a mesma altura; a linha
  // de detalhe existe sempre (vazia quando não há) para linhas diferentes também baterem
  return h('div', { class: `${col} d-flex` },
    h('div', { class: 'card mb-3 w-100 lf-stat' }, h('div', { class: 'card-body p-3 d-flex align-items-center gap-3' },
      h('div', { class: 'lf-stat-icon', style: `background:${color}1f;color:${color}` }, icon(iconName, 18)),
      h('div', { class: 'flex-grow-1 min-w-0' },
        h('div', { class: 'lf-stat-label' }, label),
        h('div', { class: 'lf-stat-value' }, value),
        h('div', { class: 'lf-stat-hint' }, hint || '\u00a0')))));
}

/** Gráfico do ApexCharts com fallback quando a lib não carregou (offline). */
export function chart(node, options) {
  if (!window.ApexCharts) {
    node.replaceChildren(h('div', { class: 'txt-secondary f-12 p-3' }, 'Gráfico indisponível offline.'));
    return null;
  }
  node.replaceChildren();
  node.classList.add('lf-chart');
  // largura sempre a do card: o Apex mede o pai uma vez só e, se o menu lateral
  // abre/fecha ou a tela muda, o SVG ficava maior que o card e vazava
  const instance = new ApexCharts(node, { ...options, chart: { width: '100%', redrawOnParentResize: true, ...options.chart } });
  instance.render();
  if (window.ResizeObserver) {
    let largura = node.clientWidth;
    let timer;
    new ResizeObserver(() => {
      if (!node.isConnected || node.clientWidth === largura) return;
      largura = node.clientWidth;
      clearTimeout(timer);
      timer = setTimeout(() => instance.updateOptions({ chart: { width: '100%' } }, false, false), 120);
    }).observe(node);
  }
  return instance;
}

/**
 * replaceChildren converte `null` em texto "null" na tela — este monta só o que
 * existe. Usado pelas telas onde parte do conteúdo depende de permissão/dados.
 */
export function mount(root, ...children) {
  root.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return root;
}
