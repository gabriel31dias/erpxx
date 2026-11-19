import { patch, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { card, field, h, mount, refreshIcons, textarea, toast } from '../ui.js';

const EVENTS = [
  { key: 'purchase', title: 'Compra concluída', description: 'Quando uma venda com cliente cadastrado é concluída. Na maquininha, aguarda a aprovação do pagamento.' },
  { key: 'received', title: 'Pedido recebido', description: 'Quando um pedido de delivery entra no sistema. Pedidos com PIX aguardam o pagamento confirmado.' },
  { key: 'dispatched', title: 'Pedido despachado', description: 'Quando o pedido muda para “Saiu para entrega”, pela tela de pedidos ou pelo aceite do motoboy.' },
];
const STATES = {
  disconnected: ['Desconectado', 'secondary'], connecting: ['Conectando…', 'warning'],
  qr: ['Aguardando leitura do QR Code', 'warning'], connected: ['Conectado', 'success'],
  reconnecting: ['Reconectando…', 'warning'], error: ['Conexão indisponível', 'danger'],
};
const MESSAGE_STATES = { pending: 'Aguardando envio', sending: 'Enviando', sent: 'Enviado', failed: 'Falhou', cancelled: 'Cancelado' };

// QR Code e estado da sessão precisam de rede e não ficam no cache offline.
async function load(path = '') {
  const response = await fetch(`/api/whatsapp-bot${path}`, { credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || 'Não foi possível carregar o Boot Whats.');
  return body;
}

export default async function render({ content, can, me }) {
  if (!can('empresa.gerenciar')) return mount(content, card(null, 'Sem permissão para configurar o Boot Whats.'));
  const initial = await load();
  const connection = h('div', { 'aria-live': 'polite' });
  const connectionWarning = h('p', { class: 'small text-danger mb-0', role: 'status' });
  const history = h('div', {});
  const enabled = h('input', { type: 'checkbox', class: 'form-check-input', checked: initial.settings.enabled, id: 'whats-enabled' });
  const controls = {};
  const sample = {
    cliente: 'Ana', loja: me.company.tradeName || me.company.name, numero: '123',
    total: 'R$ 59,90', endereco: 'Rua das Flores, 100', itens: '1x Pizza, 1x Refrigerante',
  };
  const eventCards = EVENTS.map((event) => {
    const active = h('input', { type: 'checkbox', class: 'form-check-input', id: `whats-${event.key}`, checked: initial.settings[`${event.key}Enabled`] });
    const message = textarea({ rows: 4, maxlength: 2000, required: true });
    message.value = initial.settings[`${event.key}Template`];
    const preview = h('p', { class: 'mb-0 small', style: 'white-space:pre-wrap;overflow-wrap:anywhere;color:#1f2937' });
    const draw = () => { preview.textContent = message.value.replace(/\{(\w+)\}/g, (match, key) => sample[key] ?? match); };
    message.oninput = draw;
    draw();
    controls[event.key] = { active, message };
    const variables = h('div', { class: 'd-flex flex-wrap gap-2 mb-3' }, initial.variables.map((variable) => h('button', {
      type: 'button', class: 'btn btn-sm btn-light', title: `Inserir {${variable}}`,
      onclick: () => { message.focus(); message.setRangeText(`{${variable}}`, message.selectionStart, message.selectionEnd, 'end'); draw(); },
    }, `{${variable}}`)));
    return card(event.title, h('div', {},
      h('p', { class: 'text-muted small' }, event.description),
      h('div', { class: 'form-check form-switch mb-3' }, active, h('label', { for: active.id, class: 'form-check-label' }, 'Enviar este aviso automaticamente')),
      h('div', { class: 'row mb-3' }, field(`Mensagem: ${event.title.toLowerCase()}`, message, { col: 'col-12' })),
      variables,
      h('div', { class: 'rounded p-3', style: 'background:#f1f5f9' },
        h('small', { class: 'd-block mb-2', style: 'color:#64748b' }, 'Prévia da mensagem'), preview)));
  });
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Salvar configurações');
  const form = h('form', {},
    card('Mensagens automáticas', h('div', {},
      h('div', { class: 'form-check form-switch mb-3' }, enabled,
        h('label', { class: 'form-check-label fw-bold', for: enabled.id }, 'Ativar mensagens automáticas')),
      h('p', { class: 'small text-muted mb-0' }, 'Os avisos usam o WhatsApp/telefone do cliente. No delivery, usam o número informado no pedido. Sem conexão, ficam aguardando na fila.'))),
    ...eventCards,
    h('div', { class: 'd-flex justify-content-end mb-4' }, save));
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true;
    try {
      const settings = { enabled: enabled.checked };
      for (const { key } of EVENTS) {
        settings[`${key}Enabled`] = controls[key].active.checked;
        settings[`${key}Template`] = controls[key].message.value;
      }
      await patch('/whatsapp-bot', settings);
      toast('Configurações do Boot Whats salvas.');
    } catch (error) { toast(error.message, 'error'); }
    finally { save.disabled = false; }
  };

  async function act(path) {
    connection.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try { drawConnection(await post(`/whatsapp-bot/${path}`, {})); }
    catch (error) { toast(error.message, 'error'); drawConnection(await load('/status').catch(() => initial.status)); }
  }

  function drawConnection(status) {
    const [label, color] = STATES[status.state] || STATES.error;
    const validQr = status.state === 'qr' && !!status.qrCode;
    const connecting = ['connecting', 'reconnecting'].includes(status.state);
    connection.replaceChildren(h('div', {},
      h('div', { class: 'd-flex align-items-center flex-wrap gap-2 mb-3' },
        h('span', { class: `badge text-bg-${color}` }, label),
        status.phone ? h('span', {}, `+${status.phone}${status.name ? ` · ${status.name}` : ''}`) : null),
      status.state === 'connected' ? h('p', { class: 'text-success' }, 'WhatsApp pronto para enviar os avisos ativados.') : h('p', { class: 'small' },
        'No celular, abra WhatsApp → Aparelhos conectados → Conectar um aparelho e leia o QR Code abaixo.'),
      validQr ? h('div', { class: 'text-center mb-3' },
        h('img', { src: status.qrCode, alt: 'QR Code para conectar o WhatsApp da empresa', width: 300, height: 300, style: 'max-width:100%;height:auto;background:white' }),
        h('p', { class: 'small text-muted mt-2' }, 'O QR Code é atualizado automaticamente enquanto esta tela estiver aberta.')) : null,
      status.state === 'qr' && !validQr ? h('p', { class: 'text-warning' }, 'O QR Code expirou. Gere um novo para conectar.') : null,
      status.error ? h('p', { class: 'text-danger small', role: 'status' }, status.error) : null,
      h('div', { class: 'd-flex flex-wrap gap-2' },
        h('button', { type: 'button', class: 'btn btn-success', disabled: connecting || validQr || status.state === 'connected', onclick: () => act('connect') },
          status.state === 'connected' ? 'WhatsApp conectado' : status.state === 'qr' && !validQr ? 'Gerar novo QR Code' : 'Conectar WhatsApp'),
        h('button', { type: 'button', class: 'btn btn-outline-danger', disabled: status.state === 'disconnected', onclick: () => act('disconnect') }, 'Desconectar'))));
  }

  async function drawHistory() {
    const { rows } = await load('/messages');
    history.replaceChildren(rows.length ? h('div', { class: 'table-responsive' }, h('table', { class: 'table align-middle' },
      h('thead', {}, h('tr', {}, ['Evento / mensagem', 'Cliente', 'Situação', 'Tentativas', 'Data', ''].map((label) => h('th', { scope: 'col' }, label)))),
      h('tbody', {}, rows.map((row) => h('tr', {},
        h('td', {}, h('strong', {}, EVENTS.find((event) => event.key === row.event)?.title || row.event),
          h('details', { class: 'small mt-1' }, h('summary', {}, 'Ver mensagem'), h('p', { class: 'mt-2 mb-0', style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, row.message))),
        h('td', {}, `+${row.phone}`),
        h('td', {}, h('span', { class: `badge text-bg-${row.status === 'sent' ? 'success' : row.status === 'failed' ? 'danger' : 'secondary'}` }, MESSAGE_STATES[row.status] || row.status),
          row.lastError ? h('small', { class: 'd-block text-muted mt-1' }, row.lastError) : null),
        h('td', {}, row.attempts), h('td', { class: 'small' }, new Date(row.sentAt || row.createdAt).toLocaleString('pt-BR')),
        h('td', {}, row.status === 'failed' ? h('button', { type: 'button', class: 'btn btn-sm btn-outline-primary', onclick: async (event) => {
          event.currentTarget.disabled = true;
          try { await post(`/whatsapp-bot/messages/${row.id}/retry`, {}); await drawHistory(); toast('Mensagem recolocada na fila.'); }
          catch (error) { toast(error.message, 'error'); event.target.disabled = false; }
        } }, 'Tentar novamente') : null)))))) : h('p', { class: 'text-muted mb-0' }, 'Nenhum aviso registrado. Ative o bot e os próximos eventos aparecerão aqui.'));
  }

  mount(content, pageTitle('Boot Whats'),
    h('p', { class: 'mb-4' }, 'Conecte o WhatsApp da loja e acompanhe seus clientes automaticamente, da compra até a saída do pedido.'),
    card('Conexão com WhatsApp', h('div', {}, connection, connectionWarning)),
    form, card('Últimos envios', history));
  drawConnection(initial.status);
  await drawHistory();
  refreshIcons(content);

  let timer;
  let stopped = false;
  let cycle = 0;
  async function poll() {
    if (stopped || !connection.isConnected) return;
    try {
      const status = await load('/status');
      if (stopped) return;
      drawConnection(status); connectionWarning.textContent = '';
      if (++cycle % 3 === 0) await drawHistory();
    } catch { connectionWarning.textContent = 'Não foi possível atualizar a conexão. Verifique sua rede.'; }
    if (!stopped) timer = setTimeout(poll, 4000);
  }
  timer = setTimeout(poll, 4000);
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); }, { once: true });
}
