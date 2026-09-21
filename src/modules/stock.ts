import {
  BadRequestException, Body, ConflictException, Controller, Get, Inject, Injectable, Module,
  NotFoundException, Param, Post, Query, Req,
} from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, MinLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { XMLParser } from 'fast-xml-parser';
import type { Request } from 'express';
import { PRISMA, Db, Tx, TX } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService, BranchService, IdempotencyService, NotifyService, SettingsService, TimeService } from '../common/core';
import { DATE_RE, paging, roundQty } from '../common/util';

export const MOVEMENT_TYPES = [
  'ENTRADA', 'SAIDA', 'VENDA', 'DEVOLUCAO', 'AJUSTE', 'PERDA', 'TRANSFERENCIA', 'CANCELAMENTO',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Tipos que somam no estoque; o resto subtrai. AJUSTE define o saldo direto. */
const INBOUND: string[] = ['ENTRADA', 'DEVOLUCAO', 'CANCELAMENTO'];

export interface MoveInput {
  companyId: string;
  branchId: string;
  productId: string;
  type: MovementType;
  quantity: number; // sempre positivo
  reason?: string;
  refType?: string;
  refId?: string;
  userId?: string | null;
  at: string; // "YYYY-MM-DD HH:mm"
  allowNegative?: boolean;
  /** AJUSTE pode somar ou subtrair; os demais tipos têm sinal fixo. */
  inbound?: boolean;
}

/**
 * Única porta de entrada do estoque: quantidade nunca muda sem movimentação.
 * A baixa usa `updateMany` com condição de saldo — dois caixas vendendo a última
 * unidade ao mesmo tempo: um grava, o outro recebe 409.
 */
@Injectable()
export class StockService {
  constructor(@Inject(PRISMA) private db: Db) {}

  async move(tx: Tx, input: MoveInput) {
    const { companyId, branchId, productId, type, quantity } = input;
    if (quantity <= 0) throw new BadRequestException('Quantidade precisa ser maior que zero.');
    const qty = roundQty(quantity);

    const stock = await tx.stock.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: { companyId, branchId, productId, quantity: 0 },
      update: {},
    });

    const before = stock.quantity;
    const delta = (input.inbound ?? INBOUND.includes(type)) ? qty : -qty;
    const after = roundQty(before + delta);

    if (delta < 0 && after < 0 && !input.allowNegative) {
      const product = await tx.product.findUnique({ where: { id: productId }, select: { name: true } });
      throw new ConflictException(
        `Estoque insuficiente de "${product?.name ?? 'produto'}": disponível ${before}, pedido ${qty}.`);
    }

    // condição no where = trava otimista sobre a quantidade lida acima
    const updated = await tx.stock.updateMany({
      where: { companyId, branchId, productId, quantity: before },
      data: { quantity: after },
    });
    if (updated.count !== 1) {
      throw new ConflictException('O estoque deste produto mudou durante a operação. Tente novamente.');
    }

    return tx.stockMovement.create({
      data: {
        companyId, branchId, productId, type, quantity: qty, before, after,
        reason: input.reason ?? null, refType: input.refType ?? null, refId: input.refId ?? null,
        userId: input.userId ?? null, createdAtLocal: input.at,
      },
    });
  }

  /** Ajuste define o saldo final; a movimentação registra a diferença. */
  async setQuantity(tx: Tx, input: Omit<MoveInput, 'quantity' | 'type'> & { quantity: number }) {
    const stock = await tx.stock.upsert({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      create: { companyId: input.companyId, branchId: input.branchId, productId: input.productId, quantity: 0 },
      update: {},
    });
    const target = roundQty(input.quantity);
    const diff = roundQty(target - stock.quantity);
    if (diff === 0) return null;
    return this.move(tx, {
      ...input,
      type: 'AJUSTE',
      quantity: Math.abs(diff),
      inbound: diff > 0,
      allowNegative: true,
      reason: input.reason || 'Ajuste de inventário',
    });
  }
}

class AdjustDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() branchId?: string;
  @IsNumber() @Min(0) quantity!: number; // saldo final desejado
  @IsString() reason!: string;
}

class MoveDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() branchId?: string;
  @IsIn(['ENTRADA', 'SAIDA', 'PERDA', 'DEVOLUCAO']) type!: MovementType;
  @IsNumber() @Min(0.001) quantity!: number;
  @IsString() reason!: string;
}

