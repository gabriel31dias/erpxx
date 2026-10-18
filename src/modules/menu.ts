/**
 * Cardápio digital: o app do cliente (repo `cardapio`) lê o catálogo e manda pedidos para cá.
 * As rotas públicas mantêm o contrato da API antiga do cardápio (snake_case, valores em reais),
 * então o app só troca o endereço da API.
 */
import {
  BadRequestException, Body, Controller, Get, Header, HttpCode, Inject, Injectable, Logger, MessageEvent, Module,
  NotFoundException, Param, Patch, Post, Query, Req, Sse, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { Observable, Subject, filter, interval, map, merge } from 'rxjs';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max,
  MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import type { MenuOrder, Company } from '@prisma/client';
import type { Request } from 'express';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, Public, SessionUser, SkipCsrf } from '../common/auth.guard';
import { AuditService, PlanService } from '../common/core';
import { paging, waPhone } from '../common/util';
import { PaymentsModule, PixGateway } from './payments';
import type { UploadFile } from './attachments';
import { MENU_FEE_SKU, MENU_ROLE, SalesModule, SalesService } from './sales';

/**
 * Fotos do cardápio (logo, banner, produtos). Pasta própria e pública, servida em /uploads/menu
 * pelo app.module — nunca misturar com data/uploads, onde ficam comprovantes privados.
 */
