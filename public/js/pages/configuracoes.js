// Configurações operacionais da loja (estoque, PDV, caixa, impressão).
import { get, patch, post } from '../api.js';
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
    ticketMode: check(s.ticketMode),
    maxDiscountPct: input({ inputmode: 'decimal', value: String(s.maxDiscountPct) }),
    sangriaApproval: input({ inputmode: 'decimal', value: centsToInput(s.sangriaApprovalCents) }),
    receiptFooter: textarea({ value: s.receiptFooter, rows: 2 }),
    crediarioIntervalDays: input({ inputmode: 'numeric', value: String(s.crediarioIntervalDays ?? 30) }),
    crediarioGraceDays: input({ inputmode: 'numeric', value: String(s.crediarioGraceDays ?? 0) }),
    visitRadiusM: input({ inputmode: 'numeric', value: String(s.visitRadiusM ?? 150) }),
    cloverFeePct: input({ inputmode: 'decimal', value: String(s.cloverFeePct ?? 0).replace('.', ',') }),
  };

  const linha = (campo, titulo, descricao) => h('div', { class: 'col-12 col-md-6' },
    h('div', { class: 'form-check' }, campo,
      h('label', { class: 'form-check-label' }, h('strong', {}, titulo),
        h('small', { class: 'd-block txt-secondary' }, descricao))));

  // a maquininha passa a ver na hora: não espera o "Salvar configurações"
  f.ticketMode.onchange = async () => {
    const on = f.ticketMode.checked;
    f.ticketMode.disabled = true;
    try {
      await patch('/company/settings', { ticketMode: on });
      toast(on ? 'Modo bilheteria ligado.' : 'Modo bilheteria desligado.');
    } catch (err) {
      f.ticketMode.checked = !on;
      toast(err.message, 'error');
    } finally { f.ticketMode.disabled = false; }
  };

  const salvar = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar configurações');
  const form = h('form', { class: 'row g-3' },
    linha(f.stockControl, 'Controlar estoque', 'Desligado, a venda não baixa estoque (útil para serviços).'),
    linha(f.allowNegativeStock, 'Permitir estoque negativo', 'Ligado, a venda passa mesmo sem saldo.'),
    linha(f.requireCustomer, 'Exigir cliente na venda', 'O PDV não finaliza sem identificar o cliente.'),
    linha(f.autoPrint, 'Imprimir comprovante automaticamente', 'Abre a impressão logo após a venda.'),
    linha(f.extSellerPix, 'Emitir PIX nas vendas do app de vendedor externo',
      'Ligado, o app gera QR e copia e cola pelo gateway. Exige o PIX configurado abaixo.'),
    linha(f.ticketMode, 'Modo bilheteria',
      'Cada venda vira um ingresso: a maquininha imprime o QR e queima o ingresso na entrada. Salva ao clicar.'),
    field('Desconto máximo do operador (%)', f.maxDiscountPct, {
      col: 'col-6 col-md-3', help: 'Acima disso, exige a permissão pdv.desconto.',
    }),
    field('Sangria sem autorização até (R$)', f.sangriaApproval, {
      col: 'col-6 col-md-3', help: 'Valores maiores exigem perfil gerente ou acima.',
    }),
    field('Crediário: dias entre parcelas', f.crediarioIntervalDays, {
      col: 'col-6 col-md-3', help: 'A 1ª parcela vence esse número de dias após a venda.',
    }),
    field('Crediário: tolerância de atraso (dias)', f.crediarioGraceDays, {
      col: 'col-6 col-md-3', help: 'Atraso maior que isso barra nova compra no crediário.',
    }),
    field('Visitas: raio do check-in (metros)', f.visitRadiusM, {
      col: 'col-6 col-md-3', help: 'Check-in mais longe que isso do cliente aparece como "fora do local".',
    }),
    field('Taxa da maquininha Clover (%)', f.cloverFeePct, {
      col: 'col-6 col-md-3', help: 'Percentual cobrado pela Clover sobre o valor de cada venda.',
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
        ticketMode: f.ticketMode.checked,
        maxDiscountPct: Number(f.maxDiscountPct.value.replace(',', '.')) || 0,
        sangriaApprovalCents: moneyToCents(f.sangriaApproval.value),
        receiptFooter: f.receiptFooter.value.trim(),
        crediarioIntervalDays: Math.max(1, parseInt(f.crediarioIntervalDays.value, 10) || 30),
        crediarioGraceDays: Math.max(0, parseInt(f.crediarioGraceDays.value, 10) || 0),
        visitRadiusM: Math.max(20, parseInt(f.visitRadiusM.value, 10) || 150),
        cloverFeePct: Math.min(100, Math.max(0, Number(f.cloverFeePct.value.replace(',', '.')) || 0)),
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

  // ---------- Praças da cozinha ----------
  const pracasLista = h('div', { class: 'd-flex flex-column gap-2' });
  async function carregarPracas() {
    const { rows } = await get('/kitchen/stations', { all: 1 });
    pracasLista.replaceChildren(...rows.map((st) => {
      const nome = input({ value: st.name, 'aria-label': 'Nome da praça' });
      const ativa = check(st.active);
      ativa.disabled = st.isDefault; // a padrão recebe o que não tem praça
      const salvarPraca = h('button', { class: 'btn btn-outline-primary', type: 'button' }, 'Salvar');
      salvarPraca.onclick = async () => {
        salvarPraca.disabled = true;
        try {
          await patch(`/kitchen/stations/${st.id}`, { name: nome.value.trim(), active: ativa.checked });
          toast('Praça salva.');
        } catch (err) { toast(err.message, 'error'); } finally { salvarPraca.disabled = false; }
      };
      return h('div', { class: 'd-flex flex-wrap gap-2 align-items-center' },
        h('div', { style: 'flex:1;min-width:180px' }, nome),
        st.isDefault
          ? h('span', { class: 'badge text-bg-primary' }, 'Padrão')
          : h('label', { class: 'form-check mb-0 d-flex gap-2 align-items-center' }, ativa, h('span', {}, 'Ativa')),
        salvarPraca);
    }));
  }
  const novaPraca = input({ placeholder: 'Ex.: Bar, Chapa, Sobremesa' });
  const addPraca = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Adicionar praça');
  const pracasForm = h('form', { class: 'd-flex gap-2 mt-3' }, h('div', { style: 'flex:1' }, novaPraca), addPraca);
  pracasForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!novaPraca.value.trim()) return;
    addPraca.disabled = true;
    try {
      await post('/kitchen/stations', { name: novaPraca.value.trim() });
      novaPraca.value = '';
      toast('Praça adicionada.');
      await carregarPracas();
    } catch (err) { toast(err.message, 'error'); } finally { addPraca.disabled = false; }
  };
  await carregarPracas();

  mount(content,
    pageTitle('Configurações',
      h('a', { class: 'btn btn-outline-secondary', href: '/empresa.html' }, 'Dados da empresa')),
    card('Operação da loja', form),
    card('Pagamento PIX (gateway Blue)', pixForm),
    card('Praças da cozinha', h('div', {},
      h('p', { class: 'txt-secondary f-12' },
        'Cada praça tem a sua tela de preparo (ex.: Cozinha e Bar). O produto vai para a praça da categoria ou para a escolhida no cadastro dele; '
        + 'o que não tiver praça vai para a padrão. O pedido só fica "Pronto" quando todas as praças terminam.'),
      pracasLista, pracasForm)),
    card('Backup e dados', h('div', {},
      h('p', {}, 'O banco de dados fica em ', h('code', {}, 'data/app.db'),
        '. Faça cópia periódica desse arquivo (ou do Postgres, em produção) e teste a restauração.'),
      h('p', { class: 'mb-0 txt-secondary f-12' },
        'Sugestão: backup diário automático + retenção de 30 dias + um teste de restauração por mês.'))));
  refreshIcons(content);
}
