// Tela da cozinha (KDS): pedidos do cardápio, do QR da mesa e do garçom em três colunas
// (Novos → Em preparo → Prontos). Tempo real por SSE (/api/kitchen/events); a cozinha só
// aceita e marca pronto — entregar, servir e gerar a venda continuam com o caixa/garçom.
// Praças: cada aparelho escolhe a sua (Cozinha, Bar…) e vê só os itens dela; "Todas" é a
// visão de quem despacha, com o andamento de cada praça. A escolha fica no aparelho.
import { get, patch, post } from './api.js';
import { h } from './ui.js';

const raiz = document.getElementById('lf-kds');

const COLUNAS = [
  { status: 'pending', titulo: 'Novos', cls: 'col-novo', acao: 'Aceitar', proximo: 'preparing' },
  { status: 'preparing', titulo: 'Em preparo', cls: 'col-preparo', acao: 'Pronto', proximo: 'ready', voltar: 'pending' },
  { status: 'ready', titulo: 'Prontos', cls: 'col-pronto', voltar: 'preparing' },
];
const NOMES = { pending: 'Novos', preparing: 'Em preparo', ready: 'Prontos' };
// minutos desde a chegada do pedido: amarelo e vermelho no relógio do card
const ALERTA_MIN = 10;
const ATRASO_MIN = 20;
const DESFAZER_MS = 8000;

const PRACA_KEY = 'lf.kds.praca';
let pracas = [];
let praca = ''; // '' = todas
let pedidos = [];
let diferenca = 0; // relógio do servidor - relógio do aparelho
const vistos = new Set(); // pedidos já desenhados (o que chegar depois pisca)
let primeiraCarga = true;