export const MENU_IMAGES_DIR = process.env.MENU_IMAGES_DIR || join(__dirname, '..', '..', 'data', 'menu-images');
const IMAGE_TYPES: Array<{ ext: string; match: (b: Buffer) => boolean }> = [
  { ext: 'jpg', match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', match: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', match: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

// ---------- preço ----------

type Priced = { name: string; priceCents: number };
type OptionGroup = { name: string; min: number; max: number; items: Priced[] };
export type MenuOptions = { additionals: Priced[]; sizes: Priced[]; optionGroups: OptionGroup[] };
export type OrderItem = {
  productId: string; name: string; quantity: number; unitCents: number;
  additionals: Priced[]; totalCents: number;
};
export type CartLine = {
  product_id: string;
  quantity: number;
  additionals?: string[];
  size?: string;
  /** outros sabores (ids) além do product_id, pra pizza meio a meio */
  flavors?: string[];
  options?: { group: string; item: string }[];
};
type MenuProduct = { id: string; name: string; categoryId: string | null; priceCents: number; available: boolean } & MenuOptions;

const FRACTION: Record<number, string> = { 2: '½', 3: '⅓', 4: '¼' };

export const menuOptions = (json: string): MenuOptions => {
  const o = JSON.parse(json || '{}');
  return { additionals: o.additionals ?? [], sizes: o.sizes ?? [], optionGroups: o.optionGroups ?? [] };
};

/** preço do sabor no tamanho escolhido; sem tamanhos cadastrados vale o preço do produto */
function flavorCents(p: MenuProduct, size?: string) {
  if (!p.sizes.length) {
    if (size) throw new Error(`${p.name} não tem tamanho ${size}`);
    return p.priceCents;
  }
  const s = p.sizes.find((x) => x.name === size);
  if (!s) throw new Error(size ? `${p.name} não tem tamanho ${size}` : `Escolha o tamanho de ${p.name}`);
  return s.priceCents;
}

/**
 * Preço sempre vem do banco: o cliente manda só ids, quantidade e nomes das
 * escolhas. Lança Error com mensagem pro cliente quando algo não bate.
 * Meio a meio cobra o sabor mais caro.
 */
export function priceCart(
  lines: CartLine[], products: MenuProduct[], deliveryFeeCents: number, maxFlavorsByCategory: Record<string, number> = {},
) {
  if (!lines.length) throw new Error('Carrinho vazio');
  const find = (id: string) => {
    const p = products.find((x) => x.id === id);
    if (!p || !p.available) throw new Error('Produto indisponível');
    return p;
  };

  const items: OrderItem[] = lines.map((line) => {
    const p = find(line.product_id);
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) throw new Error('Quantidade inválida');

    const extra = [...new Set(line.flavors ?? [])].filter((id) => id !== p.id).map(find);
    const flavors = [p, ...extra];
    const max = (p.categoryId && maxFlavorsByCategory[p.categoryId]) || 1;
    if (flavors.length > max) throw new Error(`${p.name}: no máximo ${max} sabor(es)`);
    if (extra.some((f) => !p.categoryId || f.categoryId !== p.categoryId)) throw new Error('Sabores precisam ser da mesma categoria');
    const baseCents = Math.max(...flavors.map((f) => flavorCents(f, line.size)));

    const additionals = [...new Set(line.additionals ?? [])].map((name) => {
      const a = p.additionals.find((x) => x.name === name);
      if (!a) throw new Error(`Adicional indisponível: ${name}`);
      return { name, priceCents: a.priceCents };
    });

    const chosen = line.options ?? [];
    for (const o of chosen)
      if (!p.optionGroups.some((g) => g.name === o.group && g.items.some((i) => i.name === o.item)))
        throw new Error(`Opção indisponível: ${o.group} ${o.item}`);
    for (const g of p.optionGroups) {
      const n = new Set(chosen.filter((o) => o.group === g.name).map((o) => o.item)).size;
      if (n < g.min) throw new Error(`Escolha ${g.name}`);
      if (n > g.max) throw new Error(`${g.name}: no máximo ${g.max}`);
    }
    // ponytail: opção escolhida vai junto dos adicionais ("Borda: Catupiry"), assim a tela de
    // pedidos e o WhatsApp mostram sem mudança. Campo próprio quando precisarem filtrar por opção.
    for (const g of p.optionGroups)
      for (const it of g.items)
        if (chosen.some((o) => o.group === g.name && o.item === it.name))
          additionals.push({ name: `${g.name}: ${it.name}`, priceCents: it.priceCents });

    const flavorName = flavors.length > 1 ? flavors.map((f) => `${FRACTION[flavors.length]} ${f.name}`).join(' + ') : p.name;
    const unitCents = baseCents + additionals.reduce((s, a) => s + a.priceCents, 0);
    return {
      productId: p.id,
      name: line.size ? `${flavorName} (${line.size})` : flavorName,
      quantity: line.quantity, unitCents, additionals, totalCents: unitCents * line.quantity,
    };
  });
  const subtotalCents = items.reduce((s, i) => s + i.totalCents, 0);
  return { items, subtotalCents, deliveryFeeCents, totalCents: subtotalCents + deliveryFeeCents };
}

// ---------- configuração do cardápio (Company.menuSettings) ----------

export const DEFAULT_MENU = {
  enabled: false, // empresa do ERP só ganha cardápio público quando liga
  subtitle: '',
  description: '',
  logoUrl: null as string | null, // vazio usa o logo da empresa
  logoSize: 32,
  showName: true,
  showSubtitle: true,
  bannerUrl: null as string | null,
  coverUrl: null as string | null,
  primaryColor: '#FF002E',
  instagram: '',
  hours: '18:00 às 23:00',
  deliveryTime: '30 - 50 min',
  deliveryFeeCents: 0,
  isOpen: true,
  acceptsDelivery: true,
  acceptsPickup: true,
  whatsappEnabled: true,
  pixEnabled: false, // além disso, o PIX da empresa precisa estar configurado
};
export type MenuSettings = typeof DEFAULT_MENU;

export const menuOf = (c: Pick<Company, 'menuSettings'>): MenuSettings => ({ ...DEFAULT_MENU, ...JSON.parse(c.menuSettings || '{}') });
const pixOn = (c: Company, m: MenuSettings) => m.pixEnabled && c.pixEnabled && !!c.pixSecretKey;
const reais = (cents: number) => cents / 100;

const toApiStore = (c: Company, m: MenuSettings) => ({
  id: c.id,
  slug: c.slug,
  name: c.tradeName || c.name,
  subtitle: m.subtitle,
  description: m.description,
  logo_url: m.logoUrl || c.logoPath,
  logo_size: m.logoSize,
  show_name: m.showName,
  show_subtitle: m.showSubtitle,
  banner_url: m.bannerUrl,
  cover_url: m.coverUrl,
  primary_color: m.primaryColor,
  whatsapp: waPhone(c.whatsapp) ?? '',
  phone: c.phone ?? '',
  address: [c.address, c.number, c.district, c.city].filter(Boolean).join(', '),
  instagram: m.instagram,
  hours: m.hours,
  delivery_time: m.deliveryTime,
  delivery_fee: reais(m.deliveryFeeCents),
  is_open: m.isOpen,
  accepts_delivery: m.acceptsDelivery,
  accepts_pickup: m.acceptsPickup,
  whatsapp_enabled: m.whatsappEnabled && !!waPhone(c.whatsapp),
  pix_enabled: pixOn(c, m),
});

const priced = (x: Priced) => ({ name: x.name, price: reais(x.priceCents) });

const toApiProduct = (p: { id: string; categoryId: string | null; name: string; description: string | null;
  priceCents: number; oldPriceCents: number | null; imageUrl: string | null; menuOptions: string; position: number }) => {
  const o = menuOptions(p.menuOptions);
  return {
    id: p.id,
    category_id: p.categoryId,
    name: p.name,
    description: p.description ?? '',
    price: reais(p.priceCents),
    old_price: p.oldPriceCents == null ? null : reais(p.oldPriceCents),
    image_url: p.imageUrl,
    additionals: o.additionals.map(priced),
    sizes: o.sizes.map(priced),
    option_groups: o.optionGroups.map((g) => ({ name: g.name, min: g.min, max: g.max, items: g.items.map(priced) })),
    active: true,
    position: p.position,
  };
};

const itemsOf = (o: MenuOrder): OrderItem[] => JSON.parse(o.items);

/** formato do pedido para o app; o público não vê o id da cobrança */
const toApiOrder = (o: MenuOrder) => ({
  id: o.id,
  number: o.number,
  customer_name: o.customerName,
  customer_phone: o.customerPhone,
  delivery_type: o.deliveryType,
  address: o.address,
  notes: o.notes,
  items: itemsOf(o).map((i) => ({
    product_id: i.productId,
    name: i.name,
    quantity: i.quantity,
    unit_price: reais(i.unitCents),
    additionals: i.additionals.map(priced),
    total: reais(i.totalCents),
  })),
  subtotal: reais(o.subtotalCents),
  delivery_fee: reais(o.deliveryFeeCents),
  total: reais(o.totalCents),
  payment_method: o.paymentMethod,
  payment_status: o.paymentStatus,
  status: o.status,
  created_at: o.createdAt,
});

const money = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

function whatsappUrl(c: Company, o: MenuOrder) {
  const phone = waPhone(c.whatsapp);
  if (!phone) return null;
  const lines = [
    `*Pedido #${o.number} — ${c.tradeName || c.name}*`,
    '',
    ...itemsOf(o).flatMap((i) => [
      `• ${i.quantity}x ${i.name} — R$ ${money(i.totalCents)}`,
      ...i.additionals.map((a) => `   + ${a.name}`),
    ]),
    '',
    `Subtotal: R$ ${money(o.subtotalCents)}`,
    ...(o.deliveryFeeCents ? [`Entrega: R$ ${money(o.deliveryFeeCents)}`] : []),
    `*Total: R$ ${money(o.totalCents)}*`,
    '',
    `Cliente: ${o.customerName} (${o.customerPhone})`,
    o.deliveryType === 'delivery' ? `Entrega em: ${o.address}` : 'Retirar no local',
    ...(o.notes ? [`Obs: ${o.notes}`] : []),
    ...(o.paymentMethod === 'pix' ? [`Pagamento: Pix (${o.paymentStatus === 'approved' ? 'pago' : 'aguardando'})`] : []),
  ];
  return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`;
}

// ---------- tempo real: avisa a tela de pedidos ----------

type MenuEvent = { companyId: string; type: 'new' | 'update'; id: string; number: number; customerName: string; status: string };

/**
 * Canal de eventos dos pedidos por empresa, entregue à tela por SSE (`GET /api/menu/events`).
 * ponytail: Subject em memória, vale para um processo (o PM2 roda um só). Com vários processos
 * ou servidores, troque por Postgres LISTEN/NOTIFY ou Redis pub/sub atrás deste mesmo emit/stream.
 */
@Injectable()
export class MenuEvents {
  private readonly bus = new Subject<MenuEvent>();

  emit(type: MenuEvent['type'], o: MenuOrder) {
    this.bus.next({ companyId: o.companyId, type, id: o.id, number: o.number, customerName: o.customerName, status: o.status });
  }

  stream(companyId: string): Observable<MessageEvent> {
    return merge(
      this.bus.pipe(filter((e) => e.companyId === companyId), map(({ companyId: _, ...data }) => ({ data }))),
      // comentário a cada 25s: proxy e navegador não derrubam a conexão parada
      interval(25_000).pipe(map(() => ({ type: 'ping', data: '' }))),
    );
  }
}

// ---------- rotas públicas (app do cliente) ----------

class OptionDto {
  @IsString() group!: string;
  @IsString() item!: string;
}

class LineDto {
  @IsString() product_id!: string;
  @IsInt() quantity!: number;
  @IsOptional() @IsArray() @IsString({ each: true }) additionals?: string[];
  @IsOptional() @IsString() size?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) flavors?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => OptionDto) options?: OptionDto[];
}

class CreateOrderDto {
  @IsString() @MinLength(2) @MaxLength(80) customer_name!: string;
  @IsString() @MinLength(8) @MaxLength(20) customer_phone!: string;
  @IsOptional() @IsEmail({}, { message: 'Informe um e-mail válido' }) customer_email?: string;
  @IsIn(['delivery', 'pickup']) delivery_type!: 'delivery' | 'pickup';
  @ValidateIf((o) => o.delivery_type === 'delivery') @IsString() @MinLength(5, { message: 'Informe o endereço de entrega' })
  @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @IsIn(['whatsapp', 'pix']) payment_method!: 'whatsapp' | 'pix';
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => LineDto) items!: LineDto[];
}

const REJECTED = ['refused', 'failed', 'canceled', 'cancelled', 'expired', 'chargeback'];

@Controller('api/public')
@Public() @SkipCsrf()
export class PublicMenuController {
  private readonly log = new Logger('Menu');

  constructor(
    @Inject(PRISMA) private db: Db, private pix: PixGateway, private plans: PlanService, private events: MenuEvents,
  ) {}

  /** só empresa aprovada, ativa e com o cardápio ligado tem cardápio público */
  private async company(slug: string) {
    const c = await this.db.company.findUnique({ where: { slug } });
    const m = c && menuOf(c);
    if (!c || !m?.enabled || !c.active || c.deletedAt || c.status !== 'aprovada') throw new NotFoundException('Cardápio não encontrado');
    return { c, m };
  }

  @Get('stores/:slug')
  async menu(@Param('slug') slug: string) {
    const { c, m } = await this.company(slug);
    const [categories, products] = await Promise.all([
      this.db.category.findMany({
        where: { companyId: c.id, active: true, deletedAt: null },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      }),
      this.db.product.findMany({
        where: { companyId: c.id, active: true, menuVisible: true, deletedAt: null },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    return {
      store: toApiStore(c, m),
      categories: categories.map((x) => ({ id: x.id, name: x.name, max_flavors: x.maxFlavors })),
      products: products.map(toApiProduct),
    };
  }

  @Post('stores/:slug/orders')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(@Param('slug') slug: string, @Body() b: CreateOrderDto) {
    const { c, m } = await this.company(slug);
    await this.plans.assertActive(c.id);
    if (!m.isOpen) throw new BadRequestException('A loja está fechada no momento');
    if (b.delivery_type === 'delivery' && !m.acceptsDelivery) throw new BadRequestException('A loja não faz entrega');
    if (b.delivery_type === 'pickup' && !m.acceptsPickup) throw new BadRequestException('A loja não aceita retirada');
    if (b.payment_method === 'pix' && !pixOn(c, m)) throw new BadRequestException('Pix indisponível nesta loja');
    if (b.payment_method === 'whatsapp' && !(m.whatsappEnabled && waPhone(c.whatsapp)))
      throw new BadRequestException('Pedido por WhatsApp indisponível nesta loja');

    const ids = b.items.flatMap((i) => [i.product_id, ...(i.flavors ?? [])]);
    const [products, categories] = await Promise.all([
      this.db.product.findMany({ where: { companyId: c.id, id: { in: ids }, deletedAt: null } }),
      this.db.category.findMany({ where: { companyId: c.id, deletedAt: null } }),
    ]);
    const maxFlavors = Object.fromEntries(categories.map((x) => [x.id, x.maxFlavors]));
    let cart: ReturnType<typeof priceCart>;
    try {
      cart = priceCart(
        b.items,
        products.map((p) => ({ ...p, ...menuOptions(p.menuOptions), available: p.active && p.menuVisible })),
        b.delivery_type === 'delivery' ? m.deliveryFeeCents : 0,
        maxFlavors,
      );
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    // número sequencial por empresa: trava a linha da empresa até o commit (mesmo esquema da venda)
    let order = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${c.id} FOR UPDATE`;
      const last = await tx.menuOrder.aggregate({ where: { companyId: c.id }, _max: { number: true } });
      return tx.menuOrder.create({
        data: {
          companyId: c.id,
          number: (last._max.number ?? 0) + 1,
          customerName: b.customer_name.trim(),
          customerPhone: b.customer_phone.trim(),
          deliveryType: b.delivery_type,
          address: b.delivery_type === 'delivery' ? (b.address ?? '').trim() : '',
          notes: (b.notes ?? '').trim(),
          items: JSON.stringify(cart.items),
          subtotalCents: cart.subtotalCents,
          deliveryFeeCents: cart.deliveryFeeCents,
          totalCents: cart.totalCents,
          paymentMethod: b.payment_method,
          paymentStatus: b.payment_method === 'pix' ? 'pending' : 'none',
        },
      });
    });

    if (b.payment_method === 'pix') {
      try {
        const charge = await this.pix.charge(c.id, order.totalCents, `Pedido #${order.number} - ${c.tradeName || c.name}`, {
          name: order.customerName, phone: order.customerPhone, email: b.customer_email,
        });
        order = await this.db.menuOrder.update({
          where: { id: order.id },
          data: { pixChargeId: charge.id, pixQrCode: charge.qrcode, pixQrImage: charge.qrImage.replace(/^data:image\/\w+;base64,/, '') },
        });
      } catch (e) {
        // sem QR Code o pedido não existe pro cliente nem pra loja
        await this.db.menuOrder.delete({ where: { id: order.id } });
        throw e;
      }
    } else {
      this.events.emit('new', order);
    }
    return this.toPublic(c, order);
  }

  private toPublic(c: Company, o: MenuOrder) {
    return {
      ...toApiOrder(o),
      store_slug: c.slug,
      whatsapp_url: whatsappUrl(c, o),
      pix: o.paymentMethod === 'pix' && o.paymentStatus === 'pending' ? { qr_code: o.pixQrCode, qr_code_base64: o.pixQrImage } : null,
    };
  }

  /** atualiza pix pendente consultando o gateway; erro do gateway não derruba a consulta */
  private async refresh(o: MenuOrder) {
    if (o.paymentMethod !== 'pix' || o.paymentStatus !== 'pending' || !o.pixChargeId) return o;
    try {
      const st = await this.pix.status(o.companyId, o.pixChargeId);
      const next = st.paid ? 'approved' : REJECTED.includes(st.status) ? 'rejected' : 'pending';
      if (next !== o.paymentStatus) {
        o = await this.db.menuOrder.update({
          where: { id: o.id },
          data: { paymentStatus: next, ...(next === 'rejected' ? { status: 'cancelled' } : {}) },
        });
        // Pix pago: só agora o pedido entra na fila da cozinha
        if (next === 'approved') this.events.emit('new', o);
      }
    } catch (e) {
      this.log.warn(`PIX ${o.pixChargeId}: ${(e as Error).message}`);
    }
    return o;
  }

  /** o cliente guarda os ids (uuid) dos próprios pedidos no navegador */
  @Get('orders')
  async mine(@Query('ids') ids = '') {
    const list = [...new Set(ids.split(',').filter(Boolean))].slice(0, 30);
    // findUnique por id: o id é o token do cliente, não precisa (nem tem) companyId
    const found = (await Promise.all(list.map((id) => this.db.menuOrder.findUnique({ where: { id }, include: { company: true } }))))
      .filter((o) => !!o)
      .sort((a, b) => +b.createdAt - +a.createdAt);
    return Promise.all(found.map(async ({ company, ...o }) => this.toPublic(company, await this.refresh(o))));
  }

  /** aviso do gateway: não confia no corpo, só usa como gatilho pra consultar */
  @Post('pix/webhook')
  @HttpCode(200)
  async webhook(@Query('order') id?: string) {
    const o = id ? await this.db.menuOrder.findUnique({ where: { id } }) : null;
    if (o) await this.refresh(o);
    return { ok: true };
  }
}

