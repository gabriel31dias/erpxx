import {
  BadRequestException, Body, Controller, Delete, Get, Inject, Injectable, Logger, Module, NotFoundException,
  Param, Patch, Post, Put, Query, Req,
} from '@nestjs/common';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min, MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService, SettingsService, TimeService } from '../common/core';
import { DATE_RE, DT_RE } from '../common/util';

export const RECURRENCES = ['ALWAYS', 'WEEKDAYS', 'ONCE'];
export const OUTCOMES = ['VENDA', 'SEM_VENDA', 'FECHADO', 'AUSENTE'];
const SEG_A_SAB = 0b1111110; // "Sempre": segunda a sábado

/** Dia da semana de "YYYY-MM-DD" (0 = domingo). */
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Distância em metros entre dois pontos (haversine). */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(h)));
}

/** O roteiro vale nesta data? */
export function routeRunsOn(route: { recurrence: string; weekdays: number; date: string | null; startDate: string | null; endDate: string | null }, date: string) {
  if (route.startDate && date < route.startDate) return false;
  if (route.endDate && date > route.endDate) return false;
  if (route.recurrence === 'ONCE') return route.date === date;
  const mask = route.recurrence === 'ALWAYS' ? SEG_A_SAB : route.weekdays;
  return (mask & (1 << weekday(date))) !== 0;
}

/**
 * Situação da parada no dia: registrada na visita, ou derivada —
 * dia passado sem registro = não visitada (MISSED); hoje/futuro = pendente.
 */
function stopStatus(visit: { status: string } | undefined, date: string, today: string) {
  if (visit) return visit.status;
  return date < today ? 'MISSED' : 'PENDING';
}

const CUSTOMER_GEO = { id: true, name: true, address: true, phone: true, lat: true, lng: true } as const;

@Injectable()
export class FieldService {
  constructor(
    @Inject(PRISMA) private db: Db,
    private settings: SettingsService,
    private clock: TimeService,
    private audit: AuditService,
  ) {}

  /**
   * Agenda dos vendedores num dia: paradas dos roteiros válidos (sem repetir
   * cliente) + visitas fora do roteiro. Um só lugar para o app e para o mapa.
   */
  async agenda(companyId: string, date: string, sellerIds?: string[]) {
    const today = await this.clock.today(companyId);
    const [routes, visits] = await Promise.all([
      this.db.route.findMany({
        where: { companyId, deletedAt: null, active: true, ...(sellerIds ? { sellerId: { in: sellerIds } } : {}) },
        orderBy: { name: 'asc' },
        include: {
          stops: {
            orderBy: { position: 'asc' },
            where: { customer: { deletedAt: null } },
            include: { customer: { select: CUSTOMER_GEO } },
          },
        },
      }),
      this.db.visit.findMany({
        where: { companyId, date, ...(sellerIds ? { sellerId: { in: sellerIds } } : {}) },
        include: { customer: { select: CUSTOMER_GEO } },
      }),
    ]);
    const visitOf = new Map(visits.map((v) => [`${v.sellerId}:${v.customerId}`, v]));
    const bySeller = new Map<string, any[]>();
    const push = (sellerId: string, stop: any) => {
      if (!bySeller.has(sellerId)) bySeller.set(sellerId, []);
      bySeller.get(sellerId)!.push(stop);
    };

    const planned = new Set<string>();
    for (const route of routes) {
      if (!routeRunsOn(route, date)) continue;
      for (const s of route.stops) {
        const key = `${route.sellerId}:${s.customerId}`;
        if (planned.has(key)) continue; // mesmo cliente em dois roteiros do dia: uma visita só
        planned.add(key);
        const visit = visitOf.get(key);
        push(route.sellerId, {
          customer: s.customer, routeId: route.id, routeName: route.name, notes: s.notes, planned: true,
          status: stopStatus(visit, date, today), visit: visit ? this.visitView(visit) : null,
        });
      }
    }
    for (const v of visits) {
      if (planned.has(`${v.sellerId}:${v.customerId}`)) continue;
      push(v.sellerId, {
        customer: v.customer, routeId: null, routeName: null, notes: null, planned: false,
        status: v.status, visit: this.visitView(v),
      });
    }
    bySeller.forEach((stops) => stops.forEach((s, i) => { s.order = i + 1; }));
    return bySeller;
  }

