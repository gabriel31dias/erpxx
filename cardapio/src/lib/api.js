// API pública do cardápio (sem login). Em dev o Vite faz proxy de /api.
export const BASE = import.meta.env.VITE_API_URL || '';

/** cor do texto que lê bem sobre `hex` (fundo escolhido pela loja) */
export const onColor = (hex) => {
  const n = parseInt((hex || '#000000').slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#111111' : '#ffffff';
};

// o app roda sob um prefixo no domínio do ERP (vite.config.js `base`, ex.: /cardapio/)
export const pub = (path) => import.meta.env.BASE_URL + path;
// partes do caminho depois do prefixo: /cardapio/don-beef -> ['don-beef']; /garcom -> ['garcom']
export const pathParts = () => {
  const base = import.meta.env.BASE_URL;
  const p = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname;
  return p.split('/').filter(Boolean);
};

async function request(path, init) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
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

const withAssets = (d) => {
  for (const k of ['logo_url', 'banner_url', 'cover_url']) d.store[k] = asset(d.store[k]);
  for (const p of d.products) p.image_url = asset(p.image_url);
  return d;
};

export const fetchMenu = async (slug) => withAssets(await request(`/public/stores/${encodeURIComponent(slug)}`));
export const createOrder = (slug, body) =>
  request(`/public/stores/${encodeURIComponent(slug)}/orders`, { method: 'POST', body: JSON.stringify(body) });
export const fetchOrders = (ids) => request(`/public/orders?ids=${ids.join(',')}`);

// ---------- app do garçom: rotas do ERP com a sessão (cookie) do usuário ----------
// o header fecha o CSRF do ERP; o cookie é SameSite=strict, então a API precisa estar no mesmo site
const erp = (path, init = {}) =>
  request(path, { ...init, credentials: 'include', headers: { 'X-Requested-With': 'lojaflow' } });
const post = (path, body) => erp(path, { method: 'POST', body: JSON.stringify(body) });

export const waiterApi = {
  me: () => erp('/auth/me'),
  login: (email, password) => post('/auth/login', { email, password }),
  logout: () => post('/auth/logout', {}),
  catalog: async () => withAssets(await erp('/menu/catalog')),
  tables: () => erp('/menu/tables'),
  order: (table, body) => post(`/menu/tables/${table}/orders`, body),
  close: (table, body) => post(`/menu/tables/${table}/close`, body),
  transfer: (table, body) => post(`/menu/tables/${table}/transfer`, body),
  cancel: (orderId, reason) => post(`/menu/orders/${orderId}/cancel`, { reason }),
  cancelItem: (orderId, index, reason) => post(`/menu/orders/${orderId}/items/${index}/cancel`, { reason }),
  paymentMethods: () => erp('/company/payment-methods'),
};
