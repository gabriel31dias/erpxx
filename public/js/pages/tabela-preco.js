// Tabela de preço: regra geral + grade de preços fixos por produto, com margem na hora.
import { get, patch, put } from '../api.js';
import { pageTitle } from '../shell.js';
import {
  mount, card, centsToInput, debounce, field, fmtBRL, h, input, moneyToCents, parseQty, refreshIcons, select, toast,
} from '../ui.js';

/** Mesma conta do servidor (src/modules/pricing.ts → adjustedCents). */
const ajustado = (base, bp) => Math.max(0, Math.round((base * (10000 + bp)) / 10000));
const margem = (preco, custo) => (preco > 0 && custo > 0 ? ((preco - custo) / preco) * 100 : null);

export default async function render({ content, can }) {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { location.href = '/tabelas-preco.html'; return; }
  const editavel = can('tabela_preco.gerenciar');
  const data = await get(`/price-lists/${id}`);
  const t = data.list;

  // preço fixo digitado por produto (null = segue a regra geral)
  const fixo = new Map(data.rows.map((r) => [r.id, r.fixedPriceCents]));
  const original = new Map(fixo);

  const f = {
    name: input({ value: t.name, required: true, disabled: !editavel }),
    description: input({ value: t.description ?? '', disabled: !editavel }),
    adjust: input({ inputmode: 'decimal', value: String(t.adjustBp / 100).replace('.', ','), disabled: !editavel }),
    active: select([
      { value: 'true', label: 'Ativa', selected: t.active },
      { value: 'false', label: 'Inativa — clientes pagam o cadastro', selected: !t.active },
    ], { disabled: !editavel }),
  };
  const bp = () => Math.round(parseQty(f.adjust.value) * 100);
  f.adjust.oninput = () => desenhar();

  // ---------- filtros e ações em massa ----------
  const busca = input({ type: 'search', class: 'form-control', placeholder: 'Produto, SKU ou código de barras' });
  busca.oninput = debounce(() => desenhar(), 200);
  const categorias = [...new Map(data.rows.filter((r) => r.category).map((r) => [r.category.id, r.category.name]))];
  const categoria = select([{ value: '', label: 'Todas as categorias' },
    ...categorias.map(([value, label]) => ({ value, label }))], { class: 'form-select' });
  categoria.onchange = () => desenhar();
  const soFixos = select([
    { value: '', label: 'Todos os produtos' }, { value: 'fixo', label: 'Só com preço fixo' },
    { value: 'abaixo', label: 'Abaixo do custo' },
  ], { class: 'form-select' });
  soFixos.onchange = () => desenhar();

  const filtrados = () => {
    const q = busca.value.trim().toLowerCase();
    return data.rows.filter((r) =>
      (!q || [r.name, r.sku, r.barcode].some((v) => v && v.toLowerCase().includes(q)))
      && (!categoria.value || r.category?.id === categoria.value)
      && (soFixos.value !== 'fixo' || fixo.get(r.id) !== null)
      && (soFixos.value !== 'abaixo' || (r.costCents > 0 && precoDe(r) < r.costCents)));
  };
  const precoDe = (r) => fixo.get(r.id) ?? ajustado(r.priceCents, bp());

  const pctMassa = input({ inputmode: 'decimal', class: 'form-control', placeholder: '−10', style: 'max-width:90px' });
  const aplicar = h('button', { class: 'btn btn-outline-primary', type: 'button' }, 'Fixar % nos filtrados');
  aplicar.onclick = () => {
    const pct = Math.round(parseQty(pctMassa.value) * 100);
    const rows = filtrados();
    rows.forEach((r) => fixo.set(r.id, ajustado(r.priceCents, pct)));
    toast(`Preço fixo em ${rows.length} produto(s). Confira e salve.`);
    desenhar();
  };
  const limparMassa = h('button', { class: 'btn btn-outline-secondary', type: 'button' }, 'Voltar filtrados à regra geral');
  limparMassa.onclick = () => { filtrados().forEach((r) => fixo.set(r.id, null)); desenhar(); };

  // ---------- grade ----------
  const corpo = h('tbody', {});
  const resumo = h('div', { class: 'f-12 txt-secondary' });
  const alterados = () => [...fixo].filter(([pid, v]) => original.get(pid) !== v);

  function linha(r) {
    const campo = input({
      class: 'form-control form-control-sm text-end', inputmode: 'decimal', style: 'max-width:120px;margin-left:auto',
      value: fixo.get(r.id) === null ? '' : centsToInput(fixo.get(r.id)),
      placeholder: centsToInput(ajustado(r.priceCents, bp())), disabled: !editavel,
      'aria-label': `Preço fixo de ${r.name}`,
    });
    const preco = h('td', { class: 'text-end f-w-600' });
    const mg = h('td', { class: 'text-end' });
    const atualizar = () => {
      const p = precoDe(r);
      preco.textContent = fmtBRL(p);
      const m = margem(p, r.costCents);
      mg.replaceChildren(m === null ? '—' : h('span', { class: m < 0 ? 'text-danger f-w-600' : '' },
        `${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`));
      resumo.textContent = alterados().length ? `${alterados().length} preço(s) alterado(s) — não esquecer de salvar.` : '';
    };
    campo.oninput = () => { fixo.set(r.id, campo.value.trim() === '' ? null : moneyToCents(campo.value)); atualizar(); };
    campo.onblur = () => { if (campo.value.trim() !== '') campo.value = centsToInput(moneyToCents(campo.value)); };
    atualizar();
    return h('tr', {},
      h('td', {}, h('div', { class: 'f-w-600' }, r.name),
        h('small', { class: 'txt-secondary' }, [r.sku, r.category?.name].filter(Boolean).join(' · '))),
      h('td', { class: 'text-end' }, fmtBRL(r.costCents)),
      h('td', { class: 'text-end' }, fmtBRL(r.priceCents)),
      h('td', { class: 'text-end' }, campo),
      preco, mg);
  }

  function desenhar() {
    const rows = filtrados();
    corpo.replaceChildren(...(rows.length ? rows.map(linha)
      : [h('tr', {}, h('td', { colspan: 6, class: 'text-center txt-secondary py-4' }, 'Nenhum produto neste filtro.'))]));
  }

  const salvar = h('button', { class: 'btn btn-primary' }, 'Salvar tabela');
  salvar.onclick = async () => {
    salvar.disabled = true;
    try {
      await patch(`/price-lists/${id}`, {
        name: f.name.value.trim(), description: f.description.value.trim() || undefined,
        adjustBp: bp(), active: f.active.value === 'true',
      });
      const items = alterados().map(([productId, priceCents]) => ({ productId, priceCents }));
      if (items.length) await put(`/price-lists/${id}/items`, { items });
      items.forEach((i) => original.set(i.productId, i.priceCents));
      pageTitle(f.name.value.trim());
      toast(items.length ? `Tabela salva · ${items.length} preço(s) atualizado(s).` : 'Tabela salva.');
      desenhar();
    } catch (e) { toast(e.message, 'error'); } finally { salvar.disabled = false; }
  };

  const clientes = card(`Clientes nesta tabela (${data.customers.length})`, data.customers.length
    ? h('div', { class: 'd-flex flex-wrap gap-2' }, data.customers.map((c) =>
      h('a', { class: 'btn btn-sm btn-outline-secondary', href: `/cliente.html?id=${c.id}` }, c.name)))
    : h('p', { class: 'txt-secondary mb-0' }, 'Nenhum cliente ainda. Vincule na ficha do cliente, campo "Tabela de preço".'));

  mount(content,
    pageTitle(t.name, h('a', { class: 'btn btn-light', href: '/tabelas-preco.html' }, 'Voltar'), editavel ? salvar : null),
    card('Regra geral', h('div', { class: 'row g-3' },
      field('Nome', f.name, { col: 'col-12 col-md-4' }),
      field('Descrição', f.description, { col: 'col-12 col-md-4' }),
      field('Ajuste sobre o cadastro (%)', f.adjust, {
        col: 'col-6 col-md-2', help: 'Para produtos sem preço fixo. −10 = 10% abaixo.',
      }),
      field('Situação', f.active, { col: 'col-6 col-md-2' }))),
    card('Preços por produto', h('div', {},
      h('div', { class: 'row g-2 mb-3' },
        h('div', { class: 'col-12 col-md-5' }, busca),
        h('div', { class: 'col-6 col-md-4' }, categoria),
        h('div', { class: 'col-6 col-md-3' }, soFixos)),
      editavel ? h('div', { class: 'd-flex flex-wrap align-items-center gap-2 mb-3' },
        pctMassa, h('span', { class: 'txt-secondary' }, '% sobre o cadastro'), aplicar, limparMassa) : null,
      h('div', { class: 'table-responsive' }, h('table', { class: 'table table-sm align-middle mb-2' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Produto'), h('th', { class: 'text-end' }, 'Custo'), h('th', { class: 'text-end' }, 'Cadastro'),
          h('th', { class: 'text-end' }, 'Preço fixo'), h('th', { class: 'text-end' }, 'Na tabela'),
          h('th', { class: 'text-end' }, 'Margem'))),
        corpo)),
      h('div', { class: 'd-flex justify-content-between align-items-center gap-2 flex-wrap' },
        h('small', { class: 'txt-secondary' }, 'Preço fixo vazio = segue o ajuste da regra geral (valor sugerido em cinza).'),
        resumo))),
    clientes);
  desenhar();
  refreshIcons(content);
}