  visitView(v: any) {
    return {
      id: v.id, status: v.status, checkInAt: v.checkInAt, checkOutAt: v.checkOutAt,
      checkInLat: v.checkInLat, checkInLng: v.checkInLng, accuracyM: v.accuracyM,
      distanceM: v.distanceM, outOfRange: v.outOfRange, mockLocation: v.mockLocation,
      outcome: v.outcome, reason: v.reason, saleId: v.saleId,
    };
  }

  /** "YYYY-MM-DD HH:mm" do aparelho (para fila offline) ou agora; nunca no futuro. */
  private async when(companyId: string, at?: string) {
    const now = await this.clock.now(companyId);
    return at && at < now ? at : now;
  }

  /**
   * Check-in: grava a chegada com a posição e a distância até o cliente. Longe do
   * raio vira `outOfRange` (a visita vale, o gestor vê o alerta). Repetir o
   * check-in do mesmo cliente no mesmo dia devolve a visita já aberta.
   * Cliente sem coordenada ganha a do primeiro check-in preciso.
   */
  async checkIn(companyId: string, sellerId: string, dto: CheckInDto) {
    const customer = await this.db.customer.findFirst({
      where: { id: dto.customerId, companyId, deletedAt: null },
      select: { id: true, name: true, lat: true, lng: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');
    const at = await this.when(companyId, dto.at);
    const date = at.slice(0, 10);

    const existing = await this.db.visit.findUnique({
      where: { sellerId_customerId_date: { sellerId, customerId: customer.id, date } },
    });
    if (existing && existing.status !== 'SKIPPED') return this.visitView(existing);

    const settings = await this.settings.of(companyId);
    const hasGeo = customer.lat !== null && customer.lng !== null;
    const dist = hasGeo ? distanceM(dto.lat, dto.lng, customer.lat!, customer.lng!) : null;
    const routeId = await this.plannedRoute(companyId, sellerId, customer.id, date);
    const data = {
      status: 'IN_PROGRESS', routeId, checkInAt: at, checkInLat: dto.lat, checkInLng: dto.lng,
      accuracyM: dto.accuracy ?? null, distanceM: dist,
      outOfRange: dist !== null && dist > settings.visitRadiusM, mockLocation: !!dto.mock,
      checkOutAt: null, outcome: null, reason: null,
    };
    let visit;
    try {
      visit = existing
        ? await this.db.visit.update({ where: { id: existing.id }, data })
        : await this.db.visit.create({ data: { ...data, companyId, sellerId, customerId: customer.id, date } });
    } catch (e) {
      // dois check-ins simultâneos (reenvio da fila): o segundo devolve o primeiro
      if ((e as { code?: string }).code !== 'P2002') throw e;
      return this.visitView(await this.db.visit.findUniqueOrThrow({
        where: { sellerId_customerId_date: { sellerId, customerId: customer.id, date } },
      }));
    }

    if (!hasGeo && !dto.mock && (dto.accuracy ?? Infinity) <= settings.visitRadiusM) {
      await this.db.customer.update({ where: { id: customer.id }, data: { lat: dto.lat, lng: dto.lng, geoSource: 'checkin' } });
    }
    await this.touch(companyId, sellerId, dto.lat, dto.lng, dto.accuracy);
    if (visit.outOfRange || visit.mockLocation) {
      await this.audit.log({ companyId }, 'visit_alert', 'Visit', visit.id, {
        cliente: customer.name, distanciaM: dist, raioM: settings.visitRadiusM, simulada: visit.mockLocation,
      });
    }
    return this.visitView(visit);
  }

  async checkOut(companyId: string, sellerId: string, visitId: string, dto: CheckOutDto) {
    const visit = await this.db.visit.findFirst({ where: { id: visitId, companyId, sellerId } });
    if (!visit) throw new NotFoundException('Visita não encontrada.');
    if (visit.status === 'SKIPPED') throw new BadRequestException('Visita justificada não tem saída.');
    if (dto.saleId) {
      const sale = await this.db.sale.findFirst({ where: { id: dto.saleId, companyId, sellerId }, select: { id: true } });
      if (!sale) throw new BadRequestException('Venda não encontrada para este vendedor.');
    }
    if (dto.outcome !== 'VENDA' && !dto.reason?.trim()) {
      throw new BadRequestException('Informe o motivo de a visita não ter virado venda.');
    }
    const at = await this.when(companyId, dto.at);
    const updated = await this.db.visit.update({
      where: { id: visitId },
      data: {
        status: 'DONE', checkOutAt: at < (visit.checkInAt ?? at) ? visit.checkInAt : at,
        outcome: dto.outcome, reason: dto.reason?.trim() || null, saleId: dto.saleId ?? visit.saleId,
      },
    });
    if (dto.lat !== undefined && dto.lng !== undefined) await this.touch(companyId, sellerId, dto.lat, dto.lng, dto.accuracy);
    return this.visitView(updated);
  }

  /** Não vai visitar (loja fechada, rota interrompida…): fica justificado no mapa em vez de "não visitado". */
  async skip(companyId: string, sellerId: string, dto: SkipDto) {
    const customer = await this.db.customer.findFirst({ where: { id: dto.customerId, companyId, deletedAt: null }, select: { id: true } });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');
    const date = dto.date ?? await this.clock.today(companyId);
    const existing = await this.db.visit.findUnique({ where: { sellerId_customerId_date: { sellerId, customerId: customer.id, date } } });
    if (existing && existing.status !== 'SKIPPED') throw new BadRequestException('Este cliente já teve check-in hoje.');
    const routeId = await this.plannedRoute(companyId, sellerId, customer.id, date);
    const visit = await this.db.visit.upsert({
      where: { sellerId_customerId_date: { sellerId, customerId: customer.id, date } },
      create: { companyId, sellerId, customerId: customer.id, date, routeId, status: 'SKIPPED', reason: dto.reason.trim() },
      update: { reason: dto.reason.trim() },
    });
    return this.visitView(visit);
  }

  /** Roteiro do vendedor que prevê este cliente na data (null = visita fora do roteiro). */
  private async plannedRoute(companyId: string, sellerId: string, customerId: string, date: string) {
    const routes = await this.db.route.findMany({
      where: { companyId, sellerId, deletedAt: null, active: true, stops: { some: { customerId } } },
    });
    return routes.find((r) => routeRunsOn(r, date))?.id ?? null;
  }

  /** Lote de posições do app. Guarda o trajeto e atualiza a última posição do vendedor. */
  async pings(companyId: string, sellerId: string, pings: PingDto[]) {
    const now = Date.now();
    const valid = pings
      .map((p) => ({ ...p, when: new Date(p.at) }))
      .filter((p) => !Number.isNaN(p.when.getTime()) && p.when.getTime() <= now + 60_000)
      .sort((a, b) => a.when.getTime() - b.when.getTime());
    if (!valid.length) return { accepted: 0 };
    const rows: Array<{ companyId: string; sellerId: string; lat: number; lng: number; accuracy: number | null; at: Date; localDate: string }> = [];
    for (const p of valid) {
      rows.push({
        companyId, sellerId, lat: p.lat, lng: p.lng, accuracy: p.accuracy ?? null, at: p.when,
        localDate: (await this.clock.now(companyId, p.when)).slice(0, 10),
      });
    }
    await this.db.sellerPing.createMany({ data: rows });
    const last = valid[valid.length - 1];
    await this.touch(companyId, sellerId, last.lat, last.lng, last.accuracy, last.when);
    return { accepted: rows.length };
  }

  /** Última posição conhecida (só avança: ping atrasado da fila offline não volta o vendedor no mapa). */
  private async touch(companyId: string, sellerId: string, lat: number, lng: number, accuracy?: number, at = new Date()) {
    await this.db.seller.updateMany({
      where: { id: sellerId, companyId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lte: at } }] },
      data: { lastLat: lat, lastLng: lng, lastAccuracy: accuracy ?? null, lastSeenAt: at },
    });
  }
}

