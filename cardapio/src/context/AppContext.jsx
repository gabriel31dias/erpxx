import React, { createContext, useContext, useState, useEffect } from 'react';
import { fetchMenu, createOrder, fetchOrders, waiterApi, courierApi, dineApi, pathParts, pub } from '../lib/api';
import { useTables } from '../garcom/useTables';
import { useCourier } from '../motoboy/useCourier';

const AppContext = createContext();

const QUERY = new URLSearchParams(location.search);
const PARTS = pathParts();
// slug da loja: /delivery/don-beef, /cardapio/don-beef (link antigo do delivery) ou ?loja=don-beef
const SLUG = (QUERY.get('loja') || (PARTS[0] === 'delivery' ? PARTS[1] : PARTS[0]) || '').toLowerCase();
/**
 * Cardápio da mesa: /cardapio/<slug>/mesa/<n>?t=<código do QR>. O pedido vai para a comanda da mesa
 * (igual ao do garçom) e a conta fecha no caixa. Sem número (/cardapio/<slug>/mesa) só mostra o cardápio.
 */
const DINE = PARTS[0] !== 'delivery' && PARTS[1] === 'mesa'
  ? { table: Number(PARTS[2]) > 0 ? Number(PARTS[2]) : null, code: QUERY.get('t') || '' }
  : null;
// carrinho da mesa não se mistura com o do delivery no mesmo celular
const KEY = DINE ? `${SLUG}:mesa` : SLUG;

// localStorage pode faltar (aba anônima, bloqueado): nunca quebra o app
const store = {
  get: (key, fallback) => {
    try {
      const v = localStorage.getItem(`${KEY}:${key}`);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(`${KEY}:${key}`, JSON.stringify(value));
    } catch {
      /* sem storage */
    }
  },
};

const usePersisted = (key, fallback) => {
  const [value, setValue] = useState(() => store.get(key, fallback));
  useEffect(() => store.set(key, value), [key, value]);
  return [value, setValue];
};

/** produto da API → formato que as telas já usam */
const toAppProduct = (p) => ({
  id: p.id,
  name: p.name,
  category: p.category_id,
  price: p.price,
  oldPrice: p.old_price,
  description: p.description,
  image: p.image_url || pub('assets/placeholder.svg'),
  imageCredit: p.image_credit || null,
  thumb: p.image_url || pub('assets/placeholder.svg'),
  additionals: p.additionals.map((a) => ({ id: a.name, name: a.name, price: a.price })),
  sizes: p.sizes || [],
  optionGroups: p.option_groups || [],
});

/** tem algo pra escolher? então o "+" do card abre o detalhe em vez de adicionar direto */
export const hasChoices = (p) => p.additionals.length > 0 || p.sizes.length > 0 || p.optionGroups.length > 0;

const FRACTION = { 2: '½', 3: '⅓', 4: '¼' };

/**
 * Preço e nome de uma linha do carrinho. Espelha backend/src/pricing.ts (o servidor
 * recalcula de qualquer jeito): meio a meio cobra o sabor mais caro.
 * Retorna null se a escolha não vale mais (tamanho sumiu, etc).
 */
export function priceLine({ product, size = null, flavors = [], additionals = [], options = [] }) {
  const all = [product, ...flavors];
  const prices = all.map((p) => (size ? p.sizes.find((s) => s.name === size)?.price : p.sizes.length ? undefined : p.price));
  if (prices.some((x) => x == null)) return null;
  const extras = [...additionals, ...options].reduce((sum, a) => sum + a.price, 0);
  const flavorName = all.length > 1 ? all.map((p) => `${FRACTION[all.length]} ${p.name}`).join(' + ') : product.name;
  return { unit: Math.max(...prices) + extras, name: size ? `${flavorName} (${size})` : flavorName };
}

/** linha do carrinho → formato da API (o servidor recalcula o preço) */
const toApiLine = (i) => ({
  product_id: i.product.id,
  quantity: i.quantity,
  additionals: (i.selectedAdditionals || []).map((a) => a.name),
  size: i.size || undefined,
  flavors: i.flavors?.length ? i.flavors.map((f) => f.id) : undefined,
  options: i.options?.length ? i.options.map((o) => ({ group: o.group, item: o.name })) : undefined,
});

const STATUS = {
  pending: { label: 'Recebido', code: 'preparing' },
  preparing: { label: 'Em preparação', code: 'preparing' },
  ready: { label: 'Pronto', code: 'preparing' },
  delivering: { label: 'Saiu para entrega', code: 'preparing' },
  delivered: { label: 'Entregue', code: 'delivered' },
  cancelled: { label: 'Cancelado', code: 'cancelled' },
};

