// API pública do cardápio (sem login). Em dev o Vite faz proxy de /api.
const BASE = import.meta.env.VITE_API_URL || '';

async function request(path, init) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new Error(msg || 'Não foi possível conectar. Tente novamente.');
  }
  return body;
}

// uploads vêm como /uploads/x.png: em produção a API pode estar em outro domínio
export const asset = (url) => (url && url.startsWith('/uploads/') ? BASE + url : url);

export const fetchMenu = async (slug) => {
  const d = await request(`/public/stores/${encodeURIComponent(slug)}`);
  for (const k of ['logo_url', 'banner_url', 'cover_url']) d.store[k] = asset(d.store[k]);
  for (const p of d.products) p.image_url = asset(p.image_url);
  return d;
};
export const createOrder = (slug, body) =>
  request(`/public/stores/${encodeURIComponent(slug)}/orders`, { method: 'POST', body: JSON.stringify(body) });
export const fetchOrders = (ids) => request(`/public/orders?ids=${ids.join(',')}`);