class TransferDto {
  @IsString() productId!: string;
  @IsString() fromBranchId!: string;
  @IsString() toBranchId!: string;
  @IsNumber() @Min(0.001) quantity!: number;
  @IsOptional() @IsString() reason?: string;
}

/** Produto a criar na hora da entrada (item da NF-e sem cadastro). */
class NewProductDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() ncm?: string;
  @IsOptional() @IsString() cest?: string;
  @IsOptional() @IsString() origem?: string;
}

class EntryItemDto {
  /** productId de produto existente OU newProduct para criar (um dos dois). */
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @ValidateNested() @Type(() => NewProductDto) newProduct?: NewProductDto;
  @IsNumber() @Min(0.001) quantity!: number;
  @IsInt() @Min(0) costCents!: number;
  @IsOptional() @IsString() lot?: string;
  @IsOptional() @IsString() expiresAt?: string;
  @IsOptional() @IsString() notes?: string;
}

/** Fornecedor a criar na hora (emitente da NF-e sem cadastro). */
class NewSupplierDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() document?: string;
}

class EntryDto {
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @ValidateNested() @Type(() => NewSupplierDto) newSupplier?: NewSupplierDto;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() document?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() idempotencyKey?: string;
  /** Atualiza o custo do produto com o custo da entrada. */
  @IsOptional() updateCost?: boolean;
  /** Gera a conta a pagar do fornecedor com este vencimento. */
  @IsOptional() @IsString() dueDate?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => EntryItemDto) items!: EntryItemDto[];
}

class ImportNfeDto {
  @IsString() xml!: string;
}

/** uCom da NF-e -> unidades do sistema (UN|KG|G|L|ML|CX|PCT). */
function mapUnit(u: unknown): string {
  const s = String(u ?? '').trim().toUpperCase();
  const map: Record<string, string> = {
    UN: 'UN', UND: 'UN', PC: 'UN', PÇ: 'UN', PECA: 'UN', KG: 'KG', G: 'G', GR: 'G',
    L: 'L', LT: 'L', ML: 'ML', CX: 'CX', PCT: 'PCT', PACOTE: 'PCT', FD: 'CX', DZ: 'UN',
  };
  return map[s] || 'UN';
}

/**
 * Extrai fornecedor + itens de um XML de NF-e (procNFe ou NFe puro).
 * Valores ficam como string no parser e são convertidos aqui para evitar
 * imprecisão de float em qCom/vUnCom.
 */
function parseNfe(xml: string) {
  let doc: any;
  try {
    doc = new XMLParser({ ignoreAttributes: true, parseTagValue: false }).parse(xml);
  } catch {
    throw new BadRequestException('Não consegui ler o XML.');
  }
  const inf = doc?.nfeProc?.NFe?.infNFe ?? doc?.NFe?.infNFe;
  if (!inf) throw new BadRequestException('XML não parece uma NF-e válida.');
  const emit = inf.emit ?? {};
  const det = Array.isArray(inf.det) ? inf.det : inf.det ? [inf.det] : [];

  // Cobrança: duplicatas (parcelas com vencimento) e condição de pagamento.
  const dupRaw = inf.cobr?.dup;
  const dups = Array.isArray(dupRaw) ? dupRaw : dupRaw ? [dupRaw] : [];
  const parcelas = dups
    .map((d: any) => ({
      due: String(d?.dVenc ?? '').trim(),
      amountCents: Math.round(Number(d?.vDup ?? 0) * 100),
    }))
    .filter((p: any) => p.due && p.amountCents > 0);
  const detPag = inf.pag?.detPag;
  const pags = Array.isArray(detPag) ? detPag : detPag ? [detPag] : [];
  // indPag: 0 = à vista, 1 = a prazo. A prazo (ou com duplicata) sugere conta a pagar.
  const aprazo = parcelas.length > 0 || pags.some((p: any) => String(p?.indPag ?? '') === '1');

  return {
    supplier: {
      name: String(emit.xNome ?? '').trim(),
      document: String(emit.CNPJ ?? emit.CPF ?? '').trim(),
    },
    document: String(inf.ide?.nNF ?? '').trim(),
    payment: { aprazo, parcelas },
    items: det.map((d: any) => {
      const p = d?.prod ?? {};
      const ean = p.cEAN && String(p.cEAN).toUpperCase() !== 'SEM GTIN' ? String(p.cEAN).trim() : '';
      // origem fica dentro do grupo ICMS (variante: ICMS00, ICMSSN102, …)
      const icmsGrp = d?.imposto?.ICMS ?? {};
      const icms = icmsGrp[Object.keys(icmsGrp)[0]] ?? {};
      const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
      return {
        code: String(p.cProd ?? '').trim(),
        ean,
        name: String(p.xProd ?? '').trim(),
        unit: mapUnit(p.uCom),
        quantity: Number(p.qCom ?? 0),
        costCents: Math.round(Number(p.vUnCom ?? 0) * 100),
        // fiscais intrínsecos do produto (não copiamos CFOP/CST: são da operação do fornecedor)
        ncm: digitos(p.NCM) || '',
        cest: digitos(p.CEST) || '',
        origem: String(icms.orig ?? '').trim(),
      };
    }).filter((i: any) => i.name && i.quantity > 0),
  };
}

