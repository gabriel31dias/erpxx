import { post } from './api.js';
import { field, h, modal, select, toast } from './ui.js';

/** Mesmo fluxo nas duas listas: arquivo, mapeamento, prévia e confirmação. */
export function openContactImport(kind, onComplete) {
  const label = kind === 'customers' ? 'clientes' : 'fornecedores';
  const endpoint = `/imports/${kind}`;
  let payload = null;
  let preview = null;
  let mapping = {};
  let busy = false;
  let completed = false;
  const file = h('input', { type: 'file', class: 'form-control', accept: '.xlsx,.xml,.csv' });
  const result = h('div', { 'aria-live': 'polite' });
  const message = h('div', { class: 'text-danger mb-3', role: 'alert' });
  const analyze = h('button', { type: 'button', class: 'btn btn-outline-primary' }, 'Analisar arquivo');
  const commit = h('button', { type: 'button', class: 'btn btn-success', disabled: true, hidden: true }, 'Importar');
  const dialog = modal({
    title: `Importar ${label}`,
    size: 'modal-xl',
    body: h('div', {},
      h('p', {}, 'Escolha um arquivo Excel (.xlsx), XML ou CSV com até 3 MB e 1.000 registros. Use a primeira aba do Excel e mantenha CPF/CNPJ e CEP como texto para preservar zeros à esquerda.'),
      h('div', { class: 'd-flex align-items-center flex-wrap gap-2 mb-3' },
        h('span', {}, 'Baixar exemplo:'),
        ...[['xlsx', 'Excel'], ['xml', 'XML'], ['csv', 'CSV']].map(([format, text]) =>
          h('a', { class: 'btn btn-sm btn-outline-secondary', href: `/api${endpoint}/example?format=${format}`, download: `exemplo-${label}.${format}` }, text))),
      h('p', { class: 'small text-muted' }, 'O nome é obrigatório. Cadastros com o mesmo CPF/CNPJ serão atualizados; sem CPF/CNPJ, serão criados. Campos vazios preservam os valores já cadastrados. Linhas inválidas serão ignoradas e aparecerão na revisão.'),
      h('div', { class: 'row mb-3' }, field('Arquivo para importar', file, { col: 'col-12' })),
      message, result),
    footer: [h('button', { type: 'button', class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Fechar'), analyze, commit],
  });
  // Mantém o resultado acessível até o servidor terminar de processar o arquivo.
  dialog.el.addEventListener('hide.bs.modal', (event) => { if (busy) event.preventDefault(); });

  function setBusy(value) {
    busy = value;
    file.disabled = value;
    analyze.disabled = value || completed;
    commit.disabled = value || completed || !preview?.rows.length;
    result.querySelectorAll('select').forEach((control) => { control.disabled = value || completed; });
    dialog.el.setAttribute('aria-busy', String(value));
  }

  file.onchange = () => {
    payload = preview = null;
    mapping = {};
    completed = false;
    commit.hidden = true;
    commit.disabled = true;
    analyze.disabled = false;
    analyze.hidden = false;
    delete analyze.dataset.mapped;
    analyze.textContent = 'Analisar arquivo';
    message.textContent = '';
    result.replaceChildren();
  };

  analyze.onclick = async () => {
    message.textContent = '';
    preview = null;
    commit.disabled = true;
    setBusy(true);
    try {
      if (!payload) {
        const chosen = file.files?.[0];
        if (!chosen) throw new Error('Escolha um arquivo para importar.');
        if (chosen.size > 3 * 1024 * 1024) throw new Error('O arquivo deve ter até 3 MB.');
        const format = chosen.name.split('.').pop().toLowerCase();
        if (!['xlsx', 'xml', 'csv'].includes(format)) throw new Error('Envie Excel (.xlsx), XML ou CSV. Para .xls, salve como .xlsx no Excel.');
        const content = format === 'xlsx' ? await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
          reader.readAsDataURL(chosen);
        }) : await chosen.text();
        payload = { format, content };
      }
      preview = await post(`${endpoint}/preview`, { ...payload, ...(Object.keys(mapping).length || analyze.dataset.mapped ? { mapping } : {}) });
      mapping = { ...preview.mapping };
      drawPreview();
      analyze.dataset.mapped = 'true';
      analyze.textContent = 'Revalidar colunas';
    } catch (e) {
      message.textContent = e.message;
    } finally { setBusy(false); }
  };

  function drawErrors(errors) {
    return errors.length ? h('div', { class: 'alert alert-warning', role: 'status' },
      h('strong', {}, `${errors.length} linha(s) ignorada(s):`),
      h('ul', { class: 'mb-0 mt-2', style: 'max-height:180px;overflow:auto' },
        errors.map((error) => h('li', {}, `Linha ${error.line}: ${error.message}`)))) : document.createDocumentFragment();
  }

  function drawPreview() {
    const created = preview.rows.filter((row) => row.action === 'create').length;
    const updated = preview.rows.length - created;
    const columns = h('div', { class: 'row g-2 mb-3' }, preview.headers.map((header) => {
      const control = select([
        { value: '', label: 'Ignorar coluna' },
        ...preview.available.map((f) => ({ value: f.key, label: f.label })),
      ]);
      control.value = mapping[header] || '';
      control.onchange = () => {
        if (control.value) mapping[header] = control.value;
        else delete mapping[header];
        // Só permite gravar depois de validar exatamente o mapeamento escolhido.
        preview = null;
        commit.disabled = true;
        message.textContent = 'As colunas foram alteradas. Clique em Revalidar colunas antes de importar.';
      };
      return field(header, control, { col: 'col-12 col-md-4' });
    }));
    result.replaceChildren(
      h('h6', {}, 'Confira o destino de cada coluna'), columns,
      h('p', { class: 'fw-bold', role: 'status' }, `${created} cadastro(s) novo(s), ${updated} atualização(ões) e ${preview.errors.length} linha(s) inválida(s).`),
      drawErrors(preview.errors),
      h('div', { class: 'table-responsive' }, h('table', { class: 'table table-sm align-middle' },
        h('thead', {}, h('tr', {}, ['Linha', 'Ação', 'Nome / razão social', 'CPF/CNPJ', 'Telefone', 'E-mail'].map((text) => h('th', { scope: 'col' }, text)))),
        h('tbody', {}, preview.rows.slice(0, 25).map((row) => h('tr', {},
          h('td', {}, row.line), h('td', {}, row.action === 'create' ? 'Criar' : 'Atualizar'),
          h('td', {}, row.data.name), h('td', {}, row.data.document || '—'),
          h('td', {}, row.data.phone || '—'), h('td', {}, row.data.email || '—')))))),
      h('p', { class: 'small text-muted' }, preview.rows.length > 25 ? 'Exibindo os primeiros 25 registros válidos. A importação inclui todos os registros válidos.' : 'Confira a prévia antes de confirmar a importação.'));
    commit.hidden = false;
    const noun = kind === 'customers' ? 'cliente' : 'fornecedor';
    commit.textContent = `Importar ${preview.rows.length} ${noun}${preview.rows.length === 1 ? '' : 's'}`;
  }

  commit.onclick = async () => {
    if (busy || completed || !preview?.rows.length) return;
    message.textContent = '';
    setBusy(true);
    try {
      const imported = await post(endpoint, { ...payload, mapping });
      completed = true;
      payload = preview = null;
      commit.hidden = true;
      analyze.hidden = true;
      file.disabled = true;
      result.replaceChildren(
        h('div', { class: 'alert alert-success', role: 'status' },
          `Importação concluída: ${imported.created} criado(s), ${imported.updated} atualizado(s) e ${imported.ignored} ignorado(s).`),
        drawErrors(imported.errors));
      toast('Importação concluída.');
      try { await onComplete(); }
      catch { message.textContent = 'Os dados foram importados. Atualize a página para recarregar a lista.'; }
    } catch (e) { message.textContent = e.message; }
    finally { setBusy(false); }
  };
}
