import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Inject, Module, NotFoundException,
  Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min,
  MinLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import { PRISMA, Db, Tx, TX } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { can } from '../common/rbac';
import { AuditService, BranchService, PlanService, TimeService } from '../common/core';
import { paging } from '../common/util';
import { PricingModule, PricingService } from './pricing';
import { StockModule, StockService } from './stock';

export const UNITS = ['UN', 'KG', 'G', 'L', 'ML', 'CX', 'PCT'];
export const SALE_TYPES = ['UNIT', 'WEIGHT'];

class MenuItemDto {
  @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @IsInt() @Min(0) priceCents!: number;
}

class MenuOptionGroupDto {
  @IsString() @MinLength(1) @MaxLength(40) name!: string;
  @IsInt() @Min(0) @Max(20) min!: number;
  @IsInt() @Min(1) @Max(20) max!: number;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => MenuItemDto) items!: MenuItemDto[];
}

/** Adicionais, tamanhos (pizza) e grupos de escolha do cardápio. */
class MenuOptionsDto {
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => MenuItemDto) additionals?: MenuItemDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => MenuItemDto) sizes?: MenuItemDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => MenuOptionGroupDto) optionGroups?: MenuOptionGroupDto[];
}

class ProductDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() internalCode?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsIn(UNITS) unit?: string;
  @IsOptional() @IsIn(SALE_TYPES) saleType?: string;
  @IsOptional() @IsInt() @Min(0) costCents?: number;
  @IsInt() @Min(0) priceCents!: number;
  @IsOptional() @IsNumber() @Min(0) minStock?: number;
  @IsOptional() @IsNumber() @Min(0) maxStock?: number;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(14) catalogBarcode?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  /** Estoque inicial só na criação; depois tudo passa por movimentação. */
  @IsOptional() @IsNumber() @Min(0) initialStock?: number;
  /** Só na edição: soma ao saldo por uma nova entrada de mercadoria. */
  @IsOptional() @IsNumber() @Min(0) addStock?: number;
  // ---- Dados fiscais (NF-e) ----
  @IsOptional() @IsString() ncm?: string;
  @IsOptional() @IsString() cest?: string;
  @IsOptional() @IsString() cfop?: string;
  @IsOptional() @IsString() origem?: string;
  @IsOptional() @IsString() csosn?: string;
  @IsOptional() @IsString() cstIcms?: string;
  @IsOptional() @IsString() cstPis?: string;
  @IsOptional() @IsString() cstCofins?: string;
  @IsOptional() @IsInt() @Min(0) icmsAliqBp?: number;
  @IsOptional() @IsInt() @Min(0) pisAliqBp?: number;
  @IsOptional() @IsInt() @Min(0) cofinsAliqBp?: number;
  @IsOptional() @IsNumber() @Min(0) netWeight?: number;
  @IsOptional() @IsNumber() @Min(0) grossWeight?: number;
  // ---- Cardápio digital (omitido mantém o que está gravado) ----
  @IsOptional() @IsBoolean() menuVisible?: boolean;
  @IsOptional() @IsInt() @Min(0) oldPriceCents?: number | null;
  @IsOptional() @ValidateNested() @Type(() => MenuOptionsDto) menuOptions?: MenuOptionsDto;
  @IsOptional() @IsInt() position?: number;
  // ---- Bilheteria (vazio limpa) ----
  @IsOptional() @IsString() @MaxLength(120) eventName?: string;
  @IsOptional() @IsDateString() eventDate?: string;
  @IsOptional() @IsString() @MaxLength(60) ticketType?: string;
  @IsOptional() @IsBoolean() ticketBox?: boolean;
  @IsOptional() @IsString() @MaxLength(20) boxNumber?: string;
  @IsOptional() @IsString() @MaxLength(20) tableNumber?: string;
  // ---- Cozinha (omitido mantém o que está gravado) ----
  /** praça da cozinha; vazio/null herda da categoria */
  @IsOptional() @IsString() stationId?: string | null;
  /** não vai para nenhuma tela da cozinha (ex.: lata que o balcão só entrega) */
  @IsOptional() @IsBoolean() kitchenSkip?: boolean;
}

