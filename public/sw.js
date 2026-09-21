/* Service worker do LojaFlow: telas e assets ficam no aparelho, para o app
   abrir sem servidor por perto. Os dados vêm do IndexedDB (ver js/offline.js). */
importScripts('/precache.js'); // define self.PRECACHE e self.CACHE_VERSION

const CACHE = `lojaflow-${self.CACHE_VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // um asset ausente não pode derrubar a instalação inteira
    await Promise.all(self.PRECACHE.map((url) => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // dados: quem cuida é o app

  // navegação: tenta a rede e cai para a versão guardada da própria página
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        (await caches.open(CACHE)).put(url.pathname, res.clone());
        return res;
      } catch {
        return (await caches.match(url.pathname))
          || (await caches.match('/index.html'))
          || new Response('Sem conexão e esta tela ainda não foi aberta neste aparelho.',
            { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // Código do app (js/css do LojaFlow): rede primeiro, cache como rede de
  // segurança. Cache primeiro segurava correção de estilo por um recarregamento
  // inteiro — atualização precisa chegar assim que houver conexão.
  const doApp = /\.(?:css|js|webmanifest)$/.test(url.pathname)
    && !url.pathname.startsWith('/assets/');
  if (doApp) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req)) || new Response('', { status: 504 });
      }
    })());
    return;
  }

  // tema, fontes e imagens não mudam: cache primeiro, e o que vier da rede fica guardado
  e.respondWith((async () => {
    const guardado = await caches.match(req);
    if (guardado) return guardado;
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      return new Response('', { status: 504 });
    }
  })());
});
