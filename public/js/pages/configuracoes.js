// Configurações operacionais da loja (estoque, PDV, caixa, impressão).
import { get, patch } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, card, centsToInput, field, h, input, moneyToCents, refreshIcons, textarea, toast } from '../ui.js';

export default async function render({ content, can }) {
  if (!can('empresa.gerenciar')) return mount(content, card(null, 'Sem permissão.'));
  const empresa = await get('/company');
  const s = empresa.settings;

  const check = (checked) => h('input', { type: 'checkbox', class: 'form-check-input', checked });
  const f = {
    stockControl: check(s.stockControl),
    allowNegativeStock: check(s.allowNegativeStock),
    requireCustomer: check(s.requireCustomer),
    autoPrint: check(s.autoPrint),
    extSellerPix: check(s.extSellerPix !== false),
    maxDiscountPct: input({ inputmode: 'decimal', value: String(s.maxDiscountPct) }),
    sangriaApproval: input({ inputmode: 'decimal', value: centsToInput(s.sangriaApprovalCents) }),
    receiptFooter: textarea({ value: s.receiptFooter, rows: 2 }),
  };

  const linha = (campo, titulo, descricao) => h('div', { class: 'col-12 col-md-6' },
    h('div', { class: 'form-check' }, campo,
      h('label', { class: 'form-check-label' }, h('strong', {}, titulo),
        h('small', { class: 'd-block txt-secondary' }, descricao))));

  const salvar = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar configurações');
  const form = h('form', { class: 'row g-3' },
    linha(f.stockControl, 'Controlar estoque', 'Desligado, a venda não baixa estoque (útil para serviços).'),
    linha(f.allowNegativeStock, 'Permitir estoque negativo', 'Ligado, a venda passa mesmo sem saldo.'),
    linha(f.requireCustomer, 'Exigir cliente na venda', 'O PDV não finaliza sem identificar o cliente.'),
    linha(f.autoPrint, 'Imprimir comprovante automaticamente', 'Abre a impressão logo após a venda.'),
    linha(f.extSellerPix, 'Emitir PIX nas vendas do app de vendedor externo',
      'Ligado, o app gera QR e copia e cola pelo gateway. Exige o PIX configurado abaixo.'),
    field('Desconto máximo do operador (%)', f.maxDiscountPct, {
      col: 'col-6 col-md-3', help: 'Acima disso, exige a permissão pdv.desconto.',
    }),
    field('Sangria sem autorização até (R$)', f.sangriaApproval, {
      col: 'col-6 col-md-3', help: 'Valores maiores exigem perfil gerente ou acima.',
    }),
    field('Rodapé do comprovante', f.receiptFooter, { col: 'col-12' }),
    h('div', { class: 'col-12 text-end' }, salvar));

  form.onsubmit = async (e) => {
    e.preventDefault();
    salvar.disabled = true;
    try {
      await patch('/company/settings', {
        stockControl: f.stockControl.checked,
        allowNegativeStock: f.allowNegativeStock.checked,
        requireCustomer: f.requireCustomer.checked,
        autoPrint: f.autoPrint.checked,
        extSellerPix: f.extSellerPix.checked,
        maxDiscountPct: Number(f.maxDiscountPct.value.replace(',', '.')) || 0,
        sangriaApprovalCents: moneyToCents(f.sangriaApproval.value),
        receiptFooter: f.receiptFooter.value.trim(),
      });
      toast('Configurações salvas.');
    } catch (err) { toast(err.message, 'error'); } finally { salvar.disabled = false; }
  };

  // ---------- Pagamento PIX (gateway Blue) ----------
  const pix = empresa.pix || { enabled: false, configured: false };
  const pixEnabled = check(pix.enabled);
  const pixSecret = input({
    type: 'password', autocomplete: 'off',
    placeholder: pix.configured ? '•••••••• (credencial salva — deixe em branco para manter)' : 'sk_live_...',
  });
  const statusPix = h('span', { class: `badge ${pix.configured ? 'text-bg-success' : 'text-bg-secondary'}` },
    pix.configured ? 'Credencial salva' : 'Sem credencial');
  const salvarPix = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar PIX');
  const pixForm = h('form', { class: 'row g-3' },
    linha(pixEnabled, 'Habilitar PIX no PDV',
      'Gera o QR Code pela Blue e confirma o pagamento automaticamente (polling).'),
    field('Chave secreta (Secret Key)', pixSecret, {
      col: 'col-12 col-md-8',
      help: 'Fornecida pela Blue (sk_live_…). Fica só no servidor — nunca é exibida aqui.',
    }),
    h('div', { class: 'col-12 d-flex align-items-center gap-3 justify-content-end' }, statusPix, salvarPix));
  pixForm.onsubmit = async (e) => {
    e.preventDefault();
    salvarPix.disabled = true;
    try {
      const body = { enabled: pixEnabled.checked };
      if (pixSecret.value.trim()) body.secretKey = pixSecret.value.trim();
      const r = await patch('/company/pix', body);
      pixSecret.value = '';
      pixSecret.placeholder = r.configured ? '•••••••• (credencial salva — deixe em branco para manter)' : 'sk_live_...';
      statusPix.textContent = r.configured ? 'Credencial salva' : 'Sem credencial';
      statusPix.className = `badge ${r.configured ? 'text-bg-success' : 'text-bg-secondary'}`;
      toast('PIX atualizado.');
    } catch (err) { toast(err.message, 'error'); } finally { salvarPix.disabled = false; }
  };

  mount(content,
    pageTitle('Configurações',
      h('a', { class: 'btn btn-outline-secondary', href: '/empresa.html' }, 'Dados da empresa')),
    card('Operação da loja', form),
    card('Pagamento PIX (gateway Blue)', pixForm),
    card('Backup e dados', h('div', {},
      h('p', {}, 'O banco de dados fica em ', h('code', {}, 'data/app.db'),
        '. Faça cópia periódica desse arquivo (ou do Postgres, em produção) e teste a restauração.'),
      h('p', { class: 'mb-0 txt-secondary f-12' },
        'Sugestão: backup diário automático + retenção de 30 dias + um teste de restauração por mês.'))));
  refreshIcons(content);
}