const agora = () => Date.now() + diferenca;
const minutos = (iso) => Math.max(0, Math.floor((agora() - new Date(iso)) / 60000));
const relogio = (iso) => {
  const s = Math.max(0, Math.floor((agora() - new Date(iso)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function tipo(o) {
  if (o.type === 'table') return `Mesa ${o.table}`;
  return o.type === 'delivery' ? 'Entrega' : 'Retirada';
}

// ---------- som: o navegador só libera depois de um toque na tela ----------
let audio = null;
function destravarAudio() {
  try { audio ??= new AudioContext(); } catch { return; }
  if (audio.state === 'suspended') audio.resume().catch(() => {});
}
function bip() {
  destravarAudio();
  if (!audio || audio.state !== 'running') return;
  const t0 = audio.currentTime + 0.02;
  [880, 1175, 1568].forEach((freq, i) => {
    const osc = audio.createOscillator();
    const vol = audio.createGain();
    vol.gain.value = 0.25;
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.connect(vol).connect(audio.destination);
    osc.start(t0 + i * 0.18);
    osc.stop(t0 + i * 0.18 + 0.16);
  });
}
function pedirSom() {
  destravarAudio();
  if (audio?.state === 'running') return;
  const tela = h('div', { class: 'lf-kds-som' },
    h('button', { type: 'button', onclick: () => { destravarAudio(); tela.remove(); } }, '🔔 Toque para ligar o som dos pedidos'));
  document.body.append(tela);
}

// ---------- tela sempre acesa (tablet/TV) ----------
let trava = null;
async function manterAcesa() {
  try { trava = await navigator.wakeLock?.request('screen'); } catch { /* sem suporte ou sem permissão */ }
}
// o navegador solta a trava quando a aba some; volta a pedir ao reaparecer
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (!trava || trava.released)) manterAcesa();
});

// ---------- avisos (desfazer, erro, cancelado) ----------
const avisos = h('div', { class: 'lf-kds-avisos', role: 'status', 'aria-live': 'polite' });
function avisar(texto, { erro = false, botao, acao, ms = 5000 } = {}) {
  const el = h('div', { class: `lf-kds-aviso${erro ? ' erro' : ''}` }, h('span', {}, texto),
    botao ? h('button', { type: 'button', onclick: () => { el.remove(); acao(); } }, botao) : null);
  avisos.append(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- dados ----------
async function carregar() {
  try {
    const r = await get('/kitchen/orders', { station: praca });
    diferenca = new Date(r.now) - Date.now();
    pedidos = r.rows;
    desenhar();
    status(true);
  } catch (e) {
    status(false);
    if (e.status === 403) semPermissao();
  }
}
let agendado = null;
const recarregar = () => { clearTimeout(agendado); agendado = setTimeout(carregar, 250); };

async function mover(o, para, { desfazer = true } = {}) {
  const de = o.status;
  try {
    // na praça mexe só a ficha dela; em "Todas", o pedido inteiro
    await patch(o.ticketId ? `/kitchen/tickets/${o.ticketId}/status` : `/kitchen/orders/${o.id}/status`, { status: para });
    o.status = para;
    desenhar();
    if (desfazer) {
      avisar(`#${o.number} → ${NOMES[para]}`, {
        botao: 'Desfazer', ms: DESFAZER_MS, acao: () => mover(o, de, { desfazer: false }),
      });
    }
  } catch (e) {
    avisar(e.message, { erro: true });
  }
  recarregar();
}

// ---------- desenho ----------
const colunas = new Map();
const contadores = new Map();
let indicador = null;

function montar(me) {
  const ehCozinha = me.user.role === 'cozinha';
  const hora = h('div', { class: 'lf-kds-relogio' });
  const tick = () => { hora.textContent = new Date(agora()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
  tick();
  setInterval(tick, 10000);
  indicador = h('span', { class: 'lf-kds-status' }, 'Conectando…');

  const telaCheia = h('button', {
    type: 'button', class: 'lf-kds-btn',
    onclick: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()),
  }, 'Tela cheia');
  const seletor = pracas.length > 1
    ? h('select', {
      class: 'lf-kds-btn', 'aria-label': 'Praça',
      onchange: (e) => {
        praca = e.target.value;
        try { localStorage.setItem(PRACA_KEY, praca); } catch { /* sem storage */ }
        primeiraCarga = true;
        vistos.clear();
        carregar();
      },
    },
    pracas.map((s) => h('option', { value: s.id, selected: s.id === praca }, s.name)),
    h('option', { value: '', selected: praca === '' }, 'Todas as praças'))
    : null;
  const sair = ehCozinha
    ? h('button', {
      type: 'button', class: 'lf-kds-btn',
      onclick: async () => { await post('/auth/logout').catch(() => {}); location.href = '/login.html'; },
    }, 'Sair')
    : h('a', { class: 'lf-kds-btn', href: '/' }, 'Voltar ao sistema');

  const grade = h('div', { class: 'lf-kds-colunas' }, COLUNAS.map((c) => {
    const lista = h('div', { class: 'lf-kds-lista' });
    const n = h('span', { class: 'n' }, '0');
    colunas.set(c.status, lista);
    contadores.set(c.status, n);
    return h('section', { class: `lf-kds-coluna ${c.cls}`, 'aria-label': c.titulo },
      h('div', { class: 'lf-kds-coluna-topo' }, c.titulo, n), lista);
  }));

  raiz.replaceChildren(
    h('header', { class: 'lf-kds-topo' },
      h('div', { class: 'lf-kds-titulo' }, 'Cozinha', h('small', {}, me.company.tradeName || me.company.name)),
      seletor, indicador, hora, telaCheia, sair),
    grade);
  document.body.append(avisos);
}

function status(online) {
  if (!indicador) return;
  indicador.textContent = online ? 'Ao vivo' : 'Sem conexão';
  indicador.className = `lf-kds-status ${online ? 'on' : 'off'}`;
}

function cartao(o, col) {
  // cor do relógio pelo tempo total desde a chegada; o número mostra o tempo na etapa atual
  const desde = o.status === 'ready' ? o.readyAt : o.status === 'preparing' ? o.acceptedAt : o.createdAt;
  const total = minutos(o.createdAt);
  const cor = o.status === 'ready' ? '' : total >= ATRASO_MIN ? 'atraso' : total >= ALERTA_MIN ? 'alerta' : '';
  const tempo = h('span', { class: `lf-kds-tempo ${cor}`, 'data-desde': desde || o.createdAt, title: `Chegou há ${total} min` },
    relogio(desde || o.createdAt));
  const novo = !primeiraCarga && !vistos.has(o.id);
  vistos.add(o.id);
  // outras praças do mesmo pedido que ainda não terminaram
  const faltam = o.stations.filter((s) => s.id !== praca && s.status !== 'ready');

  const botoes = [];
  if (col.proximo) {
    botoes.push(h('button', {
      type: 'button', class: 'lf-kds-acao',
      onclick: (e) => { e.currentTarget.disabled = true; mover(o, col.proximo); },
    }, col.acao));
  } else {
    const espera = praca && faltam.length ? `Aguardando ${faltam.map((s) => s.name).join(', ')}`
      : o.type === 'table' ? 'Aguardando o garçom' : o.type === 'delivery' ? 'Aguardando o entregador' : 'Aguardando retirada';
    botoes.push(h('div', { class: 'lf-kds-espera' }, espera));
  }
  if (col.voltar && col.status === 'ready') {
    botoes.push(h('button', { type: 'button', class: 'lf-kds-voltar', onclick: () => mover(o, col.voltar) }, 'Voltar ao preparo'));
  }

  return h('article', { class: `lf-kds-card${novo ? ' chegou' : ''}`, 'aria-label': `Pedido ${o.number}, ${tipo(o)}` },
    h('div', { class: 'lf-kds-card-topo' },
      h('span', { class: 'lf-kds-num' }, `#${o.number}`),
      h('span', {}, h('div', { class: 'lf-kds-tipo' }, tipo(o)),
        o.type !== 'table' ? h('div', { class: 'lf-kds-cliente' }, o.customerName.split(' ')[0]) : null),
      tempo),
    o.stations.length > 1 ? h('div', { class: 'lf-kds-pracas' }, o.stations.map((s) => h('span', {
      class: `lf-kds-praca ${s.status}${s.id === praca ? ' minha' : ''}`,
      title: { pending: 'Não começou', preparing: 'Em preparo', ready: 'Pronto' }[s.status],
    }, `${{ pending: '○', preparing: '◐', ready: '✔' }[s.status]} ${s.name}`))) : null,
    h('ul', { class: 'lf-kds-itens' }, o.items.map((i) => h('li', { class: 'lf-kds-item' },
      h('span', { class: 'q' }, `${i.quantity}×`), i.name,
      !praca && o.stations.length > 1 && i.station ? h('span', { class: 'lf-kds-item-praca' }, i.station) : null,
      i.additionals.length ? h('div', { class: 'lf-kds-adic' }, i.additionals.map((a) => `+ ${a}`).join(' · ')) : null))),
    o.notes ? h('div', { class: 'lf-kds-obs' }, `⚠ ${o.notes}`) : null,
    h('div', { class: 'lf-kds-acoes' }, botoes));
}

function desenhar() {
  // pedido novo (que não estava na tela) toca o aviso: vale só para o que é desta praça
  if (!primeiraCarga && pedidos.some((o) => o.status === 'pending' && !vistos.has(o.id))) bip();
  for (const col of COLUNAS) {
    const doStatus = pedidos.filter((o) => o.status === col.status);
    contadores.get(col.status).textContent = String(doStatus.length);
    colunas.get(col.status).replaceChildren(...(doStatus.length
      ? doStatus.map((o) => cartao(o, col))
      : [h('div', { class: 'lf-kds-vazio' }, col.status === 'pending' ? 'Nenhum pedido novo.' : 'Nada aqui.')]));
  }
  primeiraCarga = false;
}

// relógio dos cards anda sem recarregar a lista
setInterval(() => {
  document.querySelectorAll('.lf-kds-tempo[data-desde]').forEach((el) => { el.textContent = relogio(el.dataset.desde); });
}, 1000);

function semPermissao() {
  raiz.replaceChildren(h('div', { class: 'lf-kds-vazio' },
    h('p', {}, 'Seu perfil não tem acesso à tela da cozinha.'),
    h('a', { class: 'lf-kds-btn', href: '/' }, 'Voltar')));
}

// ---------- tempo real ----------
function ouvir() {
  const fonte = new EventSource('/api/kitchen/events');
  fonte.onopen = () => { status(true); carregar(); };
  fonte.onerror = () => status(false); // o EventSource reconecta sozinho
  fonte.onmessage = (ev) => {
    const e = JSON.parse(ev.data);
    // cancelado com a cozinha mexendo: avisa quem está preparando
    if (e.status === 'cancelled' && pedidos.some((o) => o.id === e.id)) {
      avisar(`Pedido #${e.number} foi CANCELADO.`, { erro: true, ms: 15000 });
    }
    recarregar();
  };
  addEventListener('pagehide', () => fonte.close(), { once: true });
}

async function iniciar() {
  let me;
  try { me = await get('/auth/me'); } catch { return; } // api.js já mandou para o login
  if (!me.permissions.includes('cozinha.operar')) return semPermissao();
  pracas = (await get('/kitchen/stations')).rows;
  // link direto (?praca=ID) > escolha deste aparelho > uma só praça > todas
  let salva = null;
  try { salva = localStorage.getItem(PRACA_KEY); } catch { /* sem storage */ }
  const pedida = new URLSearchParams(location.search).get('praca') ?? salva;
  if (pracas.length === 1) praca = pracas[0].id;
  else if (pedida === '' || pracas.some((s) => s.id === pedida)) praca = pedida;
  else praca = pracas[0]?.id ?? '';
  montar(me);
  await carregar();
  ouvir();
  pedirSom();
  manterAcesa();
  // rede ruim: confere a lista de tempos em tempos mesmo sem evento
  setInterval(carregar, 60000);
}

iniciar();
