// Importação de produtos por CSV/Excel(csv): mapeia colunas, valida e só então grava.
import { post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, card, fmtBRL, fmtQty, h, refreshIcons, select, toast } from '../ui.js';

export default async function render({ content, can, branchId }) {
  if (!can('produto.importar')) return mount(content, card(null, 'Sem permissão para importar.'));

  let csv = '';
  let previa = null;
  const mapeamento = {};

  const arquivo = h('input', { type: 'file', class: 'form-control', accept: '.csv,text/csv,text/plain' });
  const area = h('textarea', {
    class: 'form-control', rows: 6,
    placeholder: 'Ou cole aqui o conteúdo da planilha (separado por ; ou ,)',
  });
  const analisar = h('button', { class: 'btn btn-primary' }, 'Analisar planilha');
  const resultado = h('div', {});

  arquivo.onchange = async () => {
    const file = arquivo.files?.[0];
    if (!file) return;
    csv = await file.text();
    area.value = csv.split('\n').slice(0, 10).join('\n');
    toast(`Arquivo lido: ${file.name}`);
  };

  analisar.onclick = async () => {
    const conteudo = csv || area.value;
    if (!conteudo.trim()) return toast('Escolha um arquivo ou cole o conteúdo.', 'warning');
    try {
      previa = await post('/imports/products/preview', { csv: conteudo });
      desenharPrevia(conteudo);
    } catch (e) { toast(e.message, 'error'); }
  };

  function desenharPrevia(conteudo) {
    Object.assign(mapeamento, previa.mapping);
    const colunas = h('div', { class: 'row g-2' }, previa.headers.map((header) => {
      const campo = select([{ value: '', label: 'Ignorar coluna' },
        ...previa.available.map((f) => ({ value: f.key, label: f.label, selected: mapeamento[header] === f.key }))],
        { class: 'form-select' });
      campo.onchange = () => {
        if (campo.value) mapeamento[header] = campo.value;
        else delete mapeamento[header];
      };
      return h('div', { class: 'col-6 col-md-3' },
        h('label', { class: 'form-label f-12' }, header), campo);
    }));

    const reanalisar = h('button', { class: 'btn btn-outline-secondary' }, 'Revalidar com este mapeamento');
    reanalisar.onclick = async () => {
      previa = await post('/imports/products/preview', { csv: conteudo, mapping: mapeamento });
      desenharPrevia(conteudo);
    };

    const importar = h('button', { class: 'btn btn-success' }, `Importar ${previa.rows.length} produto(s)`);
    importar.onclick = async () => {
      importar.disabled = true;
      try {
        const r = await post('/imports/products', { csv: conteudo, mapping: mapeamento, branchId: branchId || undefined });
        toast(`${r.created} criado(s), ${r.updated} atualizado(s), ${r.ignored} ignorado(s).`);
        location.href = '/produtos.html';
      } catch (e) {
        toast(e.message, 'error');
        importar.disabled = false;
      }
    };

    resultado.replaceChildren(
      card('Mapeamento das colunas', h('div', {}, colunas,
        h('div', { class: 'd-flex justify-content-end mt-3' }, reanalisar))),
      card(`Pré-visualização (${previa.rows.length} linha(s) válida(s))`,
        h('div', {},
          previa.errors.length
            ? h('div', { class: 'alert alert-warning' },
                h('strong', {}, `${previa.errors.length} linha(s) serão ignoradas: `),
                h('ul', { class: 'mb-0 f-12' }, previa.errors.slice(0, 10).map((e) => h('li', {}, `Linha ${e.line}: ${e.message}`))))
            : null,
          h('div', { class: 'table-responsive' }, h('table', { class: 'table table-sm align-middle mb-0' },
            h('thead', {}, h('tr', {},
              h('th', {}, 'Nome'), h('th', {}, 'SKU'), h('th', {}, 'Código de barras'),
              h('th', {}, 'Categoria'), h('th', { class: 'text-end' }, 'Custo'),
              h('th', { class: 'text-end' }, 'Preço'), h('th', { class: 'text-end' }, 'Estoque'))),
            h('tbody', {}, previa.rows.slice(0, 25).map((r) => h('tr', {},
              h('td', {}, r.name), h('td', {}, r.sku || '—'), h('td', {}, r.barcode || '—'),
              h('td', {}, r.categoryName || '—'),
              h('td', { class: 'text-end' }, fmtBRL(r.costCents)),
              h('td', { class: 'text-end' }, fmtBRL(r.priceCents)),
              h('td', { class: 'text-end' }, fmtQty(r.stock))))))),
          h('div', { class: 'd-flex justify-content-end mt-3' }, importar))));
    refreshIcons(content);
  }

  mount(content,
    pageTitle('Importar produtos',
      h('a', { class: 'btn btn-light', href: '/produtos.html' }, 'Voltar')),
    card('Planilha', h('div', { class: 'row g-3' },
      h('div', { class: 'col-12 col-md-6' }, arquivo),
      h('div', { class: 'col-12' }, area),
      h('div', { class: 'col-12 d-flex justify-content-between align-items-center' },
        h('small', { class: 'txt-secondary' },
          'Colunas reconhecidas: nome, código, código de barras, categoria, marca, unidade, custo, preço, estoque, estoque mínimo.'),
        analisar))),
    resultado);
  refreshIcons(content);
}