// ---------- backoffice (ERP) ----------

const STATUSES = ['pending', 'preparing', 'delivering', 'delivered', 'cancelled'];
const urlField = () => Matches(/^(\/[\w./-]+|https?:\/\/\S+)?$/, { message: 'URL de imagem inválida' });

class MenuSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(80) subtitle?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @urlField() logoUrl?: string;
  @IsOptional() @IsInt() @Min(20) @Max(120) logoSize?: number;
  @IsOptional() @IsBoolean() showName?: boolean;
  @IsOptional() @IsBoolean() showSubtitle?: boolean;
  @IsOptional() @urlField() bannerUrl?: string;
  @IsOptional() @urlField() coverUrl?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Cor inválida' }) primaryColor?: string;
  @IsOptional() @IsString() @MaxLength(60) instagram?: string;
  @IsOptional() @IsString() @MaxLength(60) hours?: string;
  @IsOptional() @IsString() @MaxLength(30) deliveryTime?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) deliveryFeeCents?: number;
  @IsOptional() @IsBoolean() isOpen?: boolean;
  @IsOptional() @IsBoolean() acceptsDelivery?: boolean;
  @IsOptional() @IsBoolean() acceptsPickup?: boolean;
  @IsOptional() @IsBoolean() whatsappEnabled?: boolean;
  @IsOptional() @IsBoolean() pixEnabled?: boolean;
}