/** Mantém só dígitos (NCM/CEST/CFOP vêm com pontos às vezes). */
const soDigitos = (s?: string) => (s ? s.replace(/\D/g, '') : '') || null;

class CategoryDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(4) maxFlavors?: number;
  @IsOptional() @IsInt() position?: number;
  /** praça da cozinha dos produtos; vazio/null = Cozinha padrão (omitido mantém) */
  @IsOptional() @IsString() stationId?: string | null;
}

/** praça informada precisa ser da empresa; '' vira null (herda) */
async function stationOrNull(db: Db, companyId: string, stationId?: string | null) {
  if (stationId === undefined) return undefined;
  if (!stationId) return null;
  const st = await db.kitchenStation.findFirst({ where: { id: stationId, companyId } });
  if (!st) throw new BadRequestException('Praça da cozinha não encontrada.');
  return st.id;
}

@Controller('api/products')
@Perms('produto.visualizar')
export class ProductsController {
  constructor(
    @Inject(PRISMA) private db: Db,
    private audit: AuditService,
    private plans: PlanService,
    private branches: BranchService,
    private clock: TimeService,
    private pricing: PricingService,
    private stock: StockService,
  ) {}

  /** Estoque do produto na filial pedida (ou soma de todas). */
  private stockOf(product: any, branchId?: string) {
    const rows = product.stocks || [];
    const filtered = branchId ? rows.filter((s: any) => s.branchId === branchId) : rows;
    return filtered.reduce((sum: number, s: any) => sum + s.quantity, 0);
  }

  private shape(p: any, branchId?: string) {
    const stock = this.stockOf(p, branchId);
    const margin = p.priceCents > 0 && p.costCents > 0
      ? Math.round(((p.priceCents - p.costCents) / p.priceCents) * 1000) / 10
      : 0;
    return {
      ...p, stocks: undefined, stock, marginPct: margin,
      lowStock: p.minStock > 0 && stock <= p.minStock,
      outOfStock: stock <= 0,
    };
  }

  @Get()
  async list(
    @CurrentUser() u: SessionUser,
    @Query('q') q = '',
    @Query('categoryId') categoryId = '',
    @Query('status') status = '',
    @Query('stock') stock = '', // baixo | zerado
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('orderBy') orderBy = 'name',
  ) {
    const { take, skip, ...rest } = paging(page, pageSize);
    const term = q.trim();
    const scope = this.branches.scope(u, branchId);
    const where: any = {
      companyId: u.companyId, deletedAt: null,
      ...(categoryId ? { categoryId } : {}),
      ...(status === 'ativo' ? { active: true } : status === 'inativo' ? { active: false } : {}),
      ...(term ? {
        OR: [
          { name: { contains: term, mode: 'insensitive' as const } },
          { sku: { contains: term, mode: 'insensitive' as const } },
          { barcode: { contains: term, mode: 'insensitive' as const } },
          { internalCode: { contains: term, mode: 'insensitive' as const } },
          { brand: { contains: term, mode: 'insensitive' as const } },
        ],
      } : {}),
    };

    const order = orderBy === 'preco' ? { priceCents: 'desc' as const }
      : orderBy === 'recente' ? { createdAt: 'desc' as const }
      : { name: 'asc' as const };

    const [rows, total] = await Promise.all([
      this.db.product.findMany({
        where, orderBy: order, take, skip,
        include: { category: { select: { id: true, name: true } }, stocks: true },
      }),
      this.db.product.count({ where }),
    ]);

    let shaped = rows.map((p) => this.shape(p, scope.branchId));
    // filtro de estoque depende do agregado; só é aplicado depois da soma
    if (stock === 'baixo') shaped = shaped.filter((p) => p.lowStock && !p.outOfStock);
    if (stock === 'zerado') shaped = shaped.filter((p) => p.outOfStock);
    return { rows: shaped, total, ...rest };
  }

