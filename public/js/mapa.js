// Mapa (Leaflet do tema + OpenStreetMap) e marcadores do roteiro/campo.
// Leaflet entra como script global na página (window.L); aqui só o que as telas repetem.

/** Situação da visita → rótulo e cor (as mesmas no mapa e nas listas). */
export const STATUS = {
  PENDING: { label: 'Pendente', color: '#8a94a6' },
  IN_PROGRESS: { label: 'Em atendimento', color: '#f0a500' },
  DONE: { label: 'Visitado', color: '#2e9e5b' },
  SKIPPED: { label: 'Justificado', color: '#4a7bd0' },
  MISSED: { label: 'Não visitado', color: '#d64545' },
};

export const OUTCOME = { VENDA: 'Venda', SEM_VENDA: 'Sem venda', FECHADO: 'Fechado', AUSENTE: 'Ausente' };

/** Centro de São Paulo: só até haver algum ponto para enquadrar. */
const INICIO = [-23.5505, -46.6333];

export function criarMapa(el, { zoom = 12 } = {}) {
  const map = window.L.map(el, { zoomControl: true }).setView(INICIO, zoom);
  // O OSM bloqueia tile sem Referer ("Access blocked"); a página usa Referrer-Policy
  // same-origin, então os tiles liberam só a origem (sem caminho nem query).
  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap', referrerPolicy: 'strict-origin-when-cross-origin',
  }).addTo(map);
  // o mapa nasce dentro de card ainda sem tamanho final
  setTimeout(() => map.invalidateSize(), 200);
  return map;
}

/** Pino numerado na cor da situação. */
export function pinoNumerado(numero, color) {
  return window.L.divIcon({
    className: 'lf-pin-wrap',
    html: `<span class="lf-pin" style="background:${color}">${numero}</span>`,
    iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14],
  });
}

/** Vendedor: iniciais num círculo; a borda diz há quanto tempo o app deu sinal. */
export function pinoVendedor(nome, visto) {
  const min = visto ? (Date.now() - new Date(visto).getTime()) / 60000 : Infinity;
  const cor = min <= 5 ? '#2e9e5b' : min <= 30 ? '#f0a500' : '#8a94a6';
  const iniciais = nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  return window.L.divIcon({
    className: 'lf-pin-wrap',
    html: `<span class="lf-seller" style="border-color:${cor}">${iniciais}</span>`,
    iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18],
  });
}

/** Texto seguro para popups (o Leaflet recebe HTML). */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function enquadrar(map, pontos) {
  const validos = pontos.filter((p) => p && p[0] != null && p[1] != null);
  if (validos.length === 1) map.setView(validos[0], 15);
  else if (validos.length) map.fitBounds(validos, { padding: [30, 30], maxZoom: 16 });
}

/** "há 3 min" / "há 2 h" a partir de um instante ISO. */
export function haQuanto(iso) {
  if (!iso) return 'sem sinal';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} dia(s)`;
}
