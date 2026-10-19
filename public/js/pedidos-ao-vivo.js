// Pedidos do cardápio e do garçom em tempo real (SSE /api/menu/events) em qualquer tela do ERP.
// Uma conexão por aba, dividida entre o alarme e as telas que acompanham pedidos (pedidos, mesas):
// o navegador abre no máximo 6 conexões por site em HTTP/1.1, e cada aba com duas esgotava rápido.
//
// Alarme: pedido novo toca uma sirene em loop e mostra uma faixa no topo até alguém atender.
// Para sozinho quando o pedido sai de "Novo" (aceito/cancelado em qualquer tela ou aparelho);
// "Silenciar" numa aba cala todas as abas deste navegador. Trocar de tela recarrega a página:
// ao (re)conectar, os pedidos ainda em "Novo" e não silenciados voltam a tocar.
import { get } from './api.js';
import { h } from './ui.js';

const ouvintes = new Set();
let fonte = null;

/** Recebe { open, error, message(evento) }; devolve a função que cancela. */
export function ouvirPedidos(ouvinte) {
  ouvintes.add(ouvinte);
  conectar();
  // já estava conectado: a tela recém-chegada carrega como se tivesse acabado de abrir
  if (fonte.readyState === EventSource.OPEN) ouvinte.open?.();
  return () => ouvintes.delete(ouvinte);
}

function conectar() {
  if (fonte) return;
  fonte = new EventSource('/api/menu/events');
  fonte.onopen = () => ouvintes.forEach((o) => o.open?.());
  fonte.onerror = () => ouvintes.forEach((o) => o.error?.());
  fonte.onmessage = (ev) => {
    const e = JSON.parse(ev.data);
    ouvintes.forEach((o) => o.message?.(e));
  };
  addEventListener('pagehide', () => fonte.close(), { once: true });
}

// ---------- alarme ----------

const tocando = new Map(); // id do pedido -> evento
const canal = 'BroadcastChannel' in window ? new BroadcastChannel('lf-alarme-pedidos') : null;
let audio = null;
let laco = null;
let faixa = null;
const tituloOriginal = document.title;

// pedidos já silenciados neste navegador (vale entre telas e abas)
const SILENCIADOS = 'lf.alarme.silenciados';
const silenciados = () => {
  try { return new Set(JSON.parse(localStorage.getItem(SILENCIADOS) || '[]')); } catch { return new Set(); }
};
function guardarSilenciados(ids) {
  try { localStorage.setItem(SILENCIADOS, JSON.stringify([...silenciados(), ...ids].slice(-200))); } catch { /* sem storage */ }
}
let piscar = null;

// sirene de caminhão de sorvete desafinado: quadrada, dois tons alternando e uma subida no fim
const MELODIA = [988, 740, 988, 740, 988, 740, 1175, 1319];
const NOTA = 0.14;
const CICLO_MS = 1800;

/**
 * O navegador só libera som depois de interação com o site. Cada tela do ERP é uma página nova,
 * mas o Chrome herda a liberação de quem clicou no link: por isso o áudio nasce já na carga da tela
 * (antes nascia só no primeiro clique desta página e a tela recém-aberta ficava muda).
 * Se mesmo assim vier bloqueado, o próximo clique/tecla destrava e a faixa pede esse clique.
 */
function destravarAudio() {
  if (!audio) {
    try { audio = new AudioContext(); } catch { return; }
    audio.onstatechange = () => { if (tocando.size) desenharFaixa(); };
  }
  if (audio.state === 'suspended') audio.resume().catch(() => {});
}
destravarAudio();
['pointerdown', 'keydown'].forEach((t) => addEventListener(t, destravarAudio, { capture: true }));

function tocarMelodia() {
  destravarAudio();
  if (!audio || audio.state !== 'running') return;
  const t0 = audio.currentTime + 0.02;
  const volume = audio.createGain();
  volume.gain.value = 0.18;
  volume.connect(audio.destination);
  MELODIA.forEach((freq, i) => {
    const osc = audio.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    osc.connect(volume);
    osc.start(t0 + i * NOTA);
    osc.stop(t0 + i * NOTA + NOTA * 0.9);
  });
}

