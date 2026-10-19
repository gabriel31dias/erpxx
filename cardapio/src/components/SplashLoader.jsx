import React, { useEffect, useState } from 'react';
import { onColor, pathParts } from '../lib/api';

// placeholder do produto sem foto não conta: já vem com o app
const realImage = (url) => url && !url.endsWith('/placeholder.svg');
const TIMEOUT_MS = 10000; // rede lenta: abre mesmo sem todas as fotos
const FETCH_SHARE = 15; // % da barra para buscar o cardápio; o resto é das fotos

// cor de fundo da última visita: a abertura já nasce com ela, antes da API responder
const BG_KEY = `${(pathParts()[0] || '').toLowerCase()}:bg`;
const savedBg = () => {
  try { return localStorage.getItem(BG_KEY); } catch { return null; }
};

/**
 * Abertura do cardápio: fundo na cor da loja (padrão preto), logo e barra de progresso.
 * Enquanto a API responde a barra anda até FETCH_SHARE; depois acompanha as fotos
 * (logo, banner, capa e produtos), que ficam no cache do navegador para a home abrir pronta.
 */
export function SplashLoader({ store, products, onDone }) {
  const [loaded, setLoaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [logoOk, setLogoOk] = useState(false);

  useEffect(() => {
    if (!store) return;
    try { localStorage.setItem(BG_KEY, store.background_color); } catch { /* sem storage: só não lembra */ }
    const urls = [...new Set([store.logo_url, store.banner_url, store.cover_url, ...products.map((p) => p.image)].filter(realImage))];
    setTotal(urls.length);
    let n = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setTimeout(onDone, 350); // deixa a barra cheia aparecer
    };
    if (!urls.length) return finish();
    const imgs = urls.map((url) => {
      const img = new Image();
      img.onload = img.onerror = () => {
        n += 1;
        setLoaded(n);
        if (n === urls.length) finish();
      };
      img.src = url;
      return img;
    });
    const t = setTimeout(finish, TIMEOUT_MS);
    return () => {
      clearTimeout(t);
      for (const img of imgs) img.onload = img.onerror = null;
    };
  }, [store]);

  const pct = !store ? 6 : total ? FETCH_SHARE + ((100 - FETCH_SHARE) * loaded) / total : 100;
  const bg = store?.background_color || savedBg() || '#000000';
  const fg = onColor(bg);
  // barra na cor principal; se for igual ao fundo, some: usa a cor do texto
  const brand = store?.primary_color && store.primary_color.toLowerCase() !== bg.toLowerCase() ? store.primary_color : fg;

  return (
    <div
      role="progressbar"
      aria-label="Carregando o cardápio"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      style={{ background: bg, color: fg }}
      className="fixed inset-0 flex flex-col items-center justify-center px-10 select-none transition-colors duration-300 font-['Plus_Jakarta_Sans',sans-serif]"
    >
      <div className="h-40 flex items-center justify-center">
        {store?.logo_url ? (
          <img
            src={store.logo_url}
            alt={store.name}
            onLoad={() => setLogoOk(true)}
            className={`max-h-40 max-w-[70vw] object-contain transition-all duration-500 ${logoOk ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
          />
        ) : store ? (
          <h1 className="text-3xl font-black text-center tracking-tight anim-fade-in">{store.name}</h1>
        ) : null}
      </div>

      <div className="mt-10 w-48 h-1.5 rounded-full overflow-hidden" style={{ background: `${fg}26` }}>
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%`, background: brand }}
        />
      </div>
      <p className="mt-3 text-[11px] font-semibold opacity-50 tabular-nums">{Math.round(pct)}%</p>
    </div>
  );
}
