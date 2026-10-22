// Entregas: onde está cada motoboy, o que ele leva e o que está pronto esperando. Ao vivo pelo
// SSE /api/deliveries/events (posição a cada ~10 s). Embaixo, o acerto: o que o motoboy entregou
// vira venda no caixa de quem acerta, na forma que ele informou.
import { get, patch, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { criarMapa, enquadrar, esc, haQuanto, pinoNumerado, pinoVendedor } from '../mapa.js';
import { card, confirmAction, fmtBRL, h, icon, mount, refreshIcons, toast } from '../ui.js';

const COR = { delivering: '#2e9e5b', ready: '#f0a500', delivered: '#8a94a6' };

export default async function render({ content, can }) {
  const acerta = can('pedido.gerenciar');
  const formas = acerta ? (await get('/company/payment-methods')).rows : [];
  const nomeForma = (id) => formas.find((m) => m.id === id)?.name ?? 'Forma não informada';

  const aoVivo = h('span', { class: 'badge text-bg-secondary', role: 'status', 'aria-live': 'polite' }, 'Conectando…');
  const aviso = h('div');
  const mapaEl = h('div', { class: 'lf-map' });
  const lista = h('div', { class: 'd-grid gap-2' });
  const prontos = h('div');
  const acerto = h('div');

  mount(content,
    pageTitle('Entregas', h('a', { class: 'btn btn-outline-primary', href: '/motoboy/', target: '_blank' }, icon('smartphone', 16), ' App do motoboy')),
    aviso,
    h('div', { class: 'row' },
      h('div', { class: 'col-12 col-xl-8' }, card(null, h('div', {},
        h('div', { class: 'd-flex flex-wrap align-items-center justify-content-between gap-2 mb-2' },
          h('div', { class: 'd-flex flex-wrap gap-3 f-12' },
            h('span', {}, h('span', { class: 'lf-dot', style: `background:${COR.delivering}` }), 'Em rota'),
            h('span', {}, h('span', { class: 'lf-dot', style: `background:${COR.ready}` }), 'Pronto, sem motoboy'),
            h('span', {}, '🏪 Loja')),
          aoVivo),
        mapaEl))),
      h('div', { class: 'col-12 col-xl-4' }, card('Motoboys', lista), card('Prontos esperando motoboy', prontos))),
    card('Acerto do motoboy', acerto));

  const map = criarMapa(mapaEl);
  const camada = window.L.layerGroup().addTo(map);
  const trajeto = window.L.layerGroup().addTo(map);
  const motos = new Map(); // id -> marcador (anda sozinho com o evento de posição)
  let dados = { store: null, couriers: [], orders: [] };
  let foco = null; // motoboy selecionado: mostra o trajeto do dia
  let marcando = null; // pedido esperando o clique no mapa para ganhar ponto
  let enquadrado = false;

  const pedidosDe = (id) => dados.orders.filter((o) => o.courierId === id && o.status === 'delivering');
  const popupPedido = (o) => [
    `<strong>#${o.number} · ${esc(o.customerName)}</strong>`, esc(o.address),
    o.paymentMethod === 'pix' ? 'Pago no Pix' : `Cobrar ${fmtBRL(o.totalCents)}`,
    o.geoSource === 'approx' ? '⚠️ ponto aproximado' : '',
  ].filter(Boolean).join('<br>');

  function desenhar() {
    camada.clearLayers();
    motos.clear();
    const pontos = [];
    if (dados.store) {
      window.L.marker([dados.store.lat, dados.store.lng], {
        icon: window.L.divIcon({ className: 'lf-pin-wrap', html: '<span style="font-size:22px">🏪</span>', iconSize: [26, 26], iconAnchor: [13, 13] }),
      }).bindPopup('Loja').addTo(camada);
      pontos.push([dados.store.lat, dados.store.lng]);
    }
    for (const o of dados.orders) {
      if (o.lat == null || o.status === 'delivered') continue;
      if (foco && o.courierId !== foco) continue;
      window.L.marker([o.lat, o.lng], { icon: pinoNumerado(o.number, COR[o.status] ?? COR.ready) }).bindPopup(popupPedido(o)).addTo(camada);
      pontos.push([o.lat, o.lng]);
    }
    for (const c of dados.couriers) {
      if (c.lat == null || (foco && c.id !== foco)) continue;
      const m = window.L.marker([c.lat, c.lng], { icon: pinoVendedor(c.name, c.at), zIndexOffset: 1000 })
        .bindPopup(() => `<strong>${esc(c.name)}</strong><br>Último sinal ${haQuanto(c.at)}<br>${pedidosDe(c.id).length} entrega(s) com ele`)
        .addTo(camada);
      motos.set(c.id, m);
      pontos.push([c.lat, c.lng]);
    }
    if (!enquadrado && pontos.length) { enquadrar(map, pontos); enquadrado = true; }

    lista.replaceChildren(...(dados.couriers.length ? dados.couriers.map((c) => h('div', {
      class: `card mb-0 lf-campo-vendedor${foco === c.id ? ' is-on' : ''}`, role: 'button', onclick: () => selecionar(c),
    }, h('div', { class: 'card-body p-3' },
      h('div', { class: 'd-flex justify-content-between align-items-center' },
        h('strong', {}, c.name), h('small', { class: 'txt-secondary' }, haQuanto(c.at))),
      h('div', { class: 'f-12 mt-1' }, pedidosDe(c.id).length ? `${pedidosDe(c.id).length} entrega(s) em rota` : 'Livre'),
      foco === c.id && pedidosDe(c.id).length
        ? h('ul', { class: 'mt-2 mb-0 ps-3 f-12' }, pedidosDe(c.id).map((o) => h('li', {}, `#${o.number} · ${o.customerName}`,
          o.lat == null ? h('span', { class: 'text-warning' }, ' (sem ponto no mapa)') : null)))
        : null)))
      : [h('p', { class: 'txt-secondary mb-0' }, 'Nenhum motoboy. Cadastre em Equipe e permissões com o perfil Motoboy.')]));

    const livres = dados.orders.filter((o) => o.status === 'ready');
    prontos.replaceChildren(...(livres.length ? livres.map((o) => h('div', { class: 'd-flex justify-content-between align-items-center border-bottom py-2 gap-2' },
      h('div', { class: 'f-12' }, h('strong', {}, `#${o.number} · ${o.customerName}`), h('div', { class: 'txt-secondary' }, o.address)),
      o.lat == null ? botaoMarcar(o) : h('small', { class: 'txt-secondary text-nowrap' }, o.geoSource === 'approx' ? 'ponto aproximado' : '')))
      : [h('p', { class: 'txt-secondary mb-0 f-12' }, 'Nada pronto esperando.')]));

    // em rota sem ponto: o motoboy vai pelo endereço; o caixa pode marcar no mapa
    const semPonto = dados.orders.filter((o) => o.lat == null && o.status === 'delivering');
    aviso.replaceChildren(...(semPonto.length ? [h('div', { class: 'alert alert-warning d-flex flex-wrap align-items-center gap-2 py-2' },
      h('span', { class: 'me-auto' }, `${semPonto.length} entrega(s) sem ponto no mapa: ${semPonto.map((o) => `#${o.number}`).join(', ')}`),
      ...semPonto.map(botaoMarcar))] : []));

    desenharAcerto();
    refreshIcons(content);
  }

  function botaoMarcar(o) {
    return h('button', {
      type: 'button', class: `btn btn-sm ${marcando === o.id ? 'btn-primary' : 'btn-outline-primary'} text-nowrap`,
      onclick: () => {
        marcando = marcando === o.id ? null : o.id;
        mapaEl.style.cursor = marcando ? 'crosshair' : '';
        if (marcando) toast(`Clique no mapa onde fica a entrega do pedido #${o.number}.`);
        desenhar();
      },
    }, marcando === o.id ? 'Clique no mapa…' : `Marcar #${o.number}`);
  }

  map.on('click', async (ev) => {
    if (!marcando) return;
    const id = marcando;
    marcando = null;
    mapaEl.style.cursor = '';
    try {
      await patch(`/deliveries/orders/${id}/geo`, { lat: ev.latlng.lat, lng: ev.latlng.lng });
      toast('Ponto da entrega salvo.');
      carregar();
    } catch (e) { toast(e.message, 'error'); }
  });

  function desenharAcerto() {
    const feitos = dados.orders.filter((o) => o.status === 'delivered');
    if (!feitos.length) {
      acerto.replaceChildren(h('p', { class: 'txt-secondary mb-0' }, 'Nenhuma entrega esperando acerto.'));
      return;
    }
    const porMotoboy = new Map();
    for (const o of feitos) porMotoboy.set(o.courierId, [...(porMotoboy.get(o.courierId) ?? []), o]);
    acerto.replaceChildren(...[...porMotoboy].map(([id, pedidos]) => {
      const nome = dados.couriers.find((c) => c.id === id)?.name ?? 'Motoboy';
      const total = pedidos.reduce((s, o) => s + o.totalCents, 0);
      const porForma = new Map();
      for (const o of pedidos) {
        const forma = o.paymentMethod === 'pix' ? 'Pix (pago no cardápio)' : nomeForma(o.courierPaymentMethodId);
        porForma.set(forma, (porForma.get(forma) ?? 0) + o.totalCents);
      }
      const lancar = h('button', { type: 'button', class: 'btn btn-success btn-sm' }, `Lançar ${pedidos.length} venda(s)`);
      lancar.onclick = async () => {
        const ok = await confirmAction(`Lançar no seu caixa as ${pedidos.length} entrega(s) de ${nome}, total ${fmtBRL(total)}?`,
          { title: 'Acerto do motoboy', okLabel: 'Lançar', danger: false });
        if (!ok) return;
        lancar.disabled = true;
        try {
          const r = await post('/menu/couriers/settle', { orderIds: pedidos.map((o) => o.id) });
          toast(`${r.settled} venda(s) lançada(s): ${fmtBRL(r.totalCents)}.`);
          carregar();
        } catch (e) { toast(e.message, 'error'); lancar.disabled = false; }
      };
      return h('div', { class: 'border rounded p-3 mb-2' },
        h('div', { class: 'd-flex flex-wrap justify-content-between align-items-center gap-2 mb-2' },
          h('strong', {}, `${nome} · ${fmtBRL(total)}`), acerta ? lancar : h('small', { class: 'txt-secondary' }, 'O caixa ou gerente lança.')),
        h('div', { class: 'd-flex flex-wrap gap-3 f-12 mb-2' }, [...porForma].map(([f, v]) => h('span', {}, `${f}: `, h('strong', {}, fmtBRL(v))))),
        h('div', { class: 'table-responsive' }, h('table', { class: 'table table-sm mb-0 f-12' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Pedido'), h('th', {}, 'Cliente'), h('th', {}, 'Entregue'), h('th', {}, 'Forma'), h('th', { class: 'text-end' }, 'Total'))),
          h('tbody', {}, pedidos.map((o) => h('tr', {},
            h('td', {}, `#${o.number}`), h('td', {}, o.customerName),
            h('td', {}, new Date(o.deliveredAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })),
            h('td', {}, o.paymentMethod === 'pix' ? 'Pix' : nomeForma(o.courierPaymentMethodId),
              o.courierReceivedCents ? ` (recebeu ${fmtBRL(o.courierReceivedCents)}, troco ${fmtBRL(o.courierReceivedCents - o.totalCents)})` : ''),
            h('td', { class: 'text-end' }, fmtBRL(o.totalCents))))))));
    }));
  }

  async function selecionar(c) {
    foco = foco === c.id ? null : c.id;
    enquadrado = false;
    trajeto.clearLayers();
    if (foco) {
      const { rows } = await get('/deliveries/track', { userId: c.id });
      if (rows.length > 1) window.L.polyline(rows.map((p) => [p.lat, p.lng]), { color: '#363afe', weight: 4, opacity: 0.7 }).addTo(trajeto);
    }
    desenhar();
  }

  async function carregar() {
    try {
      dados = await get('/deliveries/live');
      desenhar();
    } catch (e) { toast(e.message, 'error'); }
  }

  // posição nova só move o marcador; mudança de pedido recarrega tudo
  let espera = null;
  const recarregar = () => { clearTimeout(espera); espera = setTimeout(carregar, 300); };
  const estado = (texto, kind) => { aoVivo.textContent = texto; aoVivo.className = `badge text-bg-${kind}`; };
  const fonte = new EventSource('/api/deliveries/events');
  fonte.onopen = () => { estado('● Ao vivo', 'success'); carregar(); };
  fonte.onerror = () => estado('Reconectando…', 'warning');
  fonte.onmessage = (ev) => {
    const e = JSON.parse(ev.data);
    if (e.type !== 'courier') return recarregar();
    const c = dados.couriers.find((x) => x.id === e.id);
    if (!c) return recarregar(); // motoboy novo no mapa
    Object.assign(c, { lat: e.lat, lng: e.lng, at: e.at });
    const m = motos.get(e.id);
    if (m) m.setLatLng([e.lat, e.lng]).setIcon(pinoVendedor(c.name, c.at));
    else if (!foco || foco === c.id) desenhar();
  };
  addEventListener('pagehide', () => fonte.close(), { once: true });
  // "há 3 min" envelhece mesmo sem evento
  setInterval(() => { if (!document.hidden) desenhar(); }, 60_000);
}