// estilo junto do módulo: vale também no PDV, que não carrega o app.css
document.head.append(h('style', {}, `
.lf-alarme { position: fixed; top: 0; left: 0; right: 0; z-index: 2000; display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; background: #d61f2c; color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.25);
  animation: lf-alarme-pisca 1s steps(2, jump-none) infinite; }
.lf-alarme-sino { font-size: 26px; animation: lf-alarme-sacode .5s ease-in-out infinite; }
.lf-alarme-texto { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
.lf-alarme-dica { font-size: 12px; opacity: .9; }
.lf-alarme .lf-alarme-btn { border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 700; text-decoration: none;
  border: 1px solid #fff; background: #fff; color: #9e0f19; white-space: nowrap; }
.lf-alarme .lf-alarme-btn.vazado { background: transparent; color: #fff; }
.lf-alarme .lf-alarme-btn:hover { filter: brightness(.92); }
@keyframes lf-alarme-pisca { 50% { background: #9e0f19; } }
@keyframes lf-alarme-sacode { 0%,100% { transform: rotate(0); } 25% { transform: rotate(-18deg); } 75% { transform: rotate(18deg); } }
@media (prefers-reduced-motion: reduce) { .lf-alarme, .lf-alarme-sino { animation: none; } }
`));

function desenharFaixa() {
  if (!tocando.size) {
    faixa?.remove();
    faixa = null;
    return;
  }
  const lista = [...tocando.values()].sort((a, b) => a.number - b.number);
  const primeiro = lista[0];
  const texto = lista.length > 1
    ? `${lista.length} pedidos novos esperando: ${lista.map((e) => `#${e.number}`).join(', ')}`
    : `Pedido novo #${primeiro.number} ${primeiro.table ? `· Mesa ${primeiro.table}` : `de ${primeiro.customerName}`}`;
  const destino = lista.every((e) => e.table) ? '/mesas.html' : '/pedidos.html';
  const semSom = audio?.state !== 'running'
    ? h('span', { class: 'lf-alarme-dica' }, 'Clique em qualquer lugar da tela para ativar o som.')
    : null;

  const nova = h('div', { class: 'lf-alarme', role: 'alert' },
    h('span', { class: 'lf-alarme-sino', 'aria-hidden': 'true' }, '🔔'),
    h('div', { class: 'lf-alarme-texto' }, h('strong', {}, texto), semSom),
    h('a', { class: 'lf-alarme-btn', href: destino, onclick: () => silenciar(true) }, 'Ver pedido'),
    h('button', { type: 'button', class: 'lf-alarme-btn vazado', onclick: () => silenciar(true) }, 'Silenciar'));
  if (faixa) faixa.replaceWith(nova);
  else document.body.append(nova);
  faixa = nova;
}

function atualizar() {
  desenharFaixa();
  if (tocando.size && !laco) {
    tocarMelodia();
    laco = setInterval(tocarMelodia, CICLO_MS);
    piscar = setInterval(() => {
      document.title = document.title === tituloOriginal ? `🔔 ${tocando.size} pedido(s) novo(s)` : tituloOriginal;
    }, 1000);
  }
  if (!tocando.size && laco) {
    clearInterval(laco);
    clearInterval(piscar);
    laco = piscar = null;
    document.title = tituloOriginal;
  }
}

function silenciar(avisarAbas) {
  guardarSilenciados(tocando.keys());
  tocando.clear();
  atualizar();
  if (avisarAbas) canal?.postMessage('silenciar');
}
if (canal) canal.onmessage = (m) => { if (m.data === 'silenciar') silenciar(false); };

/** Liga o alarme nesta tela. Só para quem cuida dos pedidos (caixa, gerente, dono). */
export function ligarAlarmePedidos(can) {
  if (!can('pedido.gerenciar')) return;
  ouvirPedidos({
    // abriu a tela ou voltou a rede: o que chegou e ninguém atendeu volta a tocar
    async open() {
      try {
        const { rows } = await get('/menu/orders', { status: 'pending', pageSize: 50 });
        const calados = silenciados();
        const antes = tocando.size;
        for (const o of rows) if (!calados.has(o.id)) tocando.set(o.id, o);
        if (tocando.size !== antes) atualizar();
      } catch { /* sem rede: o próximo open tenta de novo */ }
    },
    message(e) {
      if (e.type === 'new' && e.status === 'pending') tocando.set(e.id, e);
      else if (tocando.has(e.id) && e.status !== 'pending') tocando.delete(e.id);
      else return;
      atualizar();
    },
  });
}
