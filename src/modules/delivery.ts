// Entregas pelo motoboy: o pedido de entrega que a cozinha marcou "pronto" aparece para todos os motoboys,
// um aceita (só um consegue), leva, marca entregue e diz como o cliente pagou. A venda sai no acerto
// do motoboy no caixa (MenuController.settle). O ERP acompanha no mapa onde cada motoboy está.
import {
  BadRequestException, Body, ConflictException, Controller, Get, Header, HttpCode, Inject, Logger, Module,
  NotFoundException, Param, Patch, Post, Query, Sse,
} from '@nestjs/common';
import {
  ArrayMaxSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Company, MenuOrder } from '@prisma/client';
import { PRISMA, Db, Tx, TX } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService, TimeService } from '../common/core';
import { DATE_RE } from '../common/util';
import { FieldModule, GeoService, PingDto } from './field';
import { MenuEvents, MenuModule, menuOf, OrderItem, toApiStore } from './menu';
import { enqueueDelivery } from './whatsapp-events';

class CourierPingsDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => PingDto) pings!: PingDto[];
}

class DeliveredDto {
  /** como o cliente pagou na porta; Pix pago no cardápio não precisa */
  @IsOptional() @IsString() paymentMethodId?: string;
  /** dinheiro recebido, para o troco */
  @IsOptional() @IsInt() @Min(0) receivedCents?: number;
}

class GeoDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

type Point = { lat: number; lng: number };

/** pedido para o app do motoboy e para o mapa do ERP (sem dados do Pix) */
const toCourierOrder = (o: MenuOrder) => ({
  id: o.id,
  number: o.number,
  status: o.status,
  customerName: o.customerName,
  customerPhone: o.customerPhone,
  address: o.address,
  notes: o.notes,
  lat: o.lat,
  lng: o.lng,
  geoSource: o.geoSource,
  totalCents: o.totalCents,
  deliveryFeeCents: o.deliveryFeeCents,
  paymentMethod: o.paymentMethod, // pix = já pago; whatsapp = cobrar na entrega
  courierId: o.courierId,
  courierAt: o.courierAt,
  deliveredAt: o.deliveredAt,
  courierPaymentMethodId: o.courierPaymentMethodId,
  courierReceivedCents: o.courierReceivedCents,
  readyAt: o.readyAt,
  items: (JSON.parse(o.items) as OrderItem[]).map((i) => ({ name: i.name, quantity: i.quantity })),
});

/** pronto, de entrega, sem motoboy e sem Pix pendente: qualquer motoboy pode pegar */
const available = (companyId: string) => ({
  companyId, deliveryType: 'delivery', status: 'ready', courierId: null, saleId: null,
  paymentStatus: { notIn: ['pending', 'rejected'] },
});

/** distância em metros em linha reta */
const meters = (a: Point, b: Point) => {
  const rad = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(x));
};

/** ordem "vai no mais perto" — reserva para quando o serviço de rota não responde */
function nearestOrder<T extends Point>(start: Point, stops: T[]): T[] {
  const left = [...stops];
  const out: T[] = [];
  let at: Point = start;
  while (left.length) {
    let best = 0;
    left.forEach((s, i) => { if (meters(at, s) < meters(at, left[best])) best = i; });
    const next = left.splice(best, 1)[0];
    out.push(next);
    at = next;
  }
  return out;
}

/**
 * Rota pelas ruas com a melhor ordem das paradas (OSRM `trip`, que resolve o caixeiro-viajante).
 * ponytail: o OSRM público (router.project-osrm.org) é só para teste; em produção aponte ROUTING_URL
 * para um OSRM próprio ou provedor com chave. Sem resposta, liga as paradas em linha reta.
 */
async function planRoute(start: Point, stops: (Point & { id: string })[], log: Logger) {
  if (!stops.length) return { order: [] as string[], path: [] as [number, number][], meters: 0, seconds: null as number | null, source: 'none' };
  const base = (process.env.ROUTING_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
  const coords = [start, ...stops].map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  try {
    const res = await fetch(`${base}/trip/v1/driving/${coords}?source=first&roundtrip=false&overview=full&geometries=geojson`, {
      signal: AbortSignal.timeout(8000),
    });
    const r = await res.json() as {
      code: string; waypoints: { waypoint_index: number }[];
      trips: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }[];
    };
    if (r.code !== 'Ok') throw new Error(r.code);
    // waypoints[i] = i-ésimo ponto enviado; waypoint_index = posição dele na viagem (0 = motoboy)
    const order = stops
      .map((s, i) => ({ id: s.id, pos: r.waypoints[i + 1].waypoint_index }))
      .sort((a, b) => a.pos - b.pos)
      .map((x) => x.id);
    const trip = r.trips[0];
    return {
      order, path: trip.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
      meters: Math.round(trip.distance), seconds: Math.round(trip.duration), source: 'osrm',
    };
  } catch (e) {
    log.warn(`Rota: ${(e as Error).message}`);
    const seq = nearestOrder(start, stops);
    const path = [start, ...seq].map((p) => [p.lat, p.lng] as [number, number]);
    const total = seq.reduce((s, p, i) => s + meters(i ? seq[i - 1] : start, p), 0);
    return { order: seq.map((s) => s.id), path, meters: Math.round(total), seconds: null, source: 'line' };
  }
}

