import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ponytail: tiles públicos do OpenStreetMap servem para começar; com muito acesso troque por um
// provedor com chave em VITE_TILE_URL (ex.: MapTiler, Stadia), no mesmo formato {z}/{x}/{y}
const TILES = import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const pin = (html, size = 28) => L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
const stopPin = (n) => pin(
  `<span style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:999px;background:var(--brand);color:#fff;font:800 13px 'Plus Jakarta Sans',sans-serif;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)">${n}</span>`,
);
const storePin = pin(
  `<span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:10px;background:#111;color:#fff;font-size:16px;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)">🏪</span>`, 30,
);
const mePin = pin(
  '<span style="display:block;width:18px;height:18px;border-radius:999px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25)"></span>', 18,
);

/**
 * Mapa da rota do motoboy: loja, onde ele está, paradas numeradas na ordem e o traçado.
 * Enquadra quando as paradas mudam (não a cada passo do motoboy, senão o mapa não para quieto).
 */
export function DeliveryMap({ store, me, stops, path, className = '' }) {
  const el = useRef(null);
  const map = useRef(null);
  const layers = useRef(null);
  const meMarker = useRef(null);

  useEffect(() => {
    map.current = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([-23.5505, -46.6333], 13);
    L.tileLayer(TILES, { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map.current);
    layers.current = L.layerGroup().addTo(map.current);
    setTimeout(() => map.current?.invalidateSize(), 150);
    return () => {
      map.current.remove();
      map.current = null;
    };
  }, []);

  // enquadra de novo quando as paradas mudam ou quando a posição do motoboy chega pela primeira vez
  const key = stops.map((s) => s.id).join(',') + (path?.length || 0) + (me ? 'me' : '');
  useEffect(() => {
    const g = layers.current;
    g.clearLayers();
    if (path?.length > 1) L.polyline(path, { color: '#2563eb', weight: 5, opacity: 0.8 }).addTo(g);
    if (store) L.marker([store.lat, store.lng], { icon: storePin }).addTo(g);
    stops.forEach((s, i) => L.marker([s.lat, s.lng], { icon: stopPin(i + 1) }).bindPopup(`#${s.number} · ${s.customerName}`).addTo(g));
    const pts = [...stops.map((s) => [s.lat, s.lng]), ...(me ? [[me.lat, me.lng]] : []), ...(!stops.length && store ? [[store.lat, store.lng]] : [])];
    if (pts.length === 1) map.current.setView(pts[0], 15);
    else if (pts.length) map.current.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
  }, [key, store?.lat]);

  useEffect(() => {
    if (!me) return;
    if (!meMarker.current) meMarker.current = L.marker([me.lat, me.lng], { icon: mePin, zIndexOffset: 1000 }).addTo(map.current);
    else meMarker.current.setLatLng([me.lat, me.lng]);
  }, [me?.lat, me?.lng]);

  return <div ref={el} className={`w-full bg-zinc-800 ${className}`} />;
}
