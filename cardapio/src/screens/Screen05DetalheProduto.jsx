import React, { useState, useEffect } from 'react';
import { ArrowLeft, Heart, Plus, Minus, Check } from 'lucide-react';
import { useApp, brl, priceLine } from '../context/AppContext';

export function Screen05DetalheProduto() {
  const { goBack, navigateTo, selectedProduct, addToCart, favorites, toggleFavorite, categories, products } = useApp();

  const product = selectedProduct;
  const [quantity, setQuantity] = useState(1);
  const [selectedAdditionals, setSelectedAdditionals] = useState([]);
  const [size, setSize] = useState(null);
  const [flavors, setFlavors] = useState([]); // sabores extras (meio a meio), sem contar o próprio produto
  const [options, setOptions] = useState([]); // [{ group, name, price }]

  // favorito que saiu do cardápio, recarga de tela etc.
  useEffect(() => {
    if (!product) navigateTo('home', false);
  }, [product]);
  if (!product) return null;

  const isFav = favorites.includes(product.id);
  const hasSizes = product.sizes.length > 0;
  const maxFlavors = categories.find((c) => c.id === product.category)?.max_flavors || 1;
  // outros sabores: mesma categoria e que existam no tamanho escolhido
  const flavorChoices =
    maxFlavors > 1
      ? products.filter(
          (p) => p.id !== product.id && p.category === product.category && (hasSizes ? p.sizes.some((s) => s.name === size) : !p.sizes.length),
        )
      : [];
  const priceAt = (p) => (size ? p.sizes.find((s) => s.name === size)?.price : p.price);

  const priced = priceLine({ product, size, flavors, additionals: selectedAdditionals, options });
  const missing = hasSizes && !size
    ? 'Escolha o tamanho'
    : product.optionGroups.find((g) => options.filter((o) => o.group === g.name).length < g.min)?.name;

  const toggleAdditional = (add) =>
    setSelectedAdditionals((prev) => (prev.some((i) => i.id === add.id) ? prev.filter((i) => i.id !== add.id) : [...prev, add]));

  const pickSize = (name) => {
    setSize(name);
    // sabor que não tem esse tamanho sai da pizza
    setFlavors((prev) => prev.filter((f) => f.sizes.some((s) => s.name === name)));
  };

  const toggleFlavor = (p) =>
    setFlavors((prev) => {
      if (prev.some((f) => f.id === p.id)) return prev.filter((f) => f.id !== p.id);
      // cheio: troca o último escolhido, mais natural que travar
      return prev.length < maxFlavors - 1 ? [...prev, p] : [...prev.slice(0, -1), p];
    });

  const toggleOption = (g, it) =>
    setOptions((prev) => {
      const mine = prev.filter((o) => o.group === g.name);
      if (mine.some((o) => o.name === it.name)) return prev.filter((o) => !(o.group === g.name && o.name === it.name));
      const next = { group: g.name, name: it.name, price: it.price };
      // escolha única: troca. Múltipla: adiciona até o limite
      if (g.max === 1) return [...prev.filter((o) => o.group !== g.name), next];
      return mine.length < g.max ? [...prev, next] : prev;
    });

  const handleAddToCart = () => {
    if (missing || !priced) return;
    addToCart(product, quantity, selectedAdditionals, { size, flavors, options });
    navigateTo('home');
  };

  return (
    <div className="relative w-full h-full min-h-screen bg-black overflow-hidden flex flex-col justify-between select-none">
      {/* Scrollable Container */}
      <div className="flex-1 overflow-y-auto scrollbar-none flex flex-col">

        {/* Top Hero Image Header */}
        <div className="relative w-full h-72 shrink-0 bg-black flex items-center justify-center">
          <img
            src={product.image}
            alt={product.name}
            className="w-full h-full object-cover"
          />

          {/* Top Actions: Back & Favorite */}
          <div className="absolute top-4 left-0 right-0 px-4 flex items-center justify-between z-20">
            <button
              onClick={goBack}
              aria-label="Voltar"
              className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/60 active:scale-90 transition-transform"
            >
              <ArrowLeft size={20} className="stroke-[2.5]" />
            </button>

            <button
              onClick={() => toggleFavorite(product.id)}
              aria-label="Favoritar"
              className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/60 active:scale-90 transition-transform"
            >
              <Heart
                size={20}
                className={isFav ? 'text-[var(--brand)] fill-[var(--brand)]' : 'text-white stroke-[2.2]'}
              />
            </button>
          </div>
        </div>

        {/* White Details Card Overlay */}
        <div className="relative flex-1 -mt-6 bg-white rounded-t-[30px] px-5 pt-5 pb-28 shadow-2xl space-y-4">

          {/* Title & Price */}
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              {product.name}
            </h1>
            <span className="text-xl font-black text-[var(--brand)] tracking-tight whitespace-nowrap">
              {hasSizes && !size && <span className="block text-[10px] font-semibold text-slate-400 text-right">a partir de</span>}
              {brl(size ? priceAt(product) : product.price)}
            </span>
          </div>

          {/* Description */}
          <p className="text-xs text-slate-500 leading-relaxed">
            {product.description}
          </p>

          {hasSizes && (
            <Section title="Tamanho" hint="Escolha 1" required done={!!size}>
              {product.sizes.map((s) => (
                <Choice key={s.name} radio checked={size === s.name} onClick={() => pickSize(s.name)} label={s.name} price={brl(s.price)} />
              ))}
            </Section>
          )}

          {maxFlavors > 1 && flavorChoices.length > 0 && (
            <Section
              title="Dividir sabores"
              hint={`Junte até ${maxFlavors} sabores · cobra o mais caro`}
              done={flavors.length > 0}
            >
              {hasSizes && !size ? (
                <p className="text-xs text-slate-400 py-1">Escolha o tamanho primeiro.</p>
              ) : (
                flavorChoices.map((p) => (
                  <Choice
                    key={p.id}
                    checked={flavors.some((f) => f.id === p.id)}
                    onClick={() => toggleFlavor(p)}
                    label={p.name}
                    price={brl(priceAt(p))}
                  />
                ))
              )}
            </Section>
          )}

          {product.optionGroups.map((g) => (
            <Section
              key={g.name}
              title={g.name}
              hint={g.max === 1 ? 'Escolha 1' : `Escolha até ${g.max}`}
              required={g.min > 0}
              done={options.filter((o) => o.group === g.name).length >= Math.max(1, g.min)}
            >
              {g.items.map((it) => (
                <Choice
                  key={it.name}
                  radio={g.max === 1}
                  checked={options.some((o) => o.group === g.name && o.name === it.name)}
                  onClick={() => toggleOption(g, it)}
                  label={it.name}
                  price={it.price ? `+ ${brl(it.price)}` : 'Grátis'}
                />
              ))}
            </Section>
          ))}

          {product.additionals.length > 0 && (
            <Section title="Adicionais" hint="Opcional">
              {product.additionals.map((add) => (
                <Choice
                  key={add.id}
                  checked={selectedAdditionals.some((i) => i.id === add.id)}
                  onClick={() => toggleAdditional(add)}
                  label={add.name}
                  price={`+ ${brl(add.price)}`}
                />
              ))}
            </Section>
          )}

          {/* Quantidade */}
          <div className="pt-3 flex items-center justify-between border-t border-slate-100">
            <span className="text-xs font-bold text-slate-900 tracking-tight">
              Quantidade
            </span>

            <div className="flex items-center space-x-3 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-full">
              <button
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                aria-label="Diminuir"
                className="w-5 h-5 rounded-full flex items-center justify-center text-slate-600 hover:text-slate-900 active:scale-90"
              >
                <Minus size={13} className="stroke-[2.5]" />
              </button>
              <span className="text-xs font-bold text-slate-900 min-w-[14px] text-center">
                {quantity}
              </span>
              <button
                onClick={() => setQuantity(q => q + 1)}
                aria-label="Aumentar"
                className="w-5 h-5 rounded-full flex items-center justify-center text-slate-600 hover:text-slate-900 active:scale-90"
              >
                <Plus size={13} className="stroke-[2.5]" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Sticky Action Button */}
      <div className="fixed bottom-0 left-0 right-0 max-w-[440px] mx-auto p-4 bg-white border-t border-slate-100 shrink-0 z-30 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <button
          onClick={handleAddToCart}
          disabled={!!missing || !priced}
          className="w-full py-3.5 bg-[var(--brand)] hover:brightness-90 active:scale-[0.98] transition-all rounded-2xl text-white font-bold text-sm shadow-lg disabled:bg-slate-300 disabled:shadow-none disabled:active:scale-100"
        >
          {missing
            ? (missing === 'Escolha o tamanho' ? missing : `Escolha: ${missing}`)
            : `Adicionar ao carrinho · ${brl(priced.unit * quantity)}`}
        </button>
      </div>
    </div>
  );
}