// ======================= DTOs =======================

export class CheckInDto {
  @IsString() customerId!: string;
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @IsNumber() @Min(0) accuracy?: number;
  /** Momento no aparelho ("YYYY-MM-DD HH:mm", fuso da loja) — check-in feito sem rede. */
  @IsOptional() @Matches(DT_RE, { message: 'at deve ser "YYYY-MM-DD HH:mm".' }) at?: string;
  /** Android informa localização simulada (isMock / isFromMockProvider). */
  @IsOptional() @IsBoolean() mock?: boolean;
}

export class CheckOutDto {
  @IsIn(OUTCOMES, { message: `outcome deve ser ${OUTCOMES.join(', ')}.` }) outcome!: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() saleId?: string;
  @IsOptional() @Matches(DT_RE) at?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @IsNumber() @Min(0) accuracy?: number;
}

export class SkipDto {
  @IsString() customerId!: string;
  @IsString() @MinLength(3) reason!: string;
  @IsOptional() @Matches(DATE_RE) date?: string;
}

export class PingDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @IsNumber() @Min(0) accuracy?: number;
  /** Instante no aparelho, ISO 8601 (ex.: "2026-09-23T14:05:10-03:00"). */
  @IsString() at!: string;
}

export class PingsDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => PingDto) pings!: PingDto[];
}

