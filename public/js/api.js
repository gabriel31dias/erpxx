// Cliente HTTP. O header X-Requested-With é o que libera as mutações no backend
// (proteção CSRF: formulário de outro site não consegue enviá-lo).
import { cacheGet, cachePut, filaAdicionar, marcarOffline, marcarOnline, podeEnfileirar } from './offline.js';

const HEADERS = { 'Content-Type': 'application/json', 'X-Requested-With': 'lojaflow' };

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Chave de idempotência gerada no aparelho: reenvio nunca vira segunda venda. */
export const novaChave = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function qs(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export async function api(path, { method = 'GET', body, query, raw } = {}) {
  const url = `/api${path}${qs(query)}`;
  const leitura = method === 'GET';

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: HEADERS,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // sem rede: leitura cai no que está guardado no aparelho, escrita vai para a fila
    if (leitura) {
      const guardado = await cacheGet(url);
      if (guardado) {
        marcarOffline(guardado.at);
        return guardado.data;
      }
      throw new ApiError('Sem conexão e esta tela ainda não foi aberta neste aparelho.', 0);
    }
    const regra = podeEnfileirar(method, path);
    if (!regra) throw new ApiError('Esta ação precisa de conexão com o servidor.', 0);
    const id = await filaAdicionar({ metodo: method, path, body, label: regra.label });
    marcarOffline();
    document.dispatchEvent(new CustomEvent('lf:enfileirado'));
    return { ok: true, offline: true, filaId: id };
  }

  marcarOnline();

  if (res.status === 401 && !location.pathname.startsWith('/login')) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    throw new ApiError('Sessão expirada.', 401);
  }
  const type = res.headers.get('content-type') || '';
  if (raw || !type.includes('application/json')) {
    const text = await res.text();
    if (!res.ok) throw new ApiError(text || 'Erro inesperado.', res.status);
    return text;
  }
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.message || 'Erro inesperado.', res.status);
  if (leitura) cachePut(url, data);
  return data;
}

export const get = (path, query) => api(path, { query });
export const post = (path, body) => api(path, { method: 'POST', body });
export const patch = (path, body) => api(path, { method: 'PATCH', body });
export const put = (path, body) => api(path, { method: 'PUT', body });
export const del = (path) => api(path, { method: 'DELETE' });
export const getText = (path, query) => api(path, { query, raw: true });

/** foto de celular passa fácil dos 3 MB: reduz para 1600px em WEBP (mantém transparência do logo) */
async function shrink(file) {
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    if (scale === 1 && file.size <= 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/webp', 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // formato que o navegador não abre (ex.: HEIC): o servidor responde com a mensagem certa
  }
}

/** Foto do cardápio (multipart vai direto no fetch: o cliente acima só manda JSON). Devolve a URL pública. */
export async function uploadImage(file) {
  const form = new FormData();
  form.append('file', await shrink(file), 'imagem');
  const res = await fetch('/api/menu/images', {
    method: 'POST', body: form, credentials: 'same-origin', headers: { 'X-Requested-With': 'lojaflow' },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 413) throw new ApiError('Imagem muito grande. Envie uma de até 3 MB.', 413);
  if (!res.ok) throw new ApiError(data.message || 'Falha ao enviar a imagem.', res.status);
  return data.url;
}
