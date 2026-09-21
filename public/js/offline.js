/**
 * Camada offline: guarda no aparelho a última resposta de cada GET e enfileira
 * as alterações feitas sem conexão para reenviar quando a rede voltar.
 * ponytail: IndexedDB na mão (~70 linhas) em vez de Dexie/Workbox — são duas
 * tabelas e uma fila em ordem.
 *
 * No PDV isso importa mais que na agenda: a venda sai com uma chave de
 * idempotência gerada no aparelho, então reenviar a fila nunca duplica venda.
 */
const DB_NAME = 'lojaflow';
const DB_VERSION = 1;
const CACHE_STORE = 'cache';
const QUEUE_STORE = 'queue';

/** Só estas rotas podem ser salvas offline; o resto exige servidor. */
const FILA_PERMITIDA = [
  { metodo: 'POST', re: /^\/sales$/, label: 'Venda do PDV' },
  { metodo: 'POST', re: /^\/customers$/, label: 'Novo cliente' },
  { metodo: 'PATCH', re: /^\/customers\/[\w-]+$/, label: 'Edição de cliente' },
  { metodo: 'POST', re: /^\/stock\/move$/, label: 'Movimentação de estoque' },
  { metodo: 'POST', re: /^\/stock\/adjust$/, label: 'Ajuste de estoque' },
  { metodo: 'POST', re: /^\/cash\/sessions\/[\w-]+\/sangria$/, label: 'Sangria' },
  { metodo: 'POST', re: /^\/cash\/sessions\/[\w-]+\/suprimento$/, label: 'Suprimento' },
];

export const podeEnfileirar = (metodo, path) =>
  FILA_PERMITIDA.find((r) => r.metodo === metodo && r.re.test(path)) || null;

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(CACHE_STORE)) d.createObjectStore(CACHE_STORE);
      if (!d.objectStoreNames.contains(QUEUE_STORE)) d.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, modo, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, modo);
    const req = fn(t.objectStore(store));
    t.onerror = () => reject(t.error);
    if (req) req.onsuccess = () => resolve(req.result);
    else t.oncomplete = () => resolve();
  });
}

// ---------- cache de leitura ----------
export const cachePut = (url, data) =>
  tx(CACHE_STORE, 'readwrite', (s) => s.put({ data, at: Date.now() }, url)).catch(() => {});
export const cacheGet = (url) => tx(CACHE_STORE, 'readonly', (s) => s.get(url)).catch(() => undefined);

// ---------- fila de escrita ----------
export const filaAdicionar = (item) =>
  tx(QUEUE_STORE, 'readwrite', (s) => s.add({ ...item, at: Date.now(), status: 'pendente' }));
export const filaListar = () => tx(QUEUE_STORE, 'readonly', (s) => s.getAll()).then((r) => r || []);
export const filaRemover = (id) => tx(QUEUE_STORE, 'readwrite', (s) => s.delete(id));
export const filaAtualizar = (item) => tx(QUEUE_STORE, 'readwrite', (s) => s.put(item));

export async function pendentes() {
  return (await filaListar()).filter((i) => i.status === 'pendente').length;
}

/** Vendas ainda não enviadas (aparecem marcadas na lista de vendas). */
export async function vendasNaFila() {
  return (await filaListar())
    .filter((i) => i.status === 'pendente' && i.metodo === 'POST' && i.path === '/sales')
    .map((i) => ({ id: `fila-${i.id}`, offline: true, ...i.body }));
}

let sincronizando = false;

/**
 * Reenvia a fila na ordem. Erro de rede para o processo (tenta de novo depois);
 * erro do servidor (estoque insuficiente, validação) marca o item para o
 * usuário resolver em Sincronização — nada é sobrescrito automaticamente.
 */
export async function sincronizar() {
  if (sincronizando || !navigator.onLine) return { enviados: 0, falhas: 0 };
  sincronizando = true;
  let enviados = 0;
  let falhas = 0;
  try {
    for (const item of (await filaListar()).sort((a, b) => a.id - b.id)) {
      if (item.status !== 'pendente') continue;
      let res;
      try {
        res = await fetch(`/api${item.path}`, {
          method: item.metodo,
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'lojaflow' },
          credentials: 'same-origin',
          body: JSON.stringify(item.body),
        });
      } catch {
        break; // caiu a rede de novo: mantém a fila e tenta na próxima
      }
      if (res.ok) {
        await filaRemover(item.id);
        enviados++;
      } else {
        let mensagem = `Erro ${res.status}`;
        try { mensagem = (await res.json()).message || mensagem; } catch { /* resposta sem json */ }
        await filaAtualizar({ ...item, status: 'falhou', error: mensagem });
        falhas++;
      }
    }
  } finally {
    sincronizando = false;
  }
  if (enviados || falhas) document.dispatchEvent(new CustomEvent('lf:sincronizado', { detail: { enviados, falhas } }));
  return { enviados, falhas };
}

let relogio = null;

/**
 * Reenvio automático enquanto houver fila. O evento 'online' do navegador só
 * cobre queda de rede do aparelho; quando quem cai é o servidor, ninguém avisa —
 * então a fila tenta sozinha de tempos em tempos.
 */
export function reenvioAutomatico(intervaloMs = 20000) {
  if (relogio) return;
  const tentar = async () => {
    if (!navigator.onLine) return;
    if (!(await pendentes())) return;
    await sincronizar();
  };
  tentar(); // ao abrir a tela: pode haver fila da noite anterior
  relogio = setInterval(tentar, intervaloMs);
}

/**
 * navigator.onLine só diz se o aparelho tem rede — não se o servidor responde.
 * Quem manda no aviso é ter servido dados do cache.
 */
export const estado = { semServidor: false, dadosDe: null };

export function marcarOffline(at) {
  estado.semServidor = true;
  if (at) estado.dadosDe = at;
  document.dispatchEvent(new CustomEvent('lf:offline', { detail: { at } }));
}

export function marcarOnline() {
  if (!estado.semServidor) return;
  estado.semServidor = false;
  document.dispatchEvent(new CustomEvent('lf:online'));
}
