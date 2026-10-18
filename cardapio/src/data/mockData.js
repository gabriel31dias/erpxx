export const CATEGORIES = [
  { id: 'todos', name: 'Todos' },
  { id: 'burgers', name: 'Burgers' },
  { id: 'pizzas', name: 'Pizzas' },
  { id: 'porcoes', name: 'Porções' },
  { id: 'bebidas', name: 'Bebidas' },
  { id: 'sobremesas', name: 'Sobremesas' },
];

export const CATEGORY_FILTERS = ['Todos', 'Burgers', 'Pizzas', 'Porções', 'Bebidas', 'Sobremesas'];

export const PRODUCTS = [
  {
    id: 'x-tudo',
    name: 'X-Tudo',
    category: 'burgers',
    subCategory: 'Burgers',
    price: 32.90,
    oldPrice: null,
    rating: 4.9,
    description: 'Pão brioche, blend 180g, queijo, bacon, alface, tomate e molho especial.',
    image: '/assets/images/donbeef_x_tudo.png',
    thumb: '/assets/images/donbeef_x_tudo.png',
    isFavorite: true,
    isPopular: true,
    additionals: [
      { id: 'bacon_extra', name: 'Bacon extra', price: 4.00, selected: false },
      { id: 'queijo_extra', name: 'Queijo extra', price: 3.00, selected: false },
      { id: 'cebola_caramelizada', name: 'Cebola caramelizada', price: 3.00, selected: false },
      { id: 'molho_especial', name: 'Molho especial', price: 2.00, selected: false },
    ]
  },
  {
    id: 'x-bacon',
    name: 'X-Bacon',
    category: 'burgers',
    subCategory: 'Burgers',
    price: 28.90,
    oldPrice: null,
    rating: 4.8,
    description: 'Pão brioche, blend 180g, queijo, bacon e molho defumado.',
    image: '/assets/images/donbeef_x_bacon.png',
    thumb: '/assets/images/donbeef_x_bacon.png',
    isFavorite: false,
    isPopular: true,
    additionals: [
      { id: 'bacon_extra', name: 'Bacon extra', price: 4.00, selected: false },
      { id: 'queijo_extra', name: 'Queijo extra', price: 3.00, selected: false },
    ]
  },
  {
    id: 'x-salada',
    name: 'X-Salada',
    category: 'burgers',
    subCategory: 'Burgers',
    price: 26.90,
    oldPrice: null,
    rating: 4.7,
    description: 'Pão brioche, blend 180g, queijo, alface, tomate e cebola.',
    image: '/assets/images/donbeef_x_salada.png',
    thumb: '/assets/images/donbeef_x_salada.png',
    isFavorite: false,
    isPopular: false,
    additionals: [
      { id: 'queijo_extra', name: 'Queijo extra', price: 3.00, selected: false },
      { id: 'molho_especial', name: 'Molho especial', price: 2.00, selected: false },
    ]
  },
  {
    id: 'x-frango',
    name: 'X-Frango',
    category: 'burgers',
    subCategory: 'Burgers',
    price: 24.90,
    oldPrice: null,
    rating: 4.6,
    description: 'Pão brioche, frango grelhado, queijo, alface e molho especial.',
    image: '/assets/images/donbeef_x_frango.png',
    thumb: '/assets/images/donbeef_x_frango.png',
    isFavorite: false,
    isPopular: false,
    additionals: [
      { id: 'bacon_extra', name: 'Bacon extra', price: 4.00, selected: false },
      { id: 'queijo_extra', name: 'Queijo extra', price: 3.00, selected: false },
    ]
  },
  {
    id: 'batata-frita',
    name: 'Batata Frita',
    category: 'porcoes',
    subCategory: 'Porções',
    price: 18.90,
    oldPrice: null,
    rating: 4.8,
    description: 'Porção de batatas fritas douradas e super crocantes.',
    image: '/assets/images/donbeef_batata_frita.png',
    thumb: '/assets/images/donbeef_batata_frita.png',
    isFavorite: true,
    isPopular: true,
  },
  {
    id: 'aneis-cebola',
    name: 'Anéis de Cebola',
    category: 'porcoes',
    subCategory: 'Porções',
    price: 22.90,
    oldPrice: null,
    rating: 4.7,
    description: 'Anéis de cebola crocantes empanados e dourados.',
    image: '/assets/images/donbeef_aneis_cebola.png',
    thumb: '/assets/images/donbeef_aneis_cebola.png',
    isFavorite: false,
    isPopular: true,
  },
  {
    id: 'frango-passarinho',
    name: 'Frango a Passarinho',
    category: 'porcoes',
    subCategory: 'Porções',
    price: 28.90,
    oldPrice: null,
    rating: 4.9,
    description: 'Porção crocante de frango a passarinho frito com alho e ervas.',
    image: '/assets/images/donbeef_frango_passarinho.png',
    thumb: '/assets/images/donbeef_frango_passarinho.png',
    isFavorite: false,
    isPopular: true,
  },
  {
    id: 'pizza-calabresa',
    name: 'Pizza Calabresa',
    category: 'pizzas',
    subCategory: 'Pizzas',
    price: 49.90,
    oldPrice: null,
    rating: 4.9,
    description: 'Molho artesanal, mussarela, calabresa fatiada, cebola roxa e orégano.',
    image: '/assets/images/pizza_promo.png',
    thumb: '/assets/images/pizza_thumb.png',
    isFavorite: true,
    isPopular: false,
  },
  {
    id: 'coca-cola-lata',
    name: 'Coca-Cola Lata',
    category: 'bebidas',
    subCategory: 'Bebidas',
    price: 6.00,
    oldPrice: null,
    rating: 5.0,
    description: 'Refrigerante Coca-Cola original lata 350ml trincando de gelada.',
    image: '/assets/images/coke_cart.png',
    thumb: '/assets/images/coke_thumb.png',
    isFavorite: true,
    isPopular: false,
  }
];