  /**
   * Busca do PDV: código de barras exato primeiro, depois nome/SKU. Com `customerId`,
   * `priceCents` já é o preço da tabela do cliente e `basePriceCents` o do cadastro.
   */
  @Get('lookup')
  async lookup(
    @CurrentUser() u: SessionUser,
    @Query('q') q = '',
    @Query('branchId') branchId?: string,
    @Query('limit') limit = '15',
    @Query('customerId') customerId?: string,
  ) {
    const term = q.trim();
    if (!term) return { rows: [] };
    const scope = this.branches.scope(u, branchId);
    const base = { companyId: u.companyId, deletedAt: null, active: true };

    const exact = await this.db.product.findFirst({
      where: { ...base, OR: [{ barcode: term }, { sku: term }, { internalCode: term }] },
      include: { stocks: true },
    });
    if (exact) return { rows: await this.priced(u, [exact], scope.branchId, customerId), exact: true };

    const rows = await this.db.product.findMany({
      where: {
        ...base,
        OR: [{ name: { contains: term, mode: 'insensitive' as const } }, { sku: { contains: term, mode: 'insensitive' as const } }, { barcode: { contains: term, mode: 'insensitive' as const } }],
      },
      include: { stocks: true },
      orderBy: { name: 'asc' },
      take: Math.min(Number(limit) || 15, 50),
    });
    return { rows: await this.priced(u, rows, scope.branchId, customerId), exact: false };
  }

  private async priced(u: SessionUser, rows: any[], branchId?: string, customerId?: string) {
    const { prices } = await this.pricing.resolve(u.companyId, customerId, rows.map((p) => p.id));
    return rows.map((p) => {
      const price = prices.get(p.id)!;
      return {
        ...this.shape(p, branchId),
        priceCents: price.priceCents, basePriceCents: price.basePriceCents, priceSource: price.source,
      };
    });
  }

  @Get(':id')
  async detail(@CurrentUser() u: SessionUser, @Param('id') id: string, @Query('branchId') branchId?: string) {
    const product = await this.db.product.findFirst({
      where: { id, companyId: u.companyId, deletedAt: null },
      include: { category: true, catalogReference: true, stocks: { include: { branch: { select: { id: true, name: true } } } } },
    });
    if (!product) throw new NotFoundException('Produto não encontrado.');

    const movements = await this.db.stockMovement.findMany({
      where: { companyId: u.companyId, productId: id, ...this.branches.scope(u, branchId) },
      orderBy: { createdAtLocal: 'desc' },
      take: 30,
      include: { user: { select: { name: true } }, branch: { select: { name: true } } },
    });
    const sold = await this.db.saleItem.aggregate({
      where: { companyId: u.companyId, productId: id, sale: { status: 'COMPLETED' } },
      _sum: { quantity: true, totalCents: true },
    });

    return {
      product: {
        ...this.shape(product, this.branches.scope(u, branchId).branchId),
        byBranch: product.stocks.map((s) => ({ branchId: s.branchId, branch: s.branch.name, quantity: s.quantity })),
      },
      movements,
      sold: { quantity: sold._sum.quantity ?? 0, totalCents: sold._sum.totalCents ?? 0 },
    };
  }

  @Post() @Perms('produto.criar')
  async create(@CurrentUser() u: SessionUser, @Body() dto: ProductDto, @Req() req: Request) {
    await this.plans.assertActive(u.companyId);
    await this.plans.assertLimit(u.companyId, 'products');
    await this.assertUnique(u.companyId, dto);

    const stationId = await stationOrNull(this.db, u.companyId, dto.stationId);
    const reference = await this.reference(dto);
    const entrada = dto.initialStock ? await this.entryCtx(u) : null;
    const product = await this.db.$transaction(async (tx) => {
      const created = await tx.product.create({ data: { ...this.data(dto), ...reference, stationId, companyId: u.companyId } });
      if (entrada) await this.entry(tx as Tx, u, entrada, created, dto.initialStock!, 'Estoque inicial do cadastro');
      return created;
    }, TX);
    await this.audit.log(u, 'create', 'Product', product.id, { nome: product.name, preco: product.priceCents }, req.ip);
    return product;
  }

  @Patch(':id') @Perms('produto.editar')
  async update(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: ProductDto, @Req() req: Request) {
    const before = await this.db.product.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!before) throw new NotFoundException('Produto não encontrado.');
    await this.assertUnique(u.companyId, dto, id);
    if (dto.addStock && !can(u.role, 'estoque.entrada')) {
      throw new ForbiddenException('Seu perfil não tem permissão para dar entrada no estoque.');
    }