/** ponto da loja no mapa: calculado do endereço da empresa uma vez e guardado */
async function storePoint(db: Db, geo: GeoService, c: Company): Promise<Point | null> {
  if (c.lat != null && c.lng != null) return { lat: c.lat, lng: c.lng };
  if (!c.address && !c.zip) return null;
  try {
    const hit = await geo.locate({ zip: c.zip, street: c.address, number: c.number, district: c.district, city: c.city, state: c.state });
    if (!hit) return null;
    await db.company.update({ where: { id: c.id }, data: { lat: hit.lat, lng: hit.lng } });
    return { lat: hit.lat, lng: hit.lng };
  } catch {
    return null;
  }
}

// ---------- app do motoboy (/motoboy) ----------

@Controller('api/courier')
@Perms('entrega.realizar')
export class CourierController {
  private readonly log = new Logger('Entregas');

  constructor(
    @Inject(PRISMA) private db: Db, private events: MenuEvents, private geo: GeoService, private clock: TimeService,
    private audit: AuditService,
  ) {}

  /** cores, nome e logo da loja (o app usa as mesmas do delivery) */
  @Get('store')
  async store(@CurrentUser() u: SessionUser) {
    const c = await this.db.company.findUniqueOrThrow({ where: { id: u.companyId } });
    return { store: toApiStore(c, menuOf(c)), categories: [], products: [] };
  }