export const INITIAL_CART = [
  {
    product: PRODUCTS[0], // X-Tudo
    quantity: 1,
    selectedAdditionals: [],
    itemTotal: 32.90,
  },
  {
    product: PRODUCTS[6], // Coca-Cola Lata
    quantity: 1,
    selectedAdditionals: [],
    itemTotal: 6.00,
  }
];

export const DELIVERY_FEE = 5.00;

export const ADDRESSES = [
  {
    id: 'casa',
    type: 'Casa',
    title: 'Casa',
    street: 'Rua das Flores, 123',
    neighborhood: 'Centro, São Paulo - SP',
    cep: 'CEP 01000-000',
    isDefault: true,
  },
  {
    id: 'trabalho',
    type: 'Trabalho',
    title: 'Trabalho',
    street: 'Av. Paulista, 1000',
    neighborhood: 'Bela Vista, São Paulo - SP',
    cep: 'CEP 01310-100',
    isDefault: false,
  }
];

export const PAYMENT_METHODS = [
  {
    id: 'pix',
    name: 'PIX',
    subtitle: 'Aprovação imediata',
    icon: 'pix',
    isDefault: true,
  },
  {
    id: 'credit',
    name: 'Cartão de crédito',
    subtitle: 'Até 12x',
    icon: 'credit-card',
    isDefault: false,
  },
  {
    id: 'debit',
    name: 'Cartão de débito',
    subtitle: null,
    icon: 'credit-card',
    isDefault: false,
  },
  {
    id: 'cash',
    name: 'Dinheiro',
    subtitle: 'Pagamento na entrega',
    icon: 'cash',
    isDefault: false,
  }
];

export const ORDERS = [
  {
    id: '#1234',
    date: '12/09/2025 - 18:30',
    total: 43.90,
    status: 'Em preparação',
    statusCode: 'preparing', // badge orange
    statusColor: 'orange',
    items: ['1x X-Tudo', '1x Coca-Cola Lata'],
    address: 'Rua das Flores, 123 - Centro',
    paymentMethod: 'PIX',
    timeline: [
      { title: 'Pedido confirmado', time: '18:32', completed: true, active: false },
      { title: 'Em preparação', time: '18:40', completed: true, active: true },
      { title: 'Saiu para entrega', time: null, completed: false, active: false },
      { title: 'Entregue', time: null, completed: false, active: false },
    ]
  },
  {
    id: '#1233',
    date: '10/09/2025 - 20:15',
    total: 52.80,
    status: 'Entregue',
    statusCode: 'delivered', // badge green
    statusColor: 'green',
    items: ['1x X-Bacon', '1x Batata Frita', '1x Guaraná'],
    address: 'Rua das Flores, 123 - Centro',
    paymentMethod: 'Cartão de crédito',
  },
  {
    id: '#1232',
    date: '08/09/2025 - 19:40',
    total: 28.90,
    status: 'Entregue',
    statusCode: 'delivered',
    statusColor: 'green',
    items: ['1x X-Bacon'],
    address: 'Rua das Flores, 123 - Centro',
    paymentMethod: 'PIX',
  },
  {
    id: '#1231',
    date: '05/09/2025 - 21:10',
    total: 67.50,
    status: 'Cancelado',
    statusCode: 'cancelled', // badge red
    statusColor: 'red',
    items: ['1x Pizza Calabresa', '2x Coca-Cola Lata'],
    address: 'Av. Paulista, 1000',
    paymentMethod: 'Cartão de crédito',
  }
];