class RouteDto {
  @IsString() sellerId!: string;
  @IsString() @MinLength(2) name!: string;
  @IsIn(RECURRENCES) recurrence!: string;
  @IsOptional() @IsInt() @Min(0) @Max(127) weekdays?: number;
  @IsOptional() @Matches(DATE_RE) date?: string;
  @IsOptional() @Matches(DATE_RE) startDate?: string;
  @IsOptional() @Matches(DATE_RE) endDate?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  /** Clientes na ordem da visita. */
  @IsArray() @ArrayMaxSize(300) @IsString({ each: true }) customerIds!: string[];
}

class GeoDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

// ======================= ERP =======================

@Controller('api/routes')
@Perms('roteiro.visualizar')
export class RoutesController {
  constructor(@Inject(PRISMA) private db: Db, private audit: AuditService) {}

  @Get()
  async list(@CurrentUser() u: SessionUser, @Query('sellerId') sellerId?: string) {
    const rows = await this.db.route.findMany({
      where: { companyId: u.companyId, deletedAt: null, ...(sellerId ? { sellerId } : {}) },
      orderBy: [{ seller: { name: 'asc' } }, { name: 'asc' }],
      include: { seller: { select: { id: true, name: true } }, _count: { select: { stops: true } } },
    });
    return { rows: rows.map(({ _count, ...r }) => ({ ...r, stops: _count.stops })) };
  }

  @Get(':id')
  async detail(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const route = await this.db.route.findFirst({
      where: { id, companyId: u.companyId, deletedAt: null },
      include: {
        seller: { select: { id: true, name: true } },
        stops: { orderBy: { position: 'asc' }, include: { customer: { select: CUSTOMER_GEO } } },
      },
    });
    if (!route) throw new NotFoundException('Roteiro não encontrado.');
    return route;
  }

  @Post() @Perms('roteiro.gerenciar')
  async create(@CurrentUser() u: SessionUser, @Body() dto: RouteDto, @Req() req: Request) {
    const data = await this.clean(u.companyId, dto);
    const route = await this.db.route.create({
      data: {
        ...data.route, companyId: u.companyId,
        stops: { create: data.customerIds.map((customerId, i) => ({ companyId: u.companyId, customerId, position: i + 1 })) },
      },
    });
    await this.audit.log(u, 'create', 'Route', route.id, { nome: route.name, vendedor: route.sellerId, clientes: data.customerIds.length }, req.ip);
    return route;
  }