function Section({ title, hint, required, done, children }) {
  return (
    <div className="pt-2">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900 tracking-tight">{title}</h2>
          {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
        </div>
        {required && (
          <span
            className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              done ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-900 text-white'
            }`}
          >
            {done ? 'OK' : 'Obrigatório'}
          </span>
        )}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** linha clicável: radio (escolha única) ou checkbox */
function Choice({ radio, checked, onClick, label, price }) {
  return (
    <div
      role={radio ? 'radio' : 'checkbox'}
      aria-checked={checked}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())}
      className="flex items-center justify-between py-2 cursor-pointer group select-none"
    >
      <div className="flex items-center space-x-3">
        <div
          className={`w-5 h-5 border-2 flex items-center justify-center transition-all ${radio ? 'rounded-full' : 'rounded-md'} ${
            checked ? 'bg-[var(--brand)] border-[var(--brand)]' : 'border-slate-300 group-hover:border-slate-400 bg-white'
          }`}
        >
          {checked && (radio ? <span className="w-2 h-2 rounded-full bg-white" /> : <Check size={13} className="text-white stroke-[3.5]" />)}
        </div>
        <span className="text-xs font-medium text-slate-700 group-hover:text-slate-900">{label}</span>
      </div>
      <span className="text-xs font-bold text-slate-900">{price}</span>
    </div>
  );
}