@Controller('api/stock')
@Perms('estoque.visualizar')
export class StockController {
  constructor(
    @Inject(PRISMA) private db: Db,
    private stock: StockService,
    private branches: BranchService,
    private audit: AuditService,
    private notify: NotifyService,
    private settings: SettingsService,
    private clock: TimeService,
    private idem: IdempotencyService,
  ) {}

  /** Posição atual: produto × filial, com filtro de baixo/zerado. */
  @Get()
  async position(
    @CurrentUser() u: SessionUser,
    @Query('q') q = '',
    @Query('branchId') branchId?: string,
    @Query('filter') filter = '',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { take, skip, ...rest } = paging(page, pageSize);
    const scope = this.branches.scope(u, branchId);
    const term = q.trim();
    const where: any = {
      companyId: u.companyId, deletedAt: null, active: true,
      ...(term ? { OR: [{ name: { contains: term } }, { sku: { contains: term } }, { barcode: { contains: term } }] } : {}),
    };
    const products = await this.db.product.findMany({
      where, orderBy: { name: 'asc' },
      include: { stocks: true, category: { select: { name: true } } },
    });

    let rows = products.map((p) => {
      const stocks = scope.branchId ? p.stocks.filter((s) => s.branchId === scope.branchId) : p.stocks;
      const quantity = stocks.reduce((sum, s) => sum + s.quantity, 0);
      return {
        id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, unit: p.unit,
        category: p.category?.name ?? null, minStock: p.minStock, maxStock: p.maxStock,
        costCents: p.costCents, priceCents: p.priceCents, quantity,
        totalCostCents: Math.round(p.costCents * quantity),
        lowStock: p.minStock > 0 && quantity <= p.minStock && quantity > 0,
        outOfStock: quantity <= 0,
      };
    });
    if (filter === 'baixo') rows = rows.filter((r) => r.lowStock);
    if (filter === 'zerado') rows = rows.filter((r) => r.outOfStock);

    const total = rows.length;
    return {
      rows: rows.slice(skip, skip + take),
      total,
      ...rest,
      summary: {
        products: total,
        units: rows.reduce((s, r) => s + r.quantity, 0),
        costCents: rows.reduce((s, r) => s + r.totalCostCents, 0),
        low: rows.filter((r) => r.lowStock).length,
        out: rows.filter((r) => r.outOfStock).length,
      },
    };
  }

