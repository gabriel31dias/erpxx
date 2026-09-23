import {
  BadRequestException, Body, Controller, Delete, Get, Inject, Injectable, Module, NotFoundException,
  Param, Patch, Post, Put, Req,
} from '@nestjs/common';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService } from '../common/core';

/**
 * Preço de um produto numa tabela: item fixo, senão o cadastro com o ajuste da
 * tabela. É a mesma conta que o app do vendedor faz offline — mudar aqui é
 * mudar lá (GET /api/ext/price-lists documenta a regra para o app).
 */
export const adjustedCents = (baseCents: number, adjustBp: number) =>
  Math.max(0, Math.round((baseCents * (10000 + adjustBp)) / 10000));

export type PriceSource = 'BASE' | 'TABELA';

export interface ResolvedPrice {
  productId: string;
  basePriceCents: number; // cadastro
  priceCents: number; // o que a venda cobra sem desconto
  source: PriceSource;
}

export interface Resolution {
  priceList: { id: string; name: string; adjustBp: number; updatedAt: Date } | null;
  prices: Map<string, ResolvedPrice>;
}

@Injectable()
export class PricingService {
  constructor(@Inject(PRISMA) private db: Db) {}

  /** Tabela ativa do cliente (null = cliente sem tabela, inexistente ou tabela desligada). */
  async listOf(companyId: string, customerId?: string | null) {
    if (!customerId) return null;
    const customer = await this.db.customer.findFirst({
      where: { id: customerId, companyId, deletedAt: null },
      select: { priceList: { select: { id: true, name: true, adjustBp: true, active: true, deletedAt: true, updatedAt: true } } },
    });
    const list = customer?.priceList;
    return list && list.active && !list.deletedAt
      ? { id: list.id, name: list.name, adjustBp: list.adjustBp, updatedAt: list.updatedAt }
      : null;
  }

  /** Preço de cada produto para o cliente. Produtos de outra empresa simplesmente não voltam. */
  async resolve(companyId: string, customerId: string | null | undefined, productIds: string[]): Promise<Resolution> {
    const ids = [...new Set(productIds)];
    const [priceList, products] = await Promise.all([
      this.listOf(companyId, customerId),
      this.db.product.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, priceCents: true } }),
    ]);
    const fixed = priceList
      ? new Map((await this.db.priceListItem.findMany({
        where: { priceListId: priceList.id, productId: { in: ids } },
        select: { productId: true, priceCents: true },
      })).map((i) => [i.productId, i.priceCents]))
      : new Map<string, number>();

    const prices = new Map<string, ResolvedPrice>();
    for (const p of products) {
      const item = fixed.get(p.id);
      const priceCents = !priceList ? p.priceCents
        : item !== undefined ? item
        : adjustedCents(p.priceCents, priceList.adjustBp);
      prices.set(p.id, {
        productId: p.id, basePriceCents: p.priceCents, priceCents,
        source: priceList && priceCents !== p.priceCents ? 'TABELA' : 'BASE',
      });
    }
    return { priceList, prices };
  }

  /**
   * Última mudança que pode ter alterado o preço do produto para o cliente:
   * cadastro do produto, tabela (ou seus itens) ou o vínculo do cliente.
   * Venda offline com preço diferente do atual só é aceita se isso mudou depois dela.
   */
  async lastChange(companyId: string, productId: string, customerId: string | null | undefined): Promise<Date | null> {
    const [product, customer] = await Promise.all([
      this.db.product.findFirst({ where: { id: productId, companyId }, select: { updatedAt: true } }),
      customerId
        ? this.db.customer.findFirst({
          where: { id: customerId, companyId },
          select: { updatedAt: true, priceList: { select: { updatedAt: true } } },
        })
        : null,
    ]);
    const dates = [product?.updatedAt, customer?.updatedAt, customer?.priceList?.updatedAt]
      .filter((d): d is Date => !!d);
    return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
  }
}

// ======================= cadastro das tabelas (ERP) =======================

class PriceListDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() description?: string;
  /** Ajuste em pontos-base sobre o cadastro: -1000 = 10% abaixo. Entre -100% e +1000%. */
  @IsOptional() @IsInt() @Min(-10000) @Max(100000) adjustBp?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class PriceItemDto {
  @IsString() productId!: string;
  /** null remove o preço fixo: o produto volta a seguir o ajuste da tabela. */
  @IsOptional() @IsInt() @Min(0) priceCents?: number | null;
}

class PriceItemsDto {
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => PriceItemDto)
  items!: PriceItemDto[];
}

class QuoteDto {
  @IsOptional() @IsString() customerId?: string;
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) productIds!: string[];
}

@Controller('api/price-lists')
@Perms('produto.visualizar')
export class PriceListsController {
  constructor(@Inject(PRISMA) private db: Db, private audit: AuditService) {}

