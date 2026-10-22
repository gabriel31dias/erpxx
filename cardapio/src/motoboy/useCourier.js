import { useEffect, useRef, useState } from 'react';
import { BASE, courierApi } from '../lib/api';
import { ding } from '../garcom/useTables';

const PING_MS = 10_000;

/**
 * Entregas do app do motoboy. Chamado sempre pelo AppProvider (regra dos hooks);
 * sem `courier` (cliente, garçom) não abre conexão, não pede GPS e não busca nada.
 */
export function useCourier(courier) {
  const [orders, setOrders] = useState({ store: null, available: [], mine: [] });
  const [live, setLive] = useState(false);
  const [position, setPosition] = useState(null); // { lat, lng, accuracy }
  const [gpsError, setGpsError] = useState('');
  const [methods, setMethods] = useState([]);
  const known = useRef(new Set()); // disponíveis já vistos: só o novo toca
  const queue = useRef([]); // posições ainda não enviadas (sem sinal, guarda)

  const refreshOrders = () =>
    courierApi.orders().then((r) => {
      const fresh = r.available.filter((o) => !known.current.has(o.id));
      if (known.current.size && fresh.length) ding();
      known.current = new Set(r.available.map((o) => o.id));
      setOrders(r);
      return r;
    });

  useEffect(() => {
    if (!courier) return;
    courierApi.paymentMethods().then((r) => setMethods(r.rows)).catch(() => {});
    // tempo real: pedido pronto, pego por outro motoboy ou cancelado recarrega a lista
    const events = new EventSource(`${BASE}/api/courier/events`, { withCredentials: true });
    events.onopen = () => {
      setLive(true);
      refreshOrders().catch(() => {});
    };
    events.onerror = () => setLive(false);
    events.onmessage = () => refreshOrders().catch(() => {});
    return () => events.close();
  }, [courier]);

  // posição: o navegador entrega quando muda; manda em lote a cada 10 s (com o app aberto)
  useEffect(() => {
    if (!courier) return;
    if (!navigator.geolocation) return setGpsError('Este aparelho não informa a localização.');
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) };
        setPosition(pos);
        setGpsError('');
        queue.current.push({ ...pos, at: new Date(p.timestamp).toISOString() });
        if (queue.current.length > 400) queue.current.splice(0, queue.current.length - 400);
      },
      (e) => setGpsError(e.code === 1 ? 'Libere a localização para a loja ver onde você está.' : 'Sem sinal de GPS.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    const flush = setInterval(() => {
      if (!queue.current.length) return;
      // um ponto a cada envio basta para o mapa; o último é o que vale
      const batch = queue.current.splice(0);
      courierApi.pings(batch.slice(-30)).catch(() => queue.current.unshift(...batch.slice(-30)));
    }, PING_MS);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearInterval(flush);
    };
  }, [courier]);

  // com entrega na mão a tela não apaga: com ela apagada o navegador para de mandar a posição
  const busy = orders.mine.length > 0;
  useEffect(() => {
    if (!courier || !busy || !('wakeLock' in navigator)) return;
    let lock = null;
    const take = () => navigator.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {});
    take();
    const again = () => document.visibilityState === 'visible' && take();
    document.addEventListener('visibilitychange', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      lock?.release().catch(() => {});
    };
  }, [courier, busy]);

  const after = (p) => p.then(async (r) => {
    await refreshOrders();
    return r;
  });

  return {
    deliveries: orders,
    courierLive: live,
    position,
    gpsError,
    payMethods: methods,
    refreshDeliveries: refreshOrders,
    acceptDelivery: (id) => after(courierApi.accept(id)),
    releaseDelivery: (id) => after(courierApi.release(id)),
    finishDelivery: (id, body) => after(courierApi.delivered(id, body)),
  };
}