export const PROMOTIONS = [
  {
    id: 'promo-1',
    title: 'Combo do Dia',
    subtitle: 'X-Tudo + Batata + Refri',
    discount: '20% OFF',
    price: 39.90,
    image: '/assets/images/burger_banner.png',
    color: 'from-amber-950/70 to-red-950/90',
  },
  {
    id: 'promo-2',
    title: 'Segunda da Pizza',
    subtitle: 'Todas as pizzas com',
    discount: '20% OFF',
    price: null,
    image: '/assets/images/pizza_promo.png',
    color: 'from-red-950/80 to-stone-900',
  },
  {
    id: 'promo-3',
    title: 'Happy Hour',
    subtitle: 'Porções com',
    discount: '30% OFF',
    timeLimit: '17h às 20h',
    price: null,
    image: '/assets/images/fries_promo.png',
    color: 'from-amber-900/80 to-zinc-900',
  }
];

export const RESTAURANT_INFO = {
  name: 'Saboria',
  subtitle: 'Hambúrguer Artesanal',
  rating: 4.8,
  reviewsCount: '1.234',
  deliveryTime: '30 - 50 min',
  deliveryFee: 'R$ 5,00',
  status: 'Aberto agora',
  hours: '10:00 às 23:00',
  description: 'O Saboria é referência em hambúrgueres artesanais, com ingredientes selecionados e muito sabor. Qualidade, rapidez e o melhor atendimento para você!',
  address: 'Rua Augusta, 1500 - Consolação, São Paulo - SP',
  phone: '(11) 98765-4321',
  whatsapp: '5511987654321',
  instagram: '@saboriaburgers',
};

export const USER_PROFILE = {
  name: 'Gabriel Silva',
  email: 'gabriel@email.com',
  phone: '(11) 99887-6655',
  avatar: null, // default avatar outline
  addressesCount: 2,
  cardsCount: 1,
  couponsCount: 3,
};

export const SCREENS_INFO = [
  { id: '1', key: 'splash', name: '1. Splash', title: 'Splash Screen', group: 'Onboarding' },
  { id: '2', key: 'onboarding', name: '2. Onboarding', title: 'Boas-vindas', group: 'Onboarding' },
  { id: '3', key: 'home', name: '3. Home', title: 'Início / Cardápio', group: 'Cardápio' },
  { id: '4', key: 'categoria', name: '4. Categoria', title: 'Lista de Lanches', group: 'Cardápio' },
  { id: '5', key: 'detalhe', name: '5. Detalhe do produto', title: 'Detalhes X-Tudo', group: 'Cardápio' },
  { id: '6', key: 'carrinho', name: '6. Carrinho', title: 'Meu Carrinho', group: 'Checkout' },
  { id: '7', key: 'endereco', name: '7. Endereço', title: 'Seleção de Entrega', group: 'Checkout' },
  { id: '8', key: 'pagamento', name: '8. Pagamento', title: 'Método de Pagamento', group: 'Checkout' },
  { id: '9', key: 'pedido_realizado', name: '9. Pedido realizado', title: 'Sucesso do Pedido', group: 'Checkout' },
  { id: '10', key: 'meus_pedidos', name: '10. Meus pedidos', title: 'Histórico de Pedidos', group: 'Pedidos' },
  { id: '11', key: 'rastreamento', name: '11. Rastreamento', title: 'Acompanhar Pedido #1234', group: 'Pedidos' },
  { id: '12', key: 'perfil', name: '12. Perfil', title: 'Minha Conta', group: 'Conta' },
  { id: '13', key: 'favoritos', name: '13. Favoritos', title: 'Itens Salvos', group: 'Conta' },
  { id: '14', key: 'promocoes', name: '14. Promoções', title: 'Ofertas e Descontos', group: 'Ofertas' },
  { id: '15', key: 'sobre', name: '15. Sobre o restaurante', title: 'Sobre o Saboria', group: 'Info' },
  { id: '16', key: 'suporte', name: '16. Suporte', title: 'Ajuda e Atendimento', group: 'Info' },
  { id: '17', key: 'configuracoes', name: '17. Configurações', title: 'Ajustes do App', group: 'Ajustes' },
];