  /** Salva o cabeçalho e a lista de clientes (na ordem enviada). */
  @Put(':id') @Perms('roteiro.gerenciar')
  async update(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: RouteDto, @Req() req: Request) {
    const before = await this.db.route.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!before) throw new NotFoundException('Roteiro não encontrado.');
    const data = await this.clean(u.companyId, dto);
    const route = await this.db.$transaction(async (tx) => {
      await tx.routeStop.deleteMany({ where: { routeId: id } });
      return tx.route.update({
        where: { id },
        data: {
          ...data.route,
          stops: { create: data.customerIds.map((customerId, i) => ({ companyId: u.companyId, customerId, position: i + 1 })) },
        },
      });
    });
    await this.audit.log(u, 'update', 'Route', id,
      { ...AuditService.diff(before, route), clientes: data.customerIds.length }, req.ip);
    return route;
  }

  @Delete(':id') @Perms('roteiro.gerenciar')
  async remove(@CurrentUser() u: SessionUser, @Param('id') id: string, @Req() req: Request) {
    const route = await this.db.route.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!route) throw new NotFoundException('Roteiro não encontrado.');
    await this.db.route.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    await this.audit.log(u, 'delete', 'Route', id, { nome: route.name }, req.ip);
    return { ok: true };
  }

  private async clean(companyId: string, dto: RouteDto) {
    const seller = await this.db.seller.findFirst({ where: { id: dto.sellerId, companyId, deletedAt: null } });
    if (!seller) throw new BadRequestException('Vendedor não encontrado.');
    if (dto.recurrence === 'ONCE' && !dto.date) throw new BadRequestException('Roteiro esporádico precisa da data.');
    if (dto.recurrence === 'WEEKDAYS' && !dto.weekdays) throw new BadRequestException('Marque ao menos um dia da semana.');
    if (dto.startDate && dto.endDate && dto.endDate < dto.startDate) throw new BadRequestException('Fim da vigência antes do início.');
    const customerIds = [...new Set(dto.customerIds)];
    const found = await this.db.customer.count({ where: { companyId, deletedAt: null, id: { in: customerIds } } });
    if (found !== customerIds.length) throw new BadRequestException('Cliente inexistente no roteiro.');
    return {
      customerIds,
      route: {
        sellerId: seller.id, name: dto.name.trim(), recurrence: dto.recurrence,
        weekdays: dto.recurrence === 'WEEKDAYS' ? dto.weekdays! : 0,
        date: dto.recurrence === 'ONCE' ? dto.date! : null,
        startDate: dto.startDate || null, endDate: dto.endDate || null,
        notes: dto.notes?.trim() || null, active: dto.active ?? true,
      },
    };
  }
}

/** Acompanhamento de campo: mapa ao vivo e trajeto. */
@Controller('api/field')
@Perms('roteiro.visualizar')
export class FieldController {
  constructor(@Inject(PRISMA) private db: Db, private field: FieldService, private clock: TimeService) {}

  /** Vendedores (última posição + resumo do dia) e a agenda de cada um na data. */
  @Get('live')
  async live(@CurrentUser() u: SessionUser, @Query('date') date?: string) {
    const day = date && DATE_RE.test(date) ? date : await this.clock.today(u.companyId);
    const sellers = await this.db.seller.findMany({
      where: { companyId: u.companyId, deletedAt: null, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true, lastLat: true, lastLng: true, lastAccuracy: true, lastSeenAt: true },
    });
    const [agenda, sales] = await Promise.all([
      this.field.agenda(u.companyId, day, sellers.map((s) => s.id)),
      this.db.sale.groupBy({
        by: ['sellerId'],
        where: { companyId: u.companyId, status: 'COMPLETED', sellerId: { in: sellers.map((s) => s.id) }, soldAt: { gte: `${day} 00:00`, lte: `${day} 23:59` } },
        _sum: { totalCents: true }, _count: true,
      }),
    ]);
    const salesOf = new Map(sales.map((s) => [s.sellerId, s]));
    return {
      date: day,
      sellers: sellers.map((s) => {
        const stops = agenda.get(s.id) ?? [];
        const count = (st: string) => stops.filter((x) => x.status === st).length;
        return {
          ...s,
          stops,
          summary: {
            planned: stops.filter((x) => x.planned).length,
            done: count('DONE'), inProgress: count('IN_PROGRESS'), pending: count('PENDING'),
            missed: count('MISSED'), skipped: count('SKIPPED'),
            outOfRange: stops.filter((x) => x.visit?.outOfRange).length,
            salesCents: salesOf.get(s.id)?._sum.totalCents ?? 0, salesCount: salesOf.get(s.id)?._count ?? 0,
          },
        };
      }),
    };
  }

