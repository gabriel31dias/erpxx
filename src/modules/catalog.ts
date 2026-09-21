import {
  BadRequestException, Body, Controller, Delete, Get, Inject, Module, NotFoundException,
  Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService, BranchService, PlanService, TimeService } from '../common/core';
import { paging } from '../common/util';

export const UNITS = ['UN', 'KG', 'G', 'L', 'ML', 'CX', 'PCT'];
export const SALE_TYPES = ['UNIT', 'WEIGHT'];

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
  @IsOptional() @IsBoolean() active?: boolean;
  /** Estoque inicial só na criação; depois tudo passa por movimentação. */
  @IsOptional() @IsNumber() @Min(0) initialStock?: number;
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
}

/** Mantém só dígitos (NCM/CEST/CFOP vêm com pontos às vezes). */
const soDigitos = (s?: string) => (s ? s.replace(/\D/g, '') : '') || null;

class CategoryDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() active?: boolean;
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
          { name: { contains: term } },
          { sku: { contains: term } },
          { barcode: { contains: term } },
          { internalCode: { contains: term } },
          { brand: { contains: term } },
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

  /** Busca do PDV: código de barras exato primeiro, depois nome/SKU. */
  @Get('lookup')
  async lookup(
    @CurrentUser() u: SessionUser,
    @Query('q') q = '',
    @Query('branchId') branchId?: string,
    @Query('limit') limit = '15',
  ) {
    const term = q.trim();
    if (!term) return { rows: [] };
    const scope = this.branches.scope(u, branchId);
    const base = { companyId: u.companyId, deletedAt: null, active: true };

    const exact = await this.db.product.findFirst({
      where: { ...base, OR: [{ barcode: term }, { sku: term }, { internalCode: term }] },
      include: { stocks: true },
    });
    if (exact) return { rows: [this.shape(exact, scope.branchId)], exact: true };

    const rows = await this.db.product.findMany({
      where: {
        ...base,
        OR: [{ name: { contains: term } }, { sku: { contains: term } }, { barcode: { contains: term } }],
      },
      include: { stocks: true },
      orderBy: { name: 'asc' },
      take: Math.min(Number(limit) || 15, 50),
    });
    return { rows: rows.map((p) => this.shape(p, scope.branchId)), exact: false };
  }

  @Get(':id')
  async detail(@CurrentUser() u: SessionUser, @Param('id') id: string, @Query('branchId') branchId?: string) {
    const product = await this.db.product.findFirst({
      where: { id, companyId: u.companyId, deletedAt: null },
      include: { category: true, stocks: { include: { branch: { select: { id: true, name: true } } } } },
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

    const product = await this.db.product.create({ data: { ...this.data(dto), companyId: u.companyId } });

    if (dto.initialStock) {
      const branchId = await this.branches.require(u);
      const now = await this.clock.now(u.companyId);
      await this.db.stock.create({
        data: { companyId: u.companyId, branchId, productId: product.id, quantity: dto.initialStock },
      });
      await this.db.stockMovement.create({
        data: {
          companyId: u.companyId, branchId, productId: product.id, type: 'ENTRADA',
          quantity: dto.initialStock, before: 0, after: dto.initialStock,
          reason: 'Estoque inicial do cadastro', userId: u.sub, createdAtLocal: now,
        },
      });
    }
    await this.audit.log(u, 'create', 'Product', product.id, { nome: product.name, preco: product.priceCents }, req.ip);
    return product;
  }

  @Patch(':id') @Perms('produto.editar')
  async update(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: ProductDto, @Req() req: Request) {
    const before = await this.db.product.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!before) throw new NotFoundException('Produto não encontrado.');
    await this.assertUnique(u.companyId, dto, id);

    const product = await this.db.product.update({ where: { id }, data: this.data(dto) });
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
      data: { name: dto.name.trim(), description: dto.description || null, active: dto.active ?? before.active },
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

@Module({ controllers: [ProductsController, CategoriesController] })
export class CatalogModule {}
