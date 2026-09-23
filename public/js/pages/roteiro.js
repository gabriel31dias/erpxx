// Roteiro: vendedor, recorrência e clientes em ordem, com o trajeto no mapa.
import { get, post, put } from '../api.js';
import { pageTitle } from '../shell.js';
import { criarMapa, enquadrar, esc, pinoNumerado } from '../mapa.js';
import { mount, card, debounce, field, h, icon, input, refreshIcons, select, textarea, toast } from '../ui.js';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Ordem por vizinho mais próximo a partir do primeiro cliente (clientes sem mapa ficam no fim). */
function otimizar(paradas) {
  const comGeo = paradas.filter((p) => p.lat != null);
  const semGeo = paradas.filter((p) => p.lat == null);
  if (comGeo.length < 3) return paradas;
  const d2 = (a, b) => (a.lat - b.lat) ** 2 + ((a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180)) ** 2;
  const rota = [comGeo.shift()];
  while (comGeo.length) {
    const atual = rota[rota.length - 1];
    let melhor = 0;
    comGeo.forEach((p, i) => { if (d2(atual, p) < d2(atual, comGeo[melhor])) melhor = i; });
    rota.push(comGeo.splice(melhor, 1)[0]);
  }
  return [...rota, ...semGeo];
}

export default async function render({ content, can }) {
  const id = new URLSearchParams(location.search).get('id');
  const editavel = can('roteiro.gerenciar');
  const podeLocalizar = can('cliente.gerenciar');
  const [{ sellers }, r] = await Promise.all([get('/field/live'), id ? get(`/routes/${id}`) : null]);
  if (!sellers.length && !r) {
    mount(content, pageTitle('Novo roteiro'),
      card(null, h('p', { class: 'mb-0' }, 'Cadastre um vendedor externo em "Vendedores externos" antes de criar roteiros.')));
    return;
  }

  // clientes do roteiro, na ordem: { id, name, address, lat, lng }
  let paradas = (r?.stops ?? []).map((s) => ({ ...s.customer }));

  const f = {
    name: input({ value: r?.name ?? '', required: true, placeholder: 'Ex.: Zona Norte — segunda', disabled: !editavel }),
    seller: select(sellers.map((s) => ({ value: s.id, label: s.name, selected: s.id === r?.sellerId })), { disabled: !editavel }),
    recurrence: select([
      { value: 'ALWAYS', label: 'Sempre (segunda a sábado)', selected: !r || r.recurrence === 'ALWAYS' },
      { value: 'WEEKDAYS', label: 'Dias da semana', selected: r?.recurrence === 'WEEKDAYS' },
      { value: 'ONCE', label: 'Esporádico (uma data)', selected: r?.recurrence === 'ONCE' },
    ], { disabled: !editavel }),
    date: input({ type: 'date', value: r?.date ?? '', disabled: !editavel }),
    startDate: input({ type: 'date', value: r?.startDate ?? '', disabled: !editavel }),
    endDate: input({ type: 'date', value: r?.endDate ?? '', disabled: !editavel }),
    notes: textarea({ value: r?.notes ?? '', rows: 2, disabled: !editavel }),
    active: select([
      { value: 'true', label: 'Ativo', selected: r?.active !== false },
      { value: 'false', label: 'Inativo', selected: r?.active === false },
    ], { disabled: !editavel }),
  };
  const dias = DIAS.map((d, i) => {
    const cb = h('input', { type: 'checkbox', class: 'btn-check', id: `dia-${i}`, checked: !!(r && r.weekdays & (1 << i)), disabled: !editavel });
    return { cb, el: h('span', {}, cb, h('label', { class: 'btn btn-sm btn-outline-primary me-1 mb-1', for: `dia-${i}` }, d)) };
  });
  const campoDias = h('div', { class: 'col-12 col-md-6' }, h('div', { class: 'form-label' }, 'Dias da visita'), dias.map((d) => d.el));
  const campoData = field('Data da visita', f.date, { col: 'col-6 col-md-3' });
  const alternar = () => {
    campoDias.classList.toggle('d-none', f.recurrence.value !== 'WEEKDAYS');
    campoData.classList.toggle('d-none', f.recurrence.value !== 'ONCE');
  };
  f.recurrence.onchange = alternar;

  // ---------- mapa ----------
  const mapaEl = h('div', { class: 'lf-map' });
  let map;
  let camada;
  function desenharMapa() {
    if (!map) return;
    camada?.remove();
    camada = window.L.layerGroup().addTo(map);
    const pontos = paradas.map((p, i) => (p.lat != null ? [p.lat, p.lng, i] : null)).filter(Boolean);
    pontos.forEach(([lat, lng, i]) => {
      window.L.marker([lat, lng], { icon: pinoNumerado(i + 1, '#363afe') })
        .bindPopup(`<strong>${i + 1}. ${esc(paradas[i].name)}</strong><br>${esc(paradas[i].address)}`).addTo(camada);
    });
    if (pontos.length > 1) window.L.polyline(pontos.map(([a, b]) => [a, b]), { color: '#363afe', weight: 3, opacity: 0.6, dashArray: '6 6' }).addTo(camada);
    enquadrar(map, pontos.map(([a, b]) => [a, b]));
  }

  // ---------- lista de clientes ----------
  const listaEl = h('ol', { class: 'list-group list-group-numbered mb-0' });
  function desenharLista() {
    listaEl.replaceChildren(...(paradas.length ? paradas.map((p, i) => h('li', { class: 'list-group-item d-flex align-items-start gap-2' },
      h('div', { class: 'flex-grow-1' },
        h('div', { class: 'f-w-600' }, p.name),
        h('small', { class: 'txt-secondary d-block' }, p.address || 'Sem endereço'),
        p.lat == null ? h('small', { class: 'text-warning d-block' }, 'Sem localização no mapa',
          podeLocalizar && p.address ? h('button', {
            class: 'btn btn-link btn-sm p-0 ms-2', type: 'button',
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                const g = await post(`/customers/${p.id}/geo/lookup`);
                Object.assign(p, { lat: g.lat, lng: g.lng });
                toast('Localização encontrada. Confira o pino no mapa.');
                desenhar();
              } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
            },
          }, 'Localizar pelo endereço') : null) : null),
      editavel ? h('div', { class: 'btn-group btn-group-sm' },
        h('button', { class: 'btn btn-light', type: 'button', disabled: i === 0, 'aria-label': 'Subir', onclick: () => mover(i, -1) }, '↑'),
        h('button', { class: 'btn btn-light', type: 'button', disabled: i === paradas.length - 1, 'aria-label': 'Descer', onclick: () => mover(i, 1) }, '↓'),
        h('button', { class: 'btn btn-light text-danger', type: 'button', 'aria-label': `Tirar ${p.name}`, onclick: () => { paradas.splice(i, 1); desenhar(); } }, '×'))
        : null))
      : [h('li', { class: 'list-group-item txt-secondary' }, 'Nenhum cliente no roteiro ainda.')]));
  }
  const mover = (i, d) => { [paradas[i], paradas[i + d]] = [paradas[i + d], paradas[i]]; desenhar(); };
  const desenhar = () => { desenharLista(); desenharMapa(); };

  // busca de clientes para adicionar
  const busca = input({ type: 'search', class: 'form-control', placeholder: 'Adicionar cliente: nome, telefone ou CPF' });
  const sugestoes = h('div', { class: 'list-group mt-1' });
  busca.oninput = debounce(async () => {
    const q = busca.value.trim();
    if (!q) return sugestoes.replaceChildren();
    const { rows } = await get('/customers', { q, pageSize: 8, status: 'ativo' });
    sugestoes.replaceChildren(...rows.filter((c) => !paradas.some((p) => p.id === c.id)).map((c) => h('button', {
      class: 'list-group-item list-group-item-action', type: 'button',
      onclick: () => {
        paradas.push({ id: c.id, name: c.name, address: c.address, lat: c.lat, lng: c.lng });
        busca.value = '';
        sugestoes.replaceChildren();
        desenhar();
      },
    }, h('strong', {}, c.name), h('small', { class: 'd-block txt-secondary' }, c.address || c.phone || ''))));
  }, 250);

  const otimizarBtn = h('button', { class: 'btn btn-outline-secondary btn-sm', type: 'button' }, 'Otimizar ordem');
  otimizarBtn.onclick = () => { paradas = otimizar(paradas); desenhar(); toast('Ordem ajustada pela proximidade, a partir do 1º cliente.'); };

  const salvar = h('button', { class: 'btn btn-primary' }, id ? 'Salvar roteiro' : 'Criar roteiro');
  salvar.onclick = async () => {
    salvar.disabled = true;
    try {
      const body = {
        name: f.name.value.trim(), sellerId: f.seller.value, recurrence: f.recurrence.value,
        weekdays: dias.reduce((m, d, i) => (d.cb.checked ? m | (1 << i) : m), 0),
        date: f.date.value || undefined, startDate: f.startDate.value || undefined, endDate: f.endDate.value || undefined,
        notes: f.notes.value.trim() || undefined, active: f.active.value === 'true',
        customerIds: paradas.map((p) => p.id),
      };
      const saved = id ? await put(`/routes/${id}`, body) : await post('/routes', body);
      toast('Roteiro salvo.');
      if (!id) location.href = `/roteiro.html?id=${saved.id}`;
    } catch (e) { toast(e.message, 'error'); } finally { salvar.disabled = false; }
  };

  mount(content,
    pageTitle(r ? r.name : 'Novo roteiro', h('a', { class: 'btn btn-light', href: '/roteiros.html' }, 'Voltar'), editavel ? salvar : null),
    card('Roteiro', h('div', { class: 'row g-3' },
      field('Nome', f.name, { col: 'col-12 col-md-4' }),
      field('Vendedor', f.seller, { col: 'col-12 col-md-4' }),
      field('Quando', f.recurrence, { col: 'col-6 col-md-2' }),
      field('Situação', f.active, { col: 'col-6 col-md-2' }),
      campoDias, campoData,
      field('Válido de', f.startDate, { col: 'col-6 col-md-3', help: 'Opcional.' }),
      field('até', f.endDate, { col: 'col-6 col-md-3', help: 'Opcional.' }),
      field('Observações para o vendedor', f.notes, { col: 'col-12' }))),
    h('div', { class: 'row' },
      h('div', { class: 'col-12 col-xl-5' }, card('Clientes, na ordem da visita', h('div', {},
        editavel ? h('div', { class: 'mb-3' }, busca, sugestoes) : null,
        listaEl), editavel ? otimizarBtn : null)),
      h('div', { class: 'col-12 col-xl-7' }, card('Trajeto', mapaEl))));

  alternar();
  map = criarMapa(mapaEl);
  desenhar();
  refreshIcons(content);
}