    const stationId = await stationOrNull(this.db, u.companyId, dto.stationId);
    const reference = await this.reference(dto, before.catalogBarcode);
    const entrada = dto.addStock ? await this.entryCtx(u) : null;
    const product = await this.db.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id }, data: { ...this.data(dto), ...reference, stationId } });
      if (entrada) await this.entry(tx as Tx, u, entrada, updated, dto.addStock!, 'Entrada pelo cadastro do produto');
      return updated;
    }, TX);
    // alteração de preço é auditada com destaque (briefing 27)
    const action = before.priceCents !== product.priceCents ? 'price' : 'update';
    await this.audit.log(u, action, 'Product', id, AuditService.diff(before, product), req.ip);
    return product;
  }

  @Delete(':id') @Perms('produto.excluir')
  async remove(@CurrentUser() u: SessionUser, @Param('id') id: string, @Req() req: Request) {
    const product = await this.db.product.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!product) throw new NotFoundException('Produto não encontrado.');
    // exclusão lógica: venda antiga continua mostrando o item
    await this.db.product.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    await this.audit.log(u, 'delete', 'Product', id, { nome: product.name }, req.ip);
    return { ok: true };
  }

  private async entryCtx(u: SessionUser) {
    return { branchId: await this.branches.require(u), at: await this.clock.now(u.companyId) };
  }

  /** Quantidade lançada no cadastro vira entrada de mercadoria (aparece em Estoque > Entradas). */
  private async entry(
    tx: Tx, u: SessionUser, ctx: { branchId: string; at: string },
    product: { id: string; costCents: number }, quantity: number, notes: string,
  ) {
    const entry = await tx.stockEntry.create({
      data: {
        companyId: u.companyId, branchId: ctx.branchId, userId: u.sub, notes,
        totalCents: Math.round(product.costCents * quantity), createdAtLocal: ctx.at,
        items: { create: [{ companyId: u.companyId, productId: product.id, quantity, costCents: product.costCents }] },
      },
    });
    await this.stock.move(tx, {
      companyId: u.companyId, branchId: ctx.branchId, productId: product.id, type: 'ENTRADA',
      quantity, reason: notes, refType: 'StockEntry', refId: entry.id, userId: u.sub, at: ctx.at,
    });
  }

  private async reference(dto: ProductDto, previous?: string | null) {
    const barcode = dto.catalogBarcode === undefined ? previous : dto.catalogBarcode;
    if (!barcode || barcode !== dto.barcode?.trim()) return { catalogBarcode: null };
    const reference = await this.db.beverageReference.findUnique({ where: { barcode } });
    if (!reference) throw new BadRequestException('Referência do catálogo não encontrada.');
    return { catalogBarcode: barcode };
  }

  private data(dto: ProductDto) {
    return {
      name: dto.name.trim(),
      description: dto.description || null,
      sku: dto.sku?.trim() || null,
      internalCode: dto.internalCode?.trim() || null,
      barcode: dto.barcode?.trim() || null,
      categoryId: dto.categoryId || null,
      brand: dto.brand?.trim() || null,
      unit: dto.unit || 'UN',
      saleType: dto.saleType || 'UNIT',
      costCents: dto.costCents ?? 0,
      priceCents: dto.priceCents,
      minStock: dto.minStock ?? 0,
      maxStock: dto.maxStock ?? 0,
      imageUrl: dto.imageUrl || null,
      active: dto.active ?? true,
      // cardápio: undefined não mexe (a tela de produto do ERP não manda esses campos)
      menuVisible: dto.menuVisible,
      oldPriceCents: dto.oldPriceCents,
      menuOptions: dto.menuOptions && JSON.stringify({
        additionals: dto.menuOptions.additionals ?? [],
        sizes: dto.menuOptions.sizes ?? [],
        optionGroups: dto.menuOptions.optionGroups ?? [],
      }),
      position: dto.position,
      // fiscais
      ncm: soDigitos(dto.ncm),
      cest: soDigitos(dto.cest),
      cfop: soDigitos(dto.cfop) || '5102',
      origem: (dto.origem ?? '0').trim() || '0',
      csosn: soDigitos(dto.csosn),
      cstIcms: soDigitos(dto.cstIcms),
      cstPis: soDigitos(dto.cstPis),
      cstCofins: soDigitos(dto.cstCofins),
      icmsAliqBp: dto.icmsAliqBp ?? null,
      pisAliqBp: dto.pisAliqBp ?? null,
      cofinsAliqBp: dto.cofinsAliqBp ?? null,
      netWeight: dto.netWeight ?? null,
      grossWeight: dto.grossWeight ?? null,
      // bilheteria
      eventName: dto.eventName?.trim() || null,
      eventDate: dto.eventDate ? new Date(dto.eventDate) : null,
      ticketType: dto.ticketType?.trim() || null,
      ticketBox: dto.ticketBox ?? false,
      boxNumber: dto.boxNumber?.trim() || null,
      tableNumber: dto.tableNumber?.trim() || null,
      kitchenSkip: dto.kitchenSkip,
    };
  }

  /** SKU e código de barras precisam ser únicos dentro da empresa (leitura no PDV depende disso). */
  private async assertUnique(companyId: string, dto: ProductDto, ignoreId?: string) {
    for (const field of ['sku', 'barcode'] as const) {
      const value = dto[field]?.trim();
      if (!value) continue;
      const found = await this.db.product.findFirst({
        where: { companyId, deletedAt: null, [field]: value, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
      });
      if (found) {
        throw new BadRequestException(
          `${field === 'sku' ? 'SKU' : 'Código de barras'} já usado pelo produto "${found.name}".`);
      }
    }
  }
}