class StatusDto {
  @IsIn(STATUSES) status!: string;
  /** entregue: forma em que o cliente pagou na entrega (pedido por WhatsApp) */
  @IsOptional() @IsString() paymentMethodId?: string;
  /** dinheiro entregue pelo cliente, para o troco */
  @IsOptional() @IsInt() @Min(0) receivedCents?: number;
  @IsOptional() @IsString() branchId?: string;
}

@Controller('api/menu')
export class MenuController {
  constructor(
    @Inject(PRISMA) private db: Db, private audit: AuditService, private sales: SalesService, private events: MenuEvents,
  ) {}

  /** a tela de pedidos fica ouvindo aqui: pedido novo ou mudança de status chega na hora */
  @Sse('events') @Perms('pedido.visualizar')
  @Header('X-Accel-Buffering', 'no') // nginx: não segurar o stream em buffer
  events$(@CurrentUser() u: SessionUser) {
    return this.events.stream(u.companyId);
  }

  @Get('settings') @Perms('pedido.visualizar')
  async settings(@CurrentUser() u: SessionUser) {
    const c = await this.db.company.findUniqueOrThrow({ where: { id: u.companyId } });
    const base = process.env.MENU_URL?.replace(/\/$/, '');
    return { slug: c.slug, menuUrl: base ? `${base}/${c.slug}` : null, pixReady: c.pixEnabled && !!c.pixSecretKey, ...menuOf(c) };
  }