  /** formas de cobrar na entrega (crediário não vale para pedido do cardápio) */
  @Get('payment-methods')
  async paymentMethods(@CurrentUser() u: SessionUser) {
    const rows = await this.db.paymentMethod.findMany({
      where: { companyId: u.companyId, active: true, deletedAt: null, type: { not: 'crediario' } },
      orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, type: true },
    });
    return { rows };
  }

  /** disponíveis para pegar e as que estão comigo; `store` é o ponto de saída no mapa */
  @Get('orders')
  async orders(@CurrentUser() u: SessionUser) {
    const c = await this.db.company.findUniqueOrThrow({ where: { id: u.companyId } });
    const [free, mine] = await Promise.all([
      this.db.menuOrder.findMany({ where: available(u.companyId), orderBy: { readyAt: 'asc' } }),
      this.db.menuOrder.findMany({
        where: { companyId: u.companyId, courierId: u.sub, status: 'delivering', saleId: null }, orderBy: { courierAt: 'asc' },
      }),
    ]);
    return { store: await storePoint(this.db, this.geo, c), available: free.map(toCourierOrder), mine: mine.map(toCourierOrder) };
  }

  /** aceitar: a troca só acontece se ninguém pegou antes (dois toques ao mesmo tempo, um ganha) */
  @Post('orders/:id/accept') @HttpCode(200)
  async accept(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const { o, accepted } = await this.db.$transaction(async (tx) => {
      const r = await tx.menuOrder.updateMany({
        where: { id, ...available(u.companyId) },
        data: { courierId: u.sub, courierAt: new Date(), status: 'delivering' },
      });
      const o = await tx.menuOrder.findFirst({ where: { id, companyId: u.companyId } });
      if (!o || o.deliveryType !== 'delivery') throw new NotFoundException('Pedido não encontrado.');
      if (!r.count && !(o.courierId === u.sub && o.status === 'delivering')) {
        throw new ConflictException(o.courierId ? 'Outro motoboy já pegou este pedido.' : 'Este pedido não está mais disponível.');
      }
      if (r.count) await enqueueDelivery(tx as Tx, o, 'dispatched');
      return { o, accepted: !!r.count };
    }, TX);
    if (!accepted) return toCourierOrder(o); // toque repetido
    await this.audit.log(u, 'courier_accept', 'MenuOrder', id, { numero: o.number });
    this.events.emit('update', o);
    return toCourierOrder(o);
  }

  /** devolver para a fila (não vai conseguir levar) */
  @Post('orders/:id/release') @HttpCode(200)
  async release(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const r = await this.db.menuOrder.updateMany({
      where: { id, companyId: u.companyId, courierId: u.sub, status: 'delivering', deliveredAt: null, saleId: null },
      data: { courierId: null, courierAt: null, status: 'ready' },
    });
    if (!r.count) throw new BadRequestException('Este pedido não está com você.');
    const o = await this.db.menuOrder.findUniqueOrThrow({ where: { id } });
    await this.audit.log(u, 'courier_release', 'MenuOrder', id, { numero: o.number });
    this.events.emit('update', o);
    return toCourierOrder(o);
  }

  /** entregue: diz como o cliente pagou; a venda sai no acerto do caixa */
  @Post('orders/:id/delivered') @HttpCode(200)
  async delivered(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: DeliveredDto) {
    const o = await this.db.menuOrder.findFirst({
      where: { id, companyId: u.companyId, courierId: u.sub, status: 'delivering', saleId: null },
    });
    if (!o) throw new BadRequestException('Este pedido não está com você.');
    let methodId: string | null = null;
    if (o.paymentMethod !== 'pix') {
      const m = dto.paymentMethodId && await this.db.paymentMethod.findFirst({
        where: { id: dto.paymentMethodId, companyId: u.companyId, active: true, deletedAt: null, type: { not: 'crediario' } },
      });
      if (!m) throw new BadRequestException('Informe como o cliente pagou.');
      if (dto.receivedCents != null && m.type === 'dinheiro' && dto.receivedCents < o.totalCents) {
        throw new BadRequestException('Valor recebido menor que o total do pedido.');
      }
      methodId = m.id;
    }
    const updated = await this.db.menuOrder.update({
      where: { id },
      data: {
        status: 'delivered', deliveredAt: new Date(), courierPaymentMethodId: methodId,
        courierReceivedCents: methodId ? dto.receivedCents ?? null : null,
      },
    });
    await this.audit.log(u, 'courier_delivered', 'MenuOrder', id, { numero: o.number, forma: methodId });
    this.events.emit('update', updated);
    return toCourierOrder(updated);
  }

  /** posição do aparelho, em lote (o app guarda enquanto está sem sinal) */
  @Post('pings') @HttpCode(200)
  async pings(@CurrentUser() u: SessionUser, @Body() dto: CourierPingsDto) {
    const now = Date.now();
    const valid = dto.pings
      .map((p) => ({ ...p, when: new Date(p.at) }))
      .filter((p) => !Number.isNaN(p.when.getTime()) && p.when.getTime() <= now + 60_000)
      .sort((a, b) => a.when.getTime() - b.when.getTime());
    if (!valid.length) return { accepted: 0 };
    const rows: { companyId: string; userId: string; lat: number; lng: number; accuracy: number | null; at: Date; localDate: string }[] = [];
    for (const p of valid) {
      rows.push({
        companyId: u.companyId, userId: u.sub, lat: p.lat, lng: p.lng, accuracy: p.accuracy ?? null, at: p.when,
        localDate: (await this.clock.now(u.companyId, p.when)).slice(0, 10),
      });
    }
    await this.db.courierPing.createMany({ data: rows });
    const last = valid[valid.length - 1];
    const cur = await this.db.courierPosition.findUnique({ where: { userId: u.sub } });
    // ping atrasado da fila offline não volta o motoboy no mapa
    if (!cur || cur.at <= last.when) {
      const data = { companyId: u.companyId, lat: last.lat, lng: last.lng, accuracy: last.accuracy ?? null, at: last.when };
      await this.db.courierPosition.upsert({ where: { userId: u.sub }, create: { userId: u.sub, ...data }, update: data });
      this.events.courier(u.companyId, u.sub, u.name, { lat: last.lat, lng: last.lng, at: last.when });
    }
    return { accepted: rows.length };
  }

  /** rota das minhas entregas a partir de onde estou (ou da loja) */
  @Get('route')
  async route(@CurrentUser() u: SessionUser, @Query('lat') qlat?: string, @Query('lng') qlng?: string) {
    const mine = await this.db.menuOrder.findMany({
      where: { companyId: u.companyId, courierId: u.sub, status: 'delivering', saleId: null },
    });
    const stops = mine.filter((o) => o.lat != null && o.lng != null).map((o) => ({ id: o.id, lat: o.lat!, lng: o.lng! }));
    let start: Point | null = Number.isFinite(Number(qlat)) && Number.isFinite(Number(qlng)) && qlat && qlng
      ? { lat: Number(qlat), lng: Number(qlng) } : null;
    if (!start) {
      const pos = await this.db.courierPosition.findUnique({ where: { userId: u.sub } });
      if (pos) start = { lat: pos.lat, lng: pos.lng };
    }
    if (!start) {
      const c = await this.db.company.findUniqueOrThrow({ where: { id: u.companyId } });
      start = await storePoint(this.db, this.geo, c);
    }
    if (!start) start = stops[0] ?? null;
    const plan = start ? await planRoute(start, stops, this.log) : { order: [], path: [], meters: 0, seconds: null, source: 'none' };
    return { start, ...plan, unlocated: mine.filter((o) => o.lat == null).map((o) => o.id) };
  }

  /** ao vivo: pedido de entrega novo, pronto, pego por outro ou cancelado */
  @Sse('events')
  @Header('X-Accel-Buffering', 'no')
  events$(@CurrentUser() u: SessionUser) {
    return this.events.stream(u.companyId, (e) => (e.type === 'new' || e.type === 'update') && e.deliveryType === 'delivery');
  }
}