  @Get('movements')
  async movements(
    @CurrentUser() u: SessionUser,
    @Query('productId') productId?: string,
    @Query('type') type?: string,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { take, skip, ...rest } = paging(page, pageSize);
    const where: any = {
      companyId: u.companyId,
      ...this.branches.scope(u, branchId),
      ...(productId ? { productId } : {}),
      ...(type ? { type: { in: type.split(',') } } : {}),
      ...(from || to ? { createdAtLocal: { ...(from ? { gte: `${from} 00:00` } : {}), ...(to ? { lte: `${to} 23:59` } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.stockMovement.findMany({
        where, orderBy: { createdAtLocal: 'desc' }, take, skip,
        include: {
          product: { select: { id: true, name: true, unit: true } },
          user: { select: { name: true } },
          branch: { select: { name: true } },
        },
      }),
      this.db.stockMovement.count({ where }),
    ]);
    return { rows, total, ...rest };
  }

  @Post('adjust') @Perms('estoque.movimentar')
  async adjust(@CurrentUser() u: SessionUser, @Body() dto: AdjustDto, @Req() req: Request) {
    const branchId = await this.branches.require(u, dto.branchId);
    const at = await this.clock.now(u.companyId);
    await this.assertProduct(u, dto.productId);

    const movement = await this.db.$transaction((tx) => this.stock.setQuantity(tx as Tx, {
      companyId: u.companyId, branchId, productId: dto.productId,
      quantity: dto.quantity, reason: dto.reason, refType: 'Adjust',
      userId: u.sub, at,
    }), TX);
    if (!movement) return { ok: true, unchanged: true };

    await this.audit.log(u, 'stock', 'Product', dto.productId,
      { tipo: 'AJUSTE', de: movement.before, para: movement.after, motivo: dto.reason }, req.ip);
    await this.checkLowStock(u.companyId, dto.productId, movement.after);
    return movement;
  }

  @Post('move') @Perms('estoque.movimentar')
  async move(@CurrentUser() u: SessionUser, @Body() dto: MoveDto, @Req() req: Request) {
    const branchId = await this.branches.require(u, dto.branchId);
    const at = await this.clock.now(u.companyId);
    await this.assertProduct(u, dto.productId);
    const settings = await this.settings.of(u.companyId);

    const movement = await this.db.$transaction((tx) => this.stock.move(tx as Tx, {
      companyId: u.companyId, branchId, productId: dto.productId, type: dto.type,
      quantity: dto.quantity, reason: dto.reason, refType: 'Manual', userId: u.sub, at,
      allowNegative: settings.allowNegativeStock,
    }));
    await this.audit.log(u, 'stock', 'Product', dto.productId,
      { tipo: dto.type, quantidade: dto.quantity, de: movement.before, para: movement.after, motivo: dto.reason }, req.ip);
    await this.checkLowStock(u.companyId, dto.productId, movement.after);
    return movement;
  }

  @Post('transfer') @Perms('estoque.movimentar')
  async transfer(@CurrentUser() u: SessionUser, @Body() dto: TransferDto, @Req() req: Request) {
    if (dto.fromBranchId === dto.toBranchId) throw new BadRequestException('Escolha filiais diferentes.');
    const from = await this.branches.require(u, dto.fromBranchId);
    const to = await this.branches.require(u, dto.toBranchId);
    const at = await this.clock.now(u.companyId);
    await this.assertProduct(u, dto.productId);

    const result = await this.db.$transaction(async (tx) => {
      const out = await this.stock.move(tx as Tx, {
        companyId: u.companyId, branchId: from, productId: dto.productId, type: 'TRANSFERENCIA',
        quantity: dto.quantity, reason: dto.reason || 'Transferência entre filiais',
        refType: 'Transfer', userId: u.sub, at,
      });
      await this.stock.move(tx as Tx, {
        companyId: u.companyId, branchId: to, productId: dto.productId, type: 'ENTRADA',
        quantity: dto.quantity, reason: dto.reason || 'Transferência entre filiais',
        refType: 'Transfer', refId: out.id, userId: u.sub, at,
      });
      return out;
    }, TX);
    await this.audit.log(u, 'stock', 'Product', dto.productId,
      { tipo: 'TRANSFERENCIA', de: from, para: to, quantidade: dto.quantity }, req.ip);
    return result;
  }

  // ---------- entrada de mercadoria ----------
  @Get('entries')
  async entries(
    @CurrentUser() u: SessionUser,
    @Query('supplierId') supplierId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { take, skip, ...rest } = paging(page, pageSize);
    const where: any = {
      companyId: u.companyId,
      ...this.branches.scope(u, branchId),
      ...(supplierId ? { supplierId } : {}),
      ...(from || to ? { createdAtLocal: { ...(from ? { gte: `${from} 00:00` } : {}), ...(to ? { lte: `${to} 23:59` } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.stockEntry.findMany({
        where, orderBy: { createdAtLocal: 'desc' }, take, skip,
        include: {
          supplier: { select: { id: true, name: true } },
          user: { select: { name: true } },
          branch: { select: { name: true } },
          _count: { select: { items: true } },
        },
      }),
      this.db.stockEntry.count({ where }),
    ]);
    return {
      rows: rows.map((e) => ({ ...e, items: e._count.items, _count: undefined })),
      total, ...rest,
    };
  }

  @Get('entries/:id')
  async entry(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const entry = await this.db.stockEntry.findFirst({
      where: { id, companyId: u.companyId },
      include: {
        supplier: true, user: { select: { name: true } }, branch: { select: { name: true } },
        items: { include: { product: { select: { id: true, name: true, unit: true, sku: true } } } },
      },
    });
    if (!entry) throw new NotFoundException('Entrada não encontrada.');
    return entry;
  }

  /**
   * Entrada de mercadoria: estoque, movimentações, custo do produto e (opcional)
   * a conta a pagar do fornecedor, tudo numa transação só.
   */
  @Post('entries') @Perms('estoque.entrada')
  async createEntry(@CurrentUser() u: SessionUser, @Body() dto: EntryDto, @Req() req: Request) {
    if (!dto.items?.length) throw new BadRequestException('Adicione ao menos um produto.');
    if (dto.dueDate && !DATE_RE.test(dto.dueDate)) throw new BadRequestException('Vencimento inválido.');
    if (dto.items.some((i) => !i.productId && !i.newProduct)) {
      throw new BadRequestException('Cada item precisa de um produto existente ou de um produto novo.');
    }
    const branchId = await this.branches.require(u, dto.branchId);
    const at = await this.clock.now(u.companyId);

    if (dto.supplierId) {
      const supplier = await this.db.supplier.findFirst({
        where: { id: dto.supplierId, companyId: u.companyId, deletedAt: null },
      });
      if (!supplier) throw new NotFoundException('Fornecedor não encontrado.');
    }
    const existingIds = dto.items.filter((i) => i.productId).map((i) => i.productId!);
    const products = await this.db.product.findMany({
      where: { companyId: u.companyId, deletedAt: null, id: { in: existingIds } },
    });
    if (products.length !== new Set(existingIds).size) {
      throw new BadRequestException('Algum produto da lista não existe mais.');
    }

    const totalCents = dto.items.reduce((s, i) => s + Math.round(i.costCents * i.quantity), 0);

    const entry = await this.idem.run(u.companyId, 'stock-entry', dto.idempotencyKey, () =>
      this.db.$transaction(async (tx) => {
        // Fornecedor da NF-e sem cadastro: cria agora.
        let supplierId = dto.supplierId || null;
        if (!supplierId && dto.newSupplier) {
          const s = await tx.supplier.create({
            data: { companyId: u.companyId, name: dto.newSupplier.name, document: dto.newSupplier.document || null },
          });
          supplierId = s.id;
        }
        // Itens sem cadastro (NF-e): cria o produto e resolve o productId de cada item.
        // ponytail: preço fica 0 — o usuário define depois (produto entra flagueado sem preço).
        const resolved = [] as { item: EntryItemDto; productId: string }[];
        for (const item of dto.items) {
          let productId = item.productId!;
          if (!productId) {
            const np = await tx.product.create({
              data: {
                companyId: u.companyId, name: item.newProduct!.name,
                barcode: item.newProduct!.barcode || null, sku: item.newProduct!.sku || null,
                unit: item.newProduct!.unit || 'UN', costCents: item.costCents, priceCents: 0,
                ncm: item.newProduct!.ncm?.replace(/\D/g, '') || null,
                cest: item.newProduct!.cest?.replace(/\D/g, '') || null,
                origem: (item.newProduct!.origem || '0').trim() || '0',
              },
            });
            productId = np.id;
          }
          resolved.push({ item, productId });
        }

        const created = await tx.stockEntry.create({
          data: {
            companyId: u.companyId, branchId, supplierId, userId: u.sub,
            document: dto.document || null, notes: dto.notes || null, totalCents, createdAtLocal: at,
            items: {
              create: resolved.map(({ item, productId }) => ({
                companyId: u.companyId, productId, quantity: item.quantity,
                costCents: item.costCents, lot: item.lot || null, expiresAt: item.expiresAt || null,
                notes: item.notes || null,
              })),
            },
          },
        });

        for (const { item, productId } of resolved) {
          await this.stock.move(tx as Tx, {
            companyId: u.companyId, branchId, productId, type: 'ENTRADA',
            quantity: item.quantity, reason: 'Entrada de mercadoria', refType: 'StockEntry',
            refId: created.id, userId: u.sub, at,
          });
          if (dto.updateCost && item.productId && item.costCents > 0) {
            await tx.product.update({ where: { id: productId }, data: { costCents: item.costCents } });
          }
        }

        if (dto.dueDate && totalCents > 0) {
          const category = await tx.financialCategory.findFirst({
            where: { companyId: u.companyId, type: 'DESPESA', name: 'Fornecedores', deletedAt: null },
          });
          await tx.financeEntry.create({
            data: {
              companyId: u.companyId, branchId, type: 'DESPESA',
              description: `Compra de mercadoria${dto.document ? ` · nota ${dto.document}` : ''}`,
              amountCents: totalCents, dueDate: dto.dueDate, status: 'pending',
              categoryId: category?.id ?? null, supplierId, createdById: u.sub,
            },
          });
        }
        return created;
      }, TX));

    await this.audit.log(u, 'create', 'StockEntry', entry.id,
      { itens: dto.items.length, total: totalCents, fornecedor: dto.supplierId }, req.ip);
    return entry;
  }

  /**
   * Lê o XML da NF-e e devolve fornecedor + itens já casados com o cadastro.
   * Não grava nada: é só a leitura para pré-preencher a entrada (o cadastro do
   * que faltar acontece ao confirmar, em `createEntry`).
   */
  @Post('entries/import-nfe') @Perms('estoque.entrada')
  async importNfe(@CurrentUser() u: SessionUser, @Body() dto: ImportNfeDto) {
    if (!dto?.xml?.trim()) throw new BadRequestException('Envie o XML da NF-e.');
    const nfe = parseNfe(dto.xml);
    if (!nfe.items.length) throw new BadRequestException('A NF-e não tem itens.');

    let supplier: { id: string; name: string } | null = null;
    if (nfe.supplier.document) {
      supplier = await this.db.supplier.findFirst({
        where: { companyId: u.companyId, deletedAt: null, document: nfe.supplier.document },
        select: { id: true, name: true },
      });
    }

    const eans = nfe.items.map((i) => i.ean).filter(Boolean);
    const codes = nfe.items.map((i) => i.code).filter(Boolean);
    const found = await this.db.product.findMany({
      where: {
        companyId: u.companyId, deletedAt: null,
        OR: [
          ...(eans.length ? [{ barcode: { in: eans } }] : []),
          ...(codes.length ? [{ sku: { in: codes } }, { internalCode: { in: codes } }] : []),
        ],
      },
      select: { id: true, name: true, barcode: true, sku: true, internalCode: true },
    });
    const byEan = new Map(found.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
    const byCode = new Map<string, (typeof found)[number]>();
    for (const p of found) {
      if (p.sku) byCode.set(p.sku, p);
      if (p.internalCode) byCode.set(p.internalCode, p);
    }

    const items = nfe.items.map((it) => {
      const match = (it.ean && byEan.get(it.ean)) || (it.code && byCode.get(it.code)) || null;
      return { ...it, product: match ? { id: match.id, name: match.name } : null };
    });

    return {
      supplier: { name: nfe.supplier.name, document: nfe.supplier.document, id: supplier?.id ?? null },
      document: nfe.document,
      payment: nfe.payment,
      items,
      unmatched: items.filter((i) => !i.product).length,
    };
  }

  private async assertProduct(u: SessionUser, productId: string) {
    const product = await this.db.product.findFirst({
      where: { id: productId, companyId: u.companyId, deletedAt: null },
    });
    if (!product) throw new NotFoundException('Produto não encontrado.');
    return product;
  }

  /** Avisa uma vez quando o saldo cruza o mínimo (o sino busca as últimas). */
  private async checkLowStock(companyId: string, productId: string, quantity: number) {
    const product = await this.db.product.findUnique({ where: { id: productId } });
    if (!product) return;
    if (quantity <= 0) {
      await this.notify.create(companyId, 'sem_estoque', 'Produto sem estoque',
        `${product.name} ficou zerado.`, `/produto.html?id=${productId}`);
    } else if (product.minStock > 0 && quantity <= product.minStock) {
      await this.notify.create(companyId, 'estoque_baixo', 'Estoque baixo',
        `${product.name}: ${quantity} ${product.unit} (mínimo ${product.minStock}).`,
        `/produto.html?id=${productId}`);
    }
  }
}

@Module({
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