/** pedido da API → formato das telas de pedidos/rastreamento */
const toAppOrder = (o) => {
  const d = new Date(o.created_at);
  const two = (n) => String(n).padStart(2, '0');
  const waitingPix = o.payment_method === 'pix' && o.payment_status === 'pending';
  return {
    ...o,
    id: o.id,
    label: `#${o.number}`,
    date: `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} - ${two(d.getHours())}:${two(d.getMinutes())}`,
    statusLabel: waitingPix && o.status === 'pending' ? 'Aguardando Pix' : STATUS[o.status].label,
    statusCode: STATUS[o.status].code,
  };
};

/** endereço da entrega para a API: em partes (acha o ponto no mapa do motoboy) e em uma linha (WhatsApp e ERP) */
export const deliveryAddress = (c, geo) => {
  const gps = geo ? { lat: geo.lat, lng: geo.lng } : {};
  if (!c.street) return { address: c.address, ...gps }; // endereço salvo antes do CEP: texto livre
  const line = `${c.street}, ${c.number}${c.complement ? ` - ${c.complement}` : ''} - ${c.district}, ${c.city}${c.state ? `/${c.state}` : ''}`;
  return {
    address: line, zip: c.zip || undefined, street: c.street, number: c.number, district: c.district || undefined,
    city: c.city, state: c.state || undefined, ...gps,
  };
};