@Controller('api/categories')
@Perms('produto.visualizar')
export class CategoriesController {
  constructor(@Inject(PRISMA) private db: Db, private audit: AuditService) {}

  @Get()
  async list(@CurrentUser() u: SessionUser, @Query('status') status = '') {
    const rows = await this.db.category.findMany({
      where: {
        companyId: u.companyId, deletedAt: null,
        ...(status === 'ativo' ? { active: true } : status === 'inativo' ? { active: false } : {}),
      },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
    return { rows: rows.map((c) => ({ ...c, products: c._count.products, _count: undefined })) };
  }

  @Post() @Perms('categoria.gerenciar')
  async create(@CurrentUser() u: SessionUser, @Body() dto: CategoryDto, @Req() req: Request) {
    const category = await this.db.category.create({
      data: {
        companyId: u.companyId, name: dto.name.trim(),
        description: dto.description || null, active: dto.active ?? true,
        maxFlavors: dto.maxFlavors, position: dto.position,
        stationId: await stationOrNull(this.db, u.companyId, dto.stationId),
      },
    });
    await this.audit.log(u, 'create', 'Category', category.id, { nome: category.name }, req.ip);
    return category;
  }

  @Patch(':id') @Perms('categoria.gerenciar')
  async update(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: CategoryDto, @Req() req: Request) {
    const before = await this.db.category.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!before) throw new NotFoundException('Categoria não encontrada.');
    const category = await this.db.category.update({
      where: { id },
      data: {
        name: dto.name.trim(), description: dto.description || null, active: dto.active ?? before.active,
        maxFlavors: dto.maxFlavors, position: dto.position,
        stationId: await stationOrNull(this.db, u.companyId, dto.stationId),
      },
    });
    await this.audit.log(u, 'update', 'Category', id, AuditService.diff(before, category), req.ip);
    return category;
  }

  @Delete(':id') @Perms('categoria.gerenciar')
  async remove(@CurrentUser() u: SessionUser, @Param('id') id: string, @Req() req: Request) {
    const category = await this.db.category.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!category) throw new NotFoundException('Categoria não encontrada.');
    const used = await this.db.product.count({ where: { companyId: u.companyId, categoryId: id, deletedAt: null } });
    if (used) throw new BadRequestException(`Esta categoria tem ${used} produto(s). Mova-os antes de excluir.`);
    await this.db.category.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    await this.audit.log(u, 'delete', 'Category', id, { nome: category.name }, req.ip);
    return { ok: true };
  }
}

@Module({ imports: [PricingModule, StockModule], controllers: [ProductsController, CategoriesController] })
export class CatalogModule {}