// ---------- ERP: mapa das entregas e acerto ----------

@Controller('api/deliveries')
@Perms('entrega.monitorar')
export class DeliveriesController {
  constructor(@Inject(PRISMA) private db: Db, private events: MenuEvents, private geo: GeoService, private clock: TimeService) {}

  /**
   * Tudo que o mapa mostra: loja, motoboys (posição e o que levam), pedidos prontos sem motoboy
   * e entregues aguardando acerto.
   */
  @Get('live')
  async live(@CurrentUser() u: SessionUser) {
    const c = await this.db.company.findUniqueOrThrow({ where: { id: u.companyId } });
    const [users, positions, orders] = await Promise.all([
      this.db.user.findMany({
        where: { companyId: u.companyId, role: 'motoboy', active: true, deletedAt: null }, select: { id: true, name: true },
      }),
      this.db.courierPosition.findMany({ where: { companyId: u.companyId }, include: { user: { select: { id: true, name: true } } } }),
      this.db.menuOrder.findMany({
        where: {
          companyId: u.companyId, deliveryType: 'delivery', saleId: null,
          OR: [{ status: 'delivering' }, available(u.companyId), { status: 'delivered', courierId: { not: null } }],
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    // motoboy de outro perfil (gerente fazendo entrega) também aparece se mandou posição
    const people = new Map(users.map((x) => [x.id, x.name]));
    for (const p of positions) people.set(p.userId, p.user.name);
    for (const o of orders) if (o.courierId && !people.has(o.courierId)) people.set(o.courierId, '');
    const missing = [...people].filter(([, n]) => !n).map(([id]) => id);
    if (missing.length) {
      for (const x of await this.db.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } })) people.set(x.id, x.name);
    }
    const pos = new Map(positions.map((p) => [p.userId, p]));
    const list = orders.map(toCourierOrder);
    return {
      store: await storePoint(this.db, this.geo, c),
      couriers: [...people].map(([id, name]) => {
        const p = pos.get(id);
        return {
          id, name, lat: p?.lat ?? null, lng: p?.lng ?? null, at: p?.at ?? null,
          delivering: list.filter((o) => o.courierId === id && o.status === 'delivering').map((o) => o.id),
        };
      }),
      orders: list,
    };
  }

  /** trajeto do motoboy no dia */
  @Get('track')
  async track(@CurrentUser() u: SessionUser, @Query('userId') userId: string, @Query('date') date?: string) {
    const day = date && DATE_RE.test(date) ? date : await this.clock.today(u.companyId);
    const rows = await this.db.courierPing.findMany({
      where: { companyId: u.companyId, userId, localDate: day }, orderBy: { at: 'asc' }, select: { lat: true, lng: true, at: true },
    });
    return { rows };
  }

  /** ajuste do ponto da entrega (endereço que o mapa não achou ou achou errado) */
  @Patch('orders/:id/geo')
  async setGeo(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: GeoDto) {
    const r = await this.db.menuOrder.updateMany({
      where: { id, companyId: u.companyId, deliveryType: 'delivery' }, data: { lat: dto.lat, lng: dto.lng, geoSource: 'manual' },
    });
    if (!r.count) throw new NotFoundException('Pedido não encontrado.');
    const o = await this.db.menuOrder.findUniqueOrThrow({ where: { id } });
    this.events.emit('update', o);
    return toCourierOrder(o);
  }

  /** ao vivo: posição dos motoboys e mudança dos pedidos de entrega */
  @Sse('events')
  @Header('X-Accel-Buffering', 'no')
  events$(@CurrentUser() u: SessionUser) {
    return this.events.stream(u.companyId, (e) => e.type === 'courier' || e.deliveryType === 'delivery');
  }
}

@Module({ imports: [MenuModule, FieldModule], controllers: [CourierController, DeliveriesController] })
export class DeliveryModule {}