/** waiter / courier: usuário do ERP logado (/api/auth/me) = app do garçom / do motoboy; vazio = app do cliente */
export function AppProvider({ children, waiter = null, courier = null }) {
  // dados da loja
  const [menu, setMenu] = useState({ loading: true, error: null, store: null, categories: [], products: [] });

  // garçom abre nas mesas; cliente (delivery ou mesa) abre na home da loja, com banner e logo
  // motoboy abre nas entregas disponíveis
  const start = waiter ? 'mesas' : courier ? 'entregas' : 'home';
  const [currentScreen, setCurrentScreen] = useState(start);
  const [history, setHistory] = useState([start]);
  const [activeTab, setActiveTab] = useState(start);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('todos');
  const [categoryFilter, setCategoryFilter] = useState('todos');
  const [searchQuery, setSearchQuery] = useState('');

  // carrinho e checkout
  const [cart, setCart] = usePersisted('cart', []);
  const [deliveryType, setDeliveryType] = useState('delivery');
  const [selectedPayment, setSelectedPayment] = useState('whatsapp');
  const [customer, setCustomer] = usePersisted('customer', {
    name: '', phone: '', email: '', address: '', notes: '', zip: '', street: '', number: '', complement: '', district: '', city: '', state: '',
  });
  // "usar minha localização": vale só para este pedido (não fica salvo, o próximo pode ser de outro lugar)
  const [deliveryGeo, setDeliveryGeo] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState('');

  // pedidos do cliente: só os ids ficam no navegador
  const [orderIds, setOrderIds] = usePersisted('orders', []);
  const [orders, setOrders] = useState([]);
  const [orderFilter, setOrderFilter] = useState('Todos');
  const [activeOrder, setActiveOrder] = useState(null);
  const [favorites, setFavorites] = usePersisted('favorites', []);

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [themeMode, setThemeMode] = useState('dark');
  const [language, setLanguage] = useState('Português');

  useEffect(() => {
    if (!SLUG) return setMenu((m) => ({ ...m, loading: false, error: 'Cardápio não encontrado' }));
    (waiter ? waiterApi.catalog() : courier ? courierApi.store() : fetchMenu(SLUG))
      .then((d) => {
        const products = d.products.map(toAppProduct);
        setMenu({ loading: false, error: null, store: d.store, categories: d.categories, products });
        // carrinho salvo: tira o que saiu do cardápio e atualiza preço
        setCart((c) =>
          c.flatMap((i) => {
            const p = products.find((x) => x.id === i.product.id);
            const flavors = (i.flavors || []).map((f) => products.find((x) => x.id === f.id));
            if (!p || flavors.some((f) => !f)) return [];
            const adds = (i.selectedAdditionals || []).filter((a) => p.additionals.some((x) => x.id === a.id));
            // opção que mudou de preço/sumiu: pega a versão nova ou descarta
            const options = (i.options || []).flatMap((o) => {
              const it = p.optionGroups.find((g) => g.name === o.group)?.items.find((x) => x.name === o.name);
              return it ? [{ group: o.group, name: it.name, price: it.price }] : [];
            });
            const priced = priceLine({ product: p, size: i.size, flavors, additionals: adds, options });
            if (!priced) return [];
            return [{ ...i, product: p, flavors, selectedAdditionals: adds, options, name: priced.name, itemTotal: priced.unit * i.quantity }];
          }),
        );
        if (!d.store.accepts_delivery) setDeliveryType('pickup');
        setSelectedPayment(d.store.whatsapp_enabled ? 'whatsapp' : 'pix');
        document.title = waiter ? `Garçom · ${d.store.name}` : courier ? `Motoboy · ${d.store.name}` : DINE?.table ? `Mesa ${DINE.table} · ${d.store.name}` : d.store.name;
      })
      .catch((e) => setMenu((m) => ({ ...m, loading: false, error: e.message })));
  }, []);

  const refreshOrders = async () => {
    if (!orderIds.length) return setOrders([]);
    const list = (await fetchOrders(orderIds)).map(toAppOrder);
    setOrders(list);
    setActiveOrder((cur) => (cur ? list.find((o) => o.id === cur.id) || cur : cur));
    return list;
  };

  const navigateTo = (screenKey, addToHistory = true) => {
    // garçom não tem a home da loja: o cardápio é a lista de produtos
    if (waiter && screenKey === 'home') screenKey = 'categoria';
    if (addToHistory && currentScreen !== screenKey) setHistory((prev) => [...prev, screenKey]);
    setCurrentScreen(screenKey);
    if (['home', 'categoria'].includes(screenKey)) setActiveTab('home');
    else if (['meus_pedidos', 'rastreamento'].includes(screenKey)) setActiveTab('pedidos');
    else if (['perfil', 'favoritos', 'configuracoes', 'suporte', 'sobre'].includes(screenKey)) setActiveTab('perfil');
    else if (['mesas', 'comanda', 'entregas', 'rota'].includes(screenKey)) setActiveTab(screenKey);
    else if (screenKey === 'minha_mesa') setActiveTab('comanda');
    window.scrollTo(0, 0);
  };

  const goBack = () => {
    if (history.length > 1) {
      const newHistory = history.slice(0, -1);
      setHistory(newHistory);
      setCurrentScreen(newHistory[newHistory.length - 1]);
    } else {
      navigateTo('home', false);
    }
  };

  // mesmo produto com escolhas diferentes vira outra linha do carrinho
  const lineKey = (productId, additionals, { size, flavors = [], options = [] } = {}) =>
    [
      productId,
      additionals.map((a) => a.id).sort().join(','),
      size || '',
      flavors.map((f) => f.id).sort().join(','),
      options.map((o) => `${o.group}:${o.name}`).sort().join(','),
    ].join('|');

  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  /** extra: { size, flavors: [produtos], options: [{ group, name, price }] } */
  const addToCart = (product, quantity = 1, additionals = [], extra = {}) => {
    // cardápio aberto sem mesa (link do painel) é só para ver
    if (DINE && !DINE.table) return setToast({ id: Date.now(), text: 'Para pedir, leia o QR Code da mesa' });
    const { size = null, flavors = [], options = [] } = extra;
    const priced = priceLine({ product, size, flavors, additionals, options });
    if (!priced) return;
    setToast({ id: Date.now(), text: `${priced.name} adicionado ao carrinho` });
    const key = lineKey(product.id, additionals, extra);
    const unit = priced.unit;
    setCart((prev) => {
      const i = prev.findIndex((item) => item.key === key);
      if (i === -1)
        return [...prev, { key, product, quantity, selectedAdditionals: additionals, size, flavors, options, name: priced.name, itemTotal: unit * quantity }];
      const updated = [...prev];
      const qty = updated[i].quantity + quantity;
      updated[i] = { ...updated[i], quantity: qty, itemTotal: unit * qty };
      return updated;
    });
  };

  const updateCartQuantity = (key, delta) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.key !== key) return item;
          const qty = item.quantity + delta;
          if (qty <= 0) return null;
          return { ...item, quantity: qty, itemTotal: (item.itemTotal / item.quantity) * qty };
        })
        .filter(Boolean),
    );
  };

  const clearCart = () => setCart([]);

  const storeInfo = menu.store;
  const subtotal = cart.reduce((sum, item) => sum + item.itemTotal, 0);
  const currentDeliveryFee = waiter || DINE || deliveryType === 'pickup' || !storeInfo ? 0 : storeInfo.delivery_fee; // mesa não paga entrega
  const total = subtotal + currentDeliveryFee;

  const toggleFavorite = (productId) =>
    setFavorites((prev) => (prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]));

  /** cria o pedido na API; WhatsApp abre a conversa, Pix vai pro QR Code */
  const placeOrder = async () => {
    setPlacing(true);
    setOrderError('');
    // abre a aba antes do await: depois dele o navegador bloqueia o popup
    const waWindow = selectedPayment === 'whatsapp' ? window.open('', '_blank') : null;
    try {
      const order = await createOrder(SLUG, {
        customer_name: customer.name,
        customer_phone: customer.phone,
        customer_email: selectedPayment === 'pix' ? customer.email : undefined,
        delivery_type: deliveryType,
        ...(deliveryType === 'delivery' ? deliveryAddress(customer, deliveryGeo) : {}),
        notes: customer.notes || undefined,
        payment_method: selectedPayment,
        items: cart.map(toApiLine),
      });
      const appOrder = toAppOrder(order);
      setOrderIds((ids) => [order.id, ...ids.filter((id) => id !== order.id)].slice(0, 30));
      setOrders((list) => [appOrder, ...list]);
      setActiveOrder(appOrder);
      clearCart();
      if (selectedPayment === 'pix') {
        waWindow?.close();
        navigateTo('pix');
      } else {
        if (waWindow) waWindow.location.href = order.whatsapp_url;
        else window.location.href = order.whatsapp_url;
        navigateTo('pedido_realizado');
      }
    } catch (e) {
      waWindow?.close();
      setOrderError(e.message);
    } finally {
      setPlacing(false);
    }
  };

  const mesas = useTables(waiter, { cart, clearCart, toApiLine });
  const entregas = useCourier(courier);
  const notify = (text) => setToast({ id: Date.now(), text });

  // cliente na mesa: manda para a comanda pelo QR e acompanha o que a mesa já pediu
  const [tab, setTab] = useState({ orders: [], total: 0, calls: [] });
  const refreshTab = async () => {
    if (!DINE?.table) return;
    const r = await dineApi.tab(SLUG, DINE.table, DINE.code);
    setTab(r);
    return r;
  };
  const dine = DINE && {
    table: DINE.table,
    tab,
    refreshTab,
    sendToTable: async (notes) => {
      await dineApi.order(SLUG, DINE.table, { t: DINE.code, items: cart.map(toApiLine), notes: notes || undefined });
      clearCart();
      await refreshTab().catch(() => {});
    },
    /** chama o garçom (waiter) ou pede a conta (bill); o garçom vê na hora no app e no ERP */
    callStaff: async (kind) => {
      const call = await dineApi.call(SLUG, DINE.table, { t: DINE.code, kind });
      setTab((t) => ({ ...t, calls: [...(t.calls || []).filter((c) => c.kind !== kind), call] }));
      notify(kind === 'bill' ? 'Pedimos a conta. O garçom já vem.' : 'Garçom chamado. Já vamos até a mesa.');
    },
  };

  return (
    <AppContext.Provider
      value={{
        ...mesas,
        ...entregas,
        ...dine,
        dine: !!DINE,
        waiter,
        courier,
        notify,
        slug: SLUG,
        menu,
        storeInfo,
        products: menu.products,
        categories: menu.categories,
        currentScreen,
        navigateTo,
        goBack,
        activeTab,
        setActiveTab,
        selectedProduct,
        setSelectedProduct,
        selectedCategory,
        setSelectedCategory,
        categoryFilter,
        setCategoryFilter,
        searchQuery,
        setSearchQuery,
        cart,
        addToCart,
        toast,
        updateCartQuantity,
        clearCart,
        subtotal,
        deliveryFee: currentDeliveryFee,
        total,
        deliveryType,
        setDeliveryType,
        selectedPayment,
        setSelectedPayment,
        customer,
        setCustomer,
        deliveryGeo,
        setDeliveryGeo,
        placing,
        orderError,
        setOrderError,
        orders,
        refreshOrders,
        orderFilter,
        setOrderFilter,
        activeOrder,
        setActiveOrder,
        favorites,
        toggleFavorite,
        notificationsEnabled,
        setNotificationsEnabled,
        themeMode,
        setThemeMode,
        language,
        setLanguage,
        placeOrder,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
}

export const brl = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