  /** foto para o cardápio; devolve a URL pública para gravar no produto ou na loja */
  @Post('images') @Perms('produto.editar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024, files: 1 } }))
  async image(@CurrentUser() u: SessionUser, @UploadedFile() file?: UploadFile) {
    if (!file?.buffer?.length) throw new BadRequestException('Envie a imagem no campo "file".');
    // tipo pelo conteúdo, não pelo nome
    const type = IMAGE_TYPES.find((t) => t.match(file.buffer));
    if (!type) throw new BadRequestException('Formato não aceito. Envie JPG, PNG ou WEBP de até 3 MB.');
    const name = `${randomBytes(12).toString('hex')}.${type.ext}`;
    await mkdir(join(MENU_IMAGES_DIR, u.companyId), { recursive: true });
    await writeFile(join(MENU_IMAGES_DIR, u.companyId, name), file.buffer);
    return { url: `/uploads/menu/${u.companyId}/${name}` };
  }

  @Patch('settings') @Perms('cardapio.gerenciar')
  async saveSettings(@CurrentUser() u: SessionUser, @Body() dto: MenuSettingsDto, @Req() req: Request) {
    const c = await this.db.company.findUniqueOrThrow({ where: { id: u.companyId } });
    const next = { ...menuOf(c), ...dto };
    await this.db.company.update({ where: { id: u.companyId }, data: { menuSettings: JSON.stringify(next) } });
    await this.audit.log(u, 'update', 'MenuSettings', u.companyId, dto, req.ip);
    return next;
  }

  @Get('orders') @Perms('pedido.visualizar')
  async orders(
    @CurrentUser() u: SessionUser,
    @Query('status') status = '', @Query('search') search = '',
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
  ) {
    const p = paging(page, pageSize);
    const term = search.trim();
    const where = {
      companyId: u.companyId,
      ...(status ? { status: { in: status.split(',') } } : {}),
      // pix ainda não pago não é pedido para a cozinha
      NOT: { paymentStatus: { in: ['pending', 'rejected'] } },
      ...(term ? {
        OR: [
          { customerName: { contains: term, mode: 'insensitive' as const } },
          { customerPhone: { contains: term } },
          ...(Number(term) ? [{ number: Number(term) }] : []),
        ],
      } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.menuOrder.findMany({ where, orderBy: { createdAt: 'desc' }, take: p.take, skip: p.skip }),
      this.db.menuOrder.count({ where }),
    ]);
    return {
      rows: rows.map(({ pixQrImage, pixQrCode, items, ...o }) => ({ ...o, items: JSON.parse(items) })),
      total, page: p.page, pageSize: p.pageSize,
    };
  }

  @Patch('orders/:id/status') @Perms('pedido.gerenciar')
  async setStatus(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: StatusDto, @Req() req: Request) {
    const o = await this.db.menuOrder.findFirst({ where: { id, companyId: u.companyId } });
    if (!o) throw new NotFoundException('Pedido não encontrado.');
    if (o.saleId) throw new BadRequestException('Pedido já entregue e lançado como venda. Para desfazer, cancele a venda.');
    if (dto.status !== 'cancelled' && ['pending', 'rejected'].includes(o.paymentStatus)) {
      throw new BadRequestException('Pix ainda não foi pago.');
    }
    const saleId = dto.status === 'delivered' ? await this.toSale(u, o, dto, req.ip) : null;
    const updated = await this.db.menuOrder.update({ where: { id }, data: { status: dto.status, ...(saleId ? { saleId } : {}) } });
    await this.audit.log(u, 'status', 'MenuOrder', id, { numero: o.number, de: o.status, para: dto.status }, req.ip);
    this.events.emit('update', updated);
    const { pixQrImage, pixQrCode, items, ...rest } = updated;
    return { ...rest, items: JSON.parse(items) };
  }

  /**
   * Pedido entregue vira venda pelas mesmas regras do PDV: caixa aberto, baixa de estoque,
   * movimento de caixa e receita no financeiro. Chave de idempotência pelo pedido: clique
   * duplo ou nova tentativa devolve a mesma venda.
   */
  private async toSale(u: SessionUser, o: MenuOrder, dto: StatusDto, ip?: string) {
    let payment: { paymentMethodId: string; amountCents: number; receivedCents?: number };
    if (o.paymentMethod === 'pix') {
      const pix = await this.db.paymentMethod.findFirst({
        where: { companyId: u.companyId, type: 'pix', active: true, deletedAt: null }, orderBy: { sortOrder: 'asc' },
      });
      if (!pix) throw new BadRequestException('Ative a forma de pagamento PIX para lançar pedidos pagos no cardápio.');
      payment = { paymentMethodId: pix.id, amountCents: o.totalCents };
    } else {
      if (!dto.paymentMethodId) throw new BadRequestException('Informe como o cliente pagou na entrega.');
      const m = await this.db.paymentMethod.findFirst({ where: { id: dto.paymentMethodId, companyId: u.companyId, deletedAt: null } });
      // crediário exige cliente cadastrado na venda; pedido do cardápio não tem
      if (m?.type === 'crediario') throw new BadRequestException('Crediário não vale para pedido do cardápio.');
      payment = { paymentMethodId: dto.paymentMethodId, amountCents: o.totalCents, receivedCents: dto.receivedCents };
    }

    const items = itemsOf(o).map((i) => ({
      productId: i.productId, quantity: i.quantity, unitPriceCents: i.unitCents,
      menuName: [i.name, ...i.additionals.map((a) => a.name)].join(' + ').slice(0, 200),
    }));
    if (o.deliveryFeeCents) {
      items.push({ productId: await this.feeProduct(u.companyId), quantity: 1, unitPriceCents: o.deliveryFeeCents, menuName: 'Taxa de entrega' });
    }

    const sale = await this.sales.create(
      { companyId: u.companyId, branchId: u.branchId, role: MENU_ROLE, userId: u.sub, sellerId: null },
      {
        branchId: dto.branchId, items, payments: [payment], idempotencyKey: `menu:${o.id}`,
        notes: [`Pedido #${o.number} do cardápio`, `${o.customerName} (${o.customerPhone})`,
          o.deliveryType === 'delivery' ? `Entrega: ${o.address}` : 'Retirada', o.notes].filter(Boolean).join(' · '),
      },
      ip, undefined,
      o.paymentMethod === 'pix'
        ? { offline: false, paidInApp: true, appPaymentMethod: 'pix', appPaymentRef: o.pixChargeId }
        : undefined,
    );
    return sale.id;
  }

  private async feeProduct(companyId: string) {
    const found = await this.db.product.findFirst({ where: { companyId, sku: MENU_FEE_SKU, deletedAt: null } });
    if (found) return found.id;
    const created = await this.db.product.create({
      data: { companyId, sku: MENU_FEE_SKU, name: 'Taxa de entrega', priceCents: 0, description: 'Criado pelo cardápio digital.' },
    });
    return created.id;
  }
}

@Module({ imports: [PaymentsModule, SalesModule], controllers: [PublicMenuController, MenuController], providers: [MenuEvents] })
export class MenuModule {}
