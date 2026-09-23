// Mapa de campo: onde está cada vendedor e como anda a agenda do dia. Atualiza sozinho.
import { get } from '../api.js';
import { pageTitle } from '../shell.js';
import { criarMapa, enquadrar, esc, haQuanto, OUTCOME, pinoNumerado, pinoVendedor, STATUS } from '../mapa.js';
import { mount, card, fmtBRL, h, icon, input, refreshIcons, todayStr } from '../ui.js';

const ATUALIZA_MS = 20_000;

export default async function render({ content }) {
  const dia = input({ type: 'date', class: 'form-control', value: todayStr(), style: 'max-width:170px' });
  const atualizado = h('small', { class: 'txt-secondary' });
  const lista = h('div', { class: 'lf-campo-lista d-grid gap-2' });
  const mapaEl = h('div', { class: 'lf-map' });
  const legenda = h('div', { class: 'd-flex flex-wrap gap-3 mt-2 f-12' },
    Object.values(STATUS).map((s) => h('span', {}, h('span', { class: 'lf-dot', style: `background:${s.color}` }), s.label)),
    h('span', {}, '⚠️ fora do local'));

  mount(content,
    pageTitle('Mapa de campo', h('a', { class: 'btn btn-outline-primary', href: '/roteiros.html' }, icon('list', 16), ' Roteiros')),
    h('div', { class: 'row' },
      h('div', { class: 'col-12 col-xl-8' }, card(null, h('div', {},
        h('div', { class: 'd-flex flex-wrap align-items-center gap-2 mb-2' }, dia, atualizado), mapaEl, legenda))),
      h('div', { class: 'col-12 col-xl-4' }, card('Vendedores', lista))));

  const map = criarMapa(mapaEl);
  const camada = window.L.layerGroup().addTo(map);
  const trajeto = window.L.layerGroup().addTo(map);
  let foco = null; // vendedor selecionado: mostra só ele e o trajeto
  let enquadrado = false;
  let timer;

  async function carregar() {
    let data;
    try {
      data = await get('/field/live', { date: dia.value });
    } catch {
      atualizado.textContent = 'Sem conexão — tentando de novo…';
      return;
    }
    atualizado.textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    camada.clearLayers();
    const pontos = [];
    const visiveis = data.sellers.filter((s) => !foco || s.id === foco);

    for (const s of visiveis) {
      for (const p of s.stops) {
        if (p.customer.lat == null) continue;
        const st = STATUS[p.status] ?? STATUS.PENDING;
        const v = p.visit;
        const linhas = [
          `<strong>${p.order}. ${esc(p.customer.name)}</strong>`,
          `${esc(s.name)}${p.routeName ? ` · ${esc(p.routeName)}` : ' · fora do roteiro'}`,
          `<span style="color:${st.color}">●</span> ${st.label}`,
          v?.checkInAt ? `Chegada ${esc(v.checkInAt.slice(11))}${v.checkOutAt ? ` · saída ${esc(v.checkOutAt.slice(11))}` : ''}` : '',
          v?.outcome ? `Resultado: ${OUTCOME[v.outcome] ?? v.outcome}` : '',
          v?.reason ? `Motivo: ${esc(v.reason)}` : '',
          v?.outOfRange ? `⚠️ Check-in a ${v.distanceM} m do cliente` : '',
          v?.mockLocation ? '⚠️ Localização simulada no aparelho' : '',
        ].filter(Boolean);
        window.L.marker([p.customer.lat, p.customer.lng], {
          icon: pinoNumerado(v?.outOfRange ? '!' : p.order, st.color),
        }).bindPopup(linhas.join('<br>')).addTo(camada);
        pontos.push([p.customer.lat, p.customer.lng]);
      }
      if (s.lastLat != null) {
        window.L.marker([s.lastLat, s.lastLng], { icon: pinoVendedor(s.name, s.lastSeenAt), zIndexOffset: 1000 })
          .bindPopup(`<strong>${esc(s.name)}</strong><br>Último sinal ${haQuanto(s.lastSeenAt)}`
            + `${s.lastAccuracy ? ` · precisão ${Math.round(s.lastAccuracy)} m` : ''}`)
          .addTo(camada);
        pontos.push([s.lastLat, s.lastLng]);
      }
    }
    if (!enquadrado && pontos.length) { enquadrar(map, pontos); enquadrado = true; }

    lista.replaceChildren(...(data.sellers.length ? data.sellers.map((s) => {
      const r = s.summary;
      const feitos = r.done + r.skipped;
      const pct = r.planned ? Math.round((Math.min(feitos, r.planned) / r.planned) * 100) : null;
      return h('div', {
        class: `card mb-0 lf-campo-vendedor${foco === s.id ? ' is-on' : ''}`,
        onclick: () => selecionar(s),
      }, h('div', { class: 'card-body p-3' },
        h('div', { class: 'd-flex justify-content-between align-items-center' },
          h('strong', {}, s.name), h('small', { class: 'txt-secondary' }, haQuanto(s.lastSeenAt))),
        h('div', { class: 'f-12 mt-1' },
          pct === null ? 'Sem roteiro na data' : `${feitos}/${r.planned} visitas · ${pct}%`,
          r.salesCount ? ` · ${r.salesCount} venda(s) ${fmtBRL(r.salesCents)}` : ''),
        pct === null ? null : h('div', { class: 'progress mt-2', style: 'height:6px' },
          h('div', { class: 'progress-bar bg-success', style: `width:${pct}%` })),
        h('div', { class: 'd-flex flex-wrap gap-2 mt-2 f-12' },
          [['IN_PROGRESS', r.inProgress], ['PENDING', r.pending], ['MISSED', r.missed], ['SKIPPED', r.skipped]]
            .filter(([, n]) => n).map(([k, n]) => h('span', {}, h('span', { class: 'lf-dot', style: `background:${STATUS[k].color}` }), `${n} ${STATUS[k].label.toLowerCase()}`)),
          r.outOfRange ? h('span', { class: 'text-danger' }, `⚠️ ${r.outOfRange} fora do local`) : null),
        foco === s.id ? h('ol', { class: 'mt-2 mb-0 ps-3 f-12' }, s.stops.map((p) => h('li', {},
          h('span', { class: 'lf-dot', style: `background:${(STATUS[p.status] ?? STATUS.PENDING).color}` }),
          p.customer.name, p.customer.lat == null ? h('span', { class: 'txt-secondary' }, ' (sem mapa)') : null))) : null));
    }) : [h('p', { class: 'txt-secondary mb-0' }, 'Nenhum vendedor externo ativo.')]));
  }

  async function selecionar(s) {
    foco = foco === s.id ? null : s.id;
    enquadrado = false;
    trajeto.clearLayers();
    if (foco) {
      const { rows } = await get('/field/track', { sellerId: s.id, date: dia.value });
      if (rows.length > 1) {
        window.L.polyline(rows.map((p) => [p.lat, p.lng]), { color: '#363afe', weight: 4, opacity: 0.7 }).addTo(trajeto);
      }
    }
    await carregar();
  }

  dia.onchange = () => { foco = null; enquadrado = false; trajeto.clearLayers(); carregar(); };
  await carregar();
  timer = setInterval(() => { if (!document.hidden) carregar(); }, ATUALIZA_MS);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  refreshIcons(content);
}