  /** Lista das tabelas (também alimenta o seletor da ficha do cliente). */
  @Get()
  async list(@CurrentUser() u: SessionUser) {
    const rows = await this.db.priceList.findMany({
      where: { companyId: u.companyId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: true, customers: { where: { deletedAt: null } } } } },
    });
    return {
      rows: rows.map(({ _count, ...l }) => ({ ...l, items: _count.items, customers: _count.customers })),
    };
  }

  /** Tabela com todos os produtos ativos: preço do cadastro, preço da tabela e margem. */
  @Get(':id')
  async detail(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const list = await this.find(u.companyId, id);
    const [products, items, customers] = await Promise.all([
      this.db.product.findMany({
        where: { companyId: u.companyId, deletedAt: null, active: true },
        orderBy: { name: 'asc' },
        select: {
          id: true, name: true, sku: true, barcode: true, unit: true, priceCents: true, costCents: true,
          category: { select: { id: true, name: true } },
        },
      }),
      this.db.priceListItem.findMany({ where: { priceListId: id }, select: { productId: true, priceCents: true } }),
      this.db.customer.findMany({
        where: { companyId: u.companyId, priceListId: id, deletedAt: null },
        orderBy: { name: 'asc' }, select: { id: true, name: true, document: true, phone: true },
      }),
    ]);
    const fixed = new Map(items.map((i) => [i.productId, i.priceCents]));
    return {
      list,
      customers,
      rows: products.map((p) => {
        const item = fixed.get(p.id);
        const listPriceCents = item ?? adjustedCents(p.priceCents, list.adjustBp);
        return {
          ...p,
          fixedPriceCents: item ?? null,
          listPriceCents,
          marginPct: listPriceCents > 0 && p.costCents > 0
            ? Math.round(((listPriceCents - p.costCents) / listPriceCents) * 1000) / 10 : null,
          belowCost: p.costCents > 0 && listPriceCents < p.costCents,
        };
      }),
    };
  }

  @Post() @Perms('tabela_preco.gerenciar')
  async create(@CurrentUser() u: SessionUser, @Body() dto: PriceListDto, @Req() req: Request) {
    const list = await this.db.priceList.create({ data: { ...this.data(dto), companyId: u.companyId } });
    await this.audit.log(u, 'create', 'PriceList', list.id, { nome: list.name, ajusteBp: list.adjustBp }, req.ip);
    return list;
  }

  @Patch(':id') @Perms('tabela_preco.gerenciar')
  async update(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: PriceListDto, @Req() req: Request) {
    const before = await this.find(u.companyId, id);
    const list = await this.db.priceList.update({ where: { id }, data: this.data(dto) });
    await this.audit.log(u, 'update', 'PriceList', id, AuditService.diff(before, list), req.ip);
    return list;
  }

  /** Grava preços fixos em lote (grade do editor). Só os produtos enviados mudam. */
  @Put(':id/items') @Perms('tabela_preco.gerenciar')
  async setItems(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: PriceItemsDto, @Req() req: Request) {
    const list = await this.find(u.companyId, id);
    const ids = [...new Set(dto.items.map((i) => i.productId))];
    const found = await this.db.product.count({ where: { companyId: u.companyId, deletedAt: null, id: { in: ids } } });
    if (found !== ids.length) throw new BadRequestException('Produto inexistente na lista de preços.');

    const before = new Map((await this.db.priceListItem.findMany({
      where: { priceListId: id, productId: { in: ids } }, select: { productId: true, priceCents: true },
    })).map((i) => [i.productId, i.priceCents]));

    const changes: Array<{ produto: string; de: number | null; para: number | null }> = [];
    await this.db.$transaction(async (tx) => {
      for (const item of dto.items) {
        const de = before.get(item.productId) ?? null;
        const para = item.priceCents ?? null;
        if (de === para) continue;
        changes.push({ produto: item.productId, de, para });
        if (para === null) {
          await tx.priceListItem.deleteMany({ where: { priceListId: id, productId: item.productId } });
        } else {
          await tx.priceListItem.upsert({
            where: { priceListId_productId: { priceListId: id, productId: item.productId } },
            create: { companyId: u.companyId, priceListId: id, productId: item.productId, priceCents: para },
            update: { priceCents: para },
          });
        }
      }
      // a data da tabela marca "preço mudou" para conferir vendas offline
      if (changes.length) await tx.priceList.update({ where: { id }, data: { updatedAt: new Date() } });
    });
    if (changes.length) {
      await this.audit.log(u, 'update', 'PriceList', id, { tabela: list.name, precos: changes }, req.ip);
    }
    return { changed: changes.length };
  }

  /** Exclusão lógica: clientes da tabela voltam ao preço do cadastro. */
  @Delete(':id') @Perms('tabela_preco.gerenciar')
  async remove(@CurrentUser() u: SessionUser, @Param('id') id: string, @Req() req: Request) {
    const list = await this.find(u.companyId, id);
    const { count } = await this.db.$transaction(async (tx) => {
      await tx.priceList.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
      return tx.customer.updateMany({ where: { companyId: u.companyId, priceListId: id }, data: { priceListId: null } });
    });
    await this.audit.log(u, 'delete', 'PriceList', id, { nome: list.name, clientesDesvinculados: count }, req.ip);
    return { ok: true };
  }

  private async find(companyId: string, id: string) {
    const list = await this.db.priceList.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!list) throw new NotFoundException('Tabela de preço não encontrada.');
    return list;
  }

  private data(dto: PriceListDto) {
    return {
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      adjustBp: dto.adjustBp ?? 0,
      active: dto.active ?? true,
    };
  }
}

/** Cotação para o PDV: reprecifica o carrinho quando o cliente muda. */
@Controller('api/pricing')
@Perms('pdv.acessar')
export class PricingController {
  constructor(private pricing: PricingService) {}

  @Post('quote')
  async quote(@CurrentUser() u: SessionUser, @Body() dto: QuoteDto) {
    const { priceList, prices } = await this.pricing.resolve(u.companyId, dto.customerId, dto.productIds);
    return {
      priceList: priceList && { id: priceList.id, name: priceList.name },
      rows: [...prices.values()],
    };
  }
}

@Module({
  controllers: [PriceListsController, PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