  /** Trajeto do vendedor no dia (pings em ordem). */
  @Get('track')
  async track(@CurrentUser() u: SessionUser, @Query('sellerId') sellerId: string, @Query('date') date?: string) {
    const day = date && DATE_RE.test(date) ? date : await this.clock.today(u.companyId);
    const seller = await this.db.seller.findFirst({ where: { id: sellerId, companyId: u.companyId }, select: { id: true } });
    if (!seller) throw new NotFoundException('Vendedor não encontrado.');
    const rows = await this.db.sellerPing.findMany({
      where: { sellerId, localDate: day }, orderBy: { at: 'asc' }, select: { lat: true, lng: true, accuracy: true, at: true },
    });
    return { date: day, rows };
  }
}

/** Coordenada do cliente: ajuste manual do pino ou busca pelo endereço (Nominatim/OpenStreetMap). */
@Controller('api/customers/:id/geo')
@Perms('cliente.gerenciar')
export class CustomerGeoController {
  private lastCall = 0;
  constructor(@Inject(PRISMA) private db: Db, private audit: AuditService) {}

  @Patch()
  async set(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: GeoDto, @Req() req: Request) {
    await this.find(u.companyId, id);
    const c = await this.db.customer.update({ where: { id }, data: { lat: dto.lat, lng: dto.lng, geoSource: 'manual' } });
    await this.audit.log(u, 'update', 'Customer', id, { localizacao: `${dto.lat},${dto.lng}` }, req.ip);
    return { lat: c.lat, lng: c.lng, geoSource: c.geoSource };
  }

  /**
   * Procura o endereço do cliente. ponytail: Nominatim público pede no máximo
   * 1 consulta/s e identificação; a trava aqui é por processo. Muitas empresas
   * geocodificando juntas → trocar por provedor com chave.
   */
  @Post('lookup')
  async lookup(@CurrentUser() u: SessionUser, @Param('id') id: string, @Req() req: Request) {
    const customer = await this.find(u.companyId, id);
    if (!customer.address?.trim()) throw new BadRequestException('Cliente sem endereço cadastrado.');
    const wait = this.lastCall + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();
    const base = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org';
    const url = `${base}/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(customer.address)}`;
    let hits: Array<{ lat: string; lon: string; display_name: string }>;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': `LojaFlow/1.0 (${process.env.APP_URL || 'lojaflow'})`, 'Accept-Language': 'pt-BR' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      hits = await res.json() as typeof hits;
    } catch (e) {
      new Logger('Geocoder').warn(`falha ao buscar endereço: ${(e as Error).message}`);
      throw new BadRequestException('Serviço de mapas indisponível agora. Marque o local no mapa.');
    }
    if (!hits.length) throw new BadRequestException('Endereço não encontrado no mapa. Marque o local manualmente.');
    const lat = Number(hits[0].lat);
    const lng = Number(hits[0].lon);
    await this.db.customer.update({ where: { id }, data: { lat, lng, geoSource: 'geocoder' } });
    await this.audit.log(u, 'update', 'Customer', id, { localizacao: `${lat},${lng}`, origem: 'busca por endereço' }, req.ip);
    return { lat, lng, geoSource: 'geocoder', label: hits[0].display_name };
  }

  private async find(companyId: string, id: string) {
    const customer = await this.db.customer.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');
    return customer;
  }
}

@Module({
  controllers: [RoutesController, FieldController, CustomerGeoController],
  providers: [FieldService],
  exports: [FieldService],
})
export class FieldModule {}
