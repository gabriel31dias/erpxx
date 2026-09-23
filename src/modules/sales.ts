import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Injectable, Module,
  NotFoundException, Param, Post, Query, Req,
} from '@nestjs/common';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import { PRISMA, Db, Tx, TX } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import {
  AuditService, BranchService, IdempotencyService, NotifyService, PlanService, SettingsService, TimeService,
} from '../common/core';
import { can } from '../common/rbac';
import { StockService } from './stock';
import { fmtBRL, itemTotalCents, paging, roundQty } from '../common/util';

export const SALE_STATUS = ['OPEN', 'COMPLETED', 'CANCELLED', 'REFUNDED'];
const UNPAID = { status: 'pending', deletedAt: null };

export class SaleItemDto {
  @IsString() productId!: string;
  @IsNumber() @Min(0.001) quantity!: number;
  @IsOptional() @IsInt() @Min(0) discountCents?: number;
  /** Preço só é aceito para produto pesado/promoção com permissão de desconto. */
  @IsOptional() @IsInt() @Min(0) unitPriceCents?: number;
}

export class SalePaymentDto {
  @IsString() paymentMethodId!: string;
  @IsInt() @Min(1) amountCents!: number;
  @IsOptional() @IsInt() @Min(1) installments?: number;
  /** Dinheiro entregue pelo cliente (para o troco). */
  @IsOptional() @IsInt() @Min(0) receivedCents?: number;
}

export class SaleDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() cashSessionId?: string;
  @IsOptional() @IsInt() @Min(0) discountCents?: number;
  @IsOptional() @IsString() notes?: string;
  /** Reenvio por timeout/fila offline não pode virar duas vendas. */
  @IsOptional() @IsString() idempotencyKey?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => SaleItemDto) items!: SaleItemDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => SalePaymentDto) payments!: SalePaymentDto[];
}

class CancelDto {
  @IsString() @MinLength(3) reason!: string;
  @IsOptional() @IsString() idempotencyKey?: string;
}

export interface SaleActor {
  companyId: string;
  branchId: string | null;
  role: string; // vendedor externo não tem perfil do ERP: nenhuma permissão extra
  userId: string | null; // operador (User)
  sellerId: string | null; // vendedor externo (Seller)
}

/** Dados que só o app do vendedor externo informa. */
export interface ExtSaleInfo {
  offline: boolean;
  paidInApp: boolean;
  appPaymentMethod: string | null;
  appPaymentRef: string | null;
  dueDate?: string; // vencimento da conta a receber ("YYYY-MM-DD"), quando fica pendente
}

export const SALE_INCLUDE = {
  customer: { select: { id: true, name: true, document: true, phone: true } },
  operator: { select: { id: true, name: true } },
  seller: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, name: true, sku: true } } } },
  payments: true,
  attachments: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, fileName: true, mimeType: true, size: true, notes: true, createdAt: true },
  },
} as const;

/**
 * Finalização atômica: valida → grava venda → pagamentos → baixa estoque →
 * registra caixa e financeiro. Qualquer falha desfaz tudo.
 * Usada pelo PDV e pelo lote do vendedor externo — as regras são as mesmas.
 */
@Injectable()
export class SalesService {
  constructor(
    @Inject(PRISMA) private db: Db,
    private stock: StockService,
    private branches: BranchService,
    private audit: AuditService,
    private settings: SettingsService,
    private plans: PlanService,
    private clock: TimeService,
    private idem: IdempotencyService,
  ) {}

  async create(a: SaleActor, dto: SaleDto, ip?: string, soldAt?: string, ext?: ExtSaleInfo) {
    await this.plans.assertActive(a.companyId);
    if (!dto.items?.length) throw new BadRequestException('A venda não tem itens.');
    if (!dto.payments?.length) throw new BadRequestException('Informe ao menos uma forma de pagamento.');

    const branchId = await this.branches.require(a as unknown as SessionUser, dto.branchId);
    const at = soldAt ?? await this.clock.now(a.companyId);
    const settings = await this.settings.of(a.companyId);

    // ----- itens: preço e custo vêm do cadastro, nunca do que o front mandou -----
    const products = await this.db.product.findMany({
      where: { companyId: a.companyId, deletedAt: null, id: { in: dto.items.map((i) => i.productId) } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const items = dto.items.map((i) => {
      const product = byId.get(i.productId);
      if (!product) throw new NotFoundException('Produto da venda não existe mais.');
      if (!product.active) throw new BadRequestException(`"${product.name}" está inativo.`);
      const quantity = roundQty(i.quantity);
      if (product.saleType === 'UNIT' && !Number.isInteger(quantity)) {
        throw new BadRequestException(`"${product.name}" é vendido por unidade — quantidade inteira.`);
      }
      // preço diferente do cadastro exige permissão de desconto
      let unitPrice = product.priceCents;
      if (i.unitPriceCents !== undefined && i.unitPriceCents !== product.priceCents) {
        if (!can(a.role, 'pdv.desconto')) {
          throw new ForbiddenException(`Seu perfil não pode alterar o preço de "${product.name}".`);
        }
        unitPrice = i.unitPriceCents;
      }
      const discount = i.discountCents ?? 0;
      const total = itemTotalCents(unitPrice, quantity, discount);
      if (discount > Math.round(unitPrice * quantity)) {
        throw new BadRequestException(`Desconto maior que o valor do item "${product.name}".`);
      }
      return {
        productId: product.id, name: product.name, unit: product.unit, quantity,
        unitPriceCents: unitPrice, unitCostCents: product.costCents,
        discountCents: discount, totalCents: total,
        gross: Math.round(unitPrice * quantity),
      };
    });

    const subtotal = items.reduce((s, i) => s + i.gross, 0);
    const itemDiscounts = items.reduce((s, i) => s + i.discountCents, 0);
    const saleDiscount = dto.discountCents ?? 0;
    const discountTotal = itemDiscounts + saleDiscount;
    const total = subtotal - discountTotal;
    if (total < 0) throw new BadRequestException('Desconto maior que o valor da venda.');

    // desconto acima do teto do operador exige permissão
    const pct = subtotal > 0 ? (discountTotal / subtotal) * 100 : 0;
    if (pct > settings.maxDiscountPct && !can(a.role, 'pdv.desconto')) {
      throw new ForbiddenException(
        `Desconto de ${pct.toFixed(1)}% acima do limite de ${settings.maxDiscountPct}% do seu perfil.`);
    }
    if (settings.requireCustomer && !dto.customerId) {
      throw new BadRequestException('Esta loja exige identificar o cliente na venda.');
    }
    if (dto.customerId) {
      const customer = await this.db.customer.findFirst({
        where: { id: dto.customerId, companyId: a.companyId, deletedAt: null },
      });
      if (!customer) throw new NotFoundException('Cliente não encontrado.');
    }

    // ----- pagamentos: soma tem que bater com o total -----
    const methods = await this.db.paymentMethod.findMany({
      where: {
        companyId: a.companyId, deletedAt: null, active: true,
        id: { in: dto.payments.map((p) => p.paymentMethodId) },
      },
    });
    const methodById = new Map(methods.map((m) => [m.id, m]));
    let receivedCash = 0;
    const payments = dto.payments.map((p) => {
      const method = methodById.get(p.paymentMethodId);
      if (!method) throw new BadRequestException('Forma de pagamento inválida ou inativa.');
      const installments = p.installments ?? 1;
      if (installments > 1 && !method.allowsInstallments) {
        throw new BadRequestException(`${method.name} não permite parcelamento.`);
      }
      if (installments > method.maxInstallments) {
        throw new BadRequestException(`${method.name} aceita no máximo ${method.maxInstallments}x.`);
      }
      if (method.requiresChange) receivedCash += p.receivedCents ?? p.amountCents;
      return {
        paymentMethodId: method.id, methodName: method.name, methodType: method.type,
        amountCents: p.amountCents, installments,
      };
    });

    const paid = payments.reduce((s, p) => s + p.amountCents, 0);
    if (paid !== total) {
      throw new BadRequestException(
        `Pagamentos (${fmtBRL(paid)}) diferentes do total da venda (${fmtBRL(total)}).`);
    }
    const cashDue = payments.filter((p) => methodById.get(p.paymentMethodId)!.requiresChange)
      .reduce((s, p) => s + p.amountCents, 0);
    if (receivedCash < cashDue) throw new BadRequestException('Valor recebido em dinheiro menor que o pagamento.');
    const change = receivedCash - cashDue;

    // ----- caixa aberto (vendedor externo não passa pelo caixa da loja) -----
    const session = a.sellerId ? null : await this.currentSession(a, branchId, dto.cashSessionId);

    // venda do app não paga (ou boleto ainda não compensado) vira conta a receber pendente
    const { dueDate, ...extCols } = ext ?? {};
    const receivable = !!ext && (!ext.paidInApp || ext.appPaymentMethod === 'boleto');

    const sale = await this.idem.run(a.companyId, 'sale', dto.idempotencyKey, () =>
      this.db.$transaction(async (tx) => {
        const last = await tx.sale.aggregate({ where: { companyId: a.companyId }, _max: { number: true } });
        // ponytail: número sequencial via max+1 dentro da transação — o SQLite
        // serializa escritas; no Postgres trocar por sequence por empresa.
        const number = (last._max.number ?? 0) + 1;

        const created = await tx.sale.create({
          data: {
            companyId: a.companyId, branchId, cashSessionId: session?.id ?? null,
            customerId: dto.customerId || null, operatorId: a.userId, sellerId: a.sellerId, number, status: 'COMPLETED',
            subtotalCents: subtotal, discountCents: discountTotal, totalCents: total,
            costTotalCents: items.reduce((s, i) => s + Math.round(i.unitCostCents * i.quantity), 0),
            receivedCents: receivedCash, changeCents: change,
            notes: dto.notes || null, soldAt: at, ...extCols,
            items: {
              create: items.map(({ gross, ...i }) => ({ ...i, companyId: a.companyId })),
            },
            payments: { create: payments.map((p) => ({ ...p, companyId: a.companyId })) },
          },
          include: SALE_INCLUDE,
        });

        if (settings.stockControl) {
          for (const item of items) {
            await this.stock.move(tx as Tx, {
              companyId: a.companyId, branchId, productId: item.productId, type: 'VENDA',
              quantity: item.quantity, reason: `Venda #${number}`, refType: 'Sale', refId: created.id,
              userId: a.userId, at, allowNegative: settings.allowNegativeStock,
            });
          }
        }

        if (session) {
          for (const p of payments) {
            await tx.cashMovement.create({
              data: {
                companyId: a.companyId, sessionId: session.id, type: 'venda',
                amountCents: p.amountCents, paymentMethodId: p.paymentMethodId,
                description: `Venda #${number} · ${p.methodName}`,
                userId: a.userId, refType: 'Sale', refId: created.id, createdAtLocal: at,
              },
            });
          }
        }

        // financeiro: a venda vira receita — recebida, ou pendente se o app ainda vai receber
        const category = await tx.financialCategory.findFirst({
          where: { companyId: a.companyId, type: 'RECEITA', name: 'Vendas', deletedAt: null },
        });
        await tx.financeEntry.create({
          data: {
            companyId: a.companyId, branchId, type: 'RECEITA',
            description: `Venda #${number}`, amountCents: total,
            dueDate: receivable ? dueDate ?? at.slice(0, 10) : at.slice(0, 10),
            paidAt: receivable ? null : at.slice(0, 10), status: receivable ? 'pending' : 'paid',
            categoryId: category?.id ?? null, customerId: dto.customerId || null,
            saleId: created.id, paymentMethodId: payments[0].paymentMethodId, createdById: a.userId,
            instrument: ext?.paidInApp ? ext.appPaymentMethod : null,
            instrumentInfo: ext?.appPaymentMethod === 'boleto' && ext.appPaymentRef
              ? JSON.stringify({ nossoNumero: ext.appPaymentRef }) : null,
          },
        });
        return created;
      }, TX));

    const who = { sub: a.userId ?? undefined, companyId: a.companyId };
    await this.audit.log(who, 'create', 'Sale', sale.id,
      { numero: sale.number, total, desconto: discountTotal, itens: items.length,
        ...(a.sellerId ? { vendedorExterno: a.sellerId } : {}) }, ip);
    if (discountTotal > 0) {
      await this.audit.log(who, 'discount', 'Sale', sale.id,
        { numero: sale.number, desconto: discountTotal, percentual: Number(pct.toFixed(2)) }, ip);
    }
    return { ...sale, changeCents: change };
  }

  /** Sessão de caixa aberta do operador na filial (obrigatória para vender). */
  private async currentSession(u: SaleActor, branchId: string, sessionId?: string) {
    if (sessionId) {
      const session = await this.db.cashSession.findFirst({
        where: { id: sessionId, companyId: u.companyId, status: 'open' },
      });
      if (!session) throw new BadRequestException('Sessão de caixa fechada ou inexistente.');
      return session;
    }
    const open = await this.db.cashSession.findFirst({
      where: { companyId: u.companyId, branchId, status: 'open', operatorId: u.userId ?? undefined },
      orderBy: { openedAt: 'desc' },
    });
    if (open) return open;
    const any = await this.db.cashSession.findFirst({
      where: { companyId: u.companyId, branchId, status: 'open' },
      orderBy: { openedAt: 'desc' },
    });
    if (!any) throw new BadRequestException('Abra o caixa antes de vender.');
    return any;
  }
}

@Controller('api/sales')
@Perms('venda.visualizar')
export class SalesController {
  constructor(
    @Inject(PRISMA) private db: Db,
    private sales: SalesService,
    private stock: StockService,
    private branches: BranchService,
    private audit: AuditService,
    private notify: NotifyService,
    private settings: SettingsService,
    private clock: TimeService,
    private idem: IdempotencyService,
  ) {}

  // o ERP também vê o recebimento: venda com lançamento pendente = não paga
  private include = {
    ...SALE_INCLUDE,
    finEntries: { where: { deletedAt: null }, select: { id: true, status: true, dueDate: true, paidAt: true } },
  } as const;

  /** "paid" | "unpaid" | "cancelled", vindo do lançamento financeiro da venda. */
  private withPayment<T extends { status: string; finEntries: { status: string; dueDate: string }[] }>(sale: T) {
    const pending = sale.finEntries.find((e) => e.status === 'pending');
    return {
      ...sale,
      paymentStatus: sale.status === 'CANCELLED' ? 'cancelled' : pending ? 'unpaid' : 'paid',
      dueDate: pending?.dueDate ?? null,
    };
  }

  // ---------- leitura ----------
  @Get()
  async list(
    @CurrentUser() u: SessionUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('operatorId') operatorId?: string,
    @Query('sellerId') sellerId?: string,
    @Query('branchId') branchId?: string,
    @Query('paymentMethodId') paymentMethodId?: string,
    @Query('paid') paid?: string, // 'yes' | 'no'
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { take, skip, ...rest } = paging(page, pageSize);
    const term = q?.trim();
    const where: any = {
      companyId: u.companyId,
      ...this.branches.scope(u, branchId),
      ...(status ? { status: { in: status.split(',') } } : {}),
      ...(customerId ? { customerId } : {}),
      ...(operatorId ? { operatorId } : {}),
      ...(sellerId ? { sellerId } : {}),
      ...(paymentMethodId ? { payments: { some: { paymentMethodId } } } : {}),
      ...(paid === 'no' ? { status: 'COMPLETED', finEntries: { some: UNPAID } } : {}),
      ...(paid === 'yes' ? { status: 'COMPLETED', finEntries: { none: UNPAID } } : {}),
      ...(from || to ? { soldAt: { ...(from ? { gte: `${from} 00:00` } : {}), ...(to ? { lte: `${to} 23:59` } : {}) } } : {}),
      ...(term ? {
        OR: [
          ...(Number(term) ? [{ number: Number(term) }] : []),
          { customer: { name: { contains: term } } },
          { items: { some: { name: { contains: term } } } },
        ],
      } : {}),
    };
    const [rows, total, sum, unpaid] = await Promise.all([
      this.db.sale.findMany({ where, orderBy: { soldAt: 'desc' }, take, skip, include: this.include }),
      this.db.sale.count({ where }),
      this.db.sale.aggregate({ where: { ...where, status: 'COMPLETED' }, _sum: { totalCents: true, costTotalCents: true } }),
      this.db.sale.aggregate({
        where: { ...where, status: 'COMPLETED', finEntries: { some: UNPAID } },
        _sum: { totalCents: true }, _count: true,
      }),
    ]);
    return {
      rows: rows.map((r) => this.withPayment(r)), total, ...rest,
      summary: {
        unpaidCents: unpaid._sum.totalCents ?? 0,
        unpaidCount: unpaid._count,
        totalCents: sum._sum.totalCents ?? 0,
        costCents: sum._sum.costTotalCents ?? 0,
        profitCents: (sum._sum.totalCents ?? 0) - (sum._sum.costTotalCents ?? 0),
      },
    };
  }

  @Get(':id')
  async detail(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const sale = await this.db.sale.findFirst({
      where: { id, companyId: u.companyId },
      include: { ...this.include, session: { select: { id: true, openedAt: true } } },
    });
    if (!sale) throw new NotFoundException('Venda não encontrada.');
    const company = await this.db.company.findUniqueOrThrow({ where: { id: u.companyId } });
    const settings = await this.settings.of(u.companyId);
    return {
      sale: this.withPayment(sale),
      // dados do comprovante não fiscal (briefing 45): a impressão é do cliente
      receipt: {
        company: {
          name: company.tradeName || company.name, document: company.document,
          address: [company.address, company.number, company.district, company.city, company.state]
            .filter(Boolean).join(', '),
          phone: company.phone,
        },
        footer: settings.receiptFooter,
      },
    };
  }

  // ---------- venda ----------
  @Post() @Perms('pdv.acessar')
  create(@CurrentUser() u: SessionUser, @Body() dto: SaleDto, @Req() req: Request) {
    return this.sales.create({
      companyId: u.companyId, branchId: u.branchId, role: u.role, userId: u.sub, sellerId: null,
    }, dto, req.ip);
  }

  /** Cancelamento nunca apaga: muda status, estorna estoque e registra tudo. */
  @Post(':id/cancel') @Perms('pdv.cancelar_venda')
  async cancel(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: CancelDto, @Req() req: Request) {
    const sale = await this.db.sale.findFirst({
      where: { id, companyId: u.companyId }, include: { items: true, payments: true },
    });
    if (!sale) throw new NotFoundException('Venda não encontrada.');
    if (sale.status === 'CANCELLED') return sale;
    if (sale.status !== 'COMPLETED') throw new BadRequestException('Só é possível cancelar uma venda concluída.');

    const at = await this.clock.now(u.companyId);
    const settings = await this.settings.of(u.companyId);

    const cancelled = await this.idem.run(u.companyId, 'sale-cancel', dto.idempotencyKey, () =>
      this.db.$transaction(async (tx) => {
        const updated = await tx.sale.update({
          where: { id },
          data: {
            status: 'CANCELLED', cancelReason: dto.reason,
            cancelledById: u.sub, cancelledAt: new Date(),
          },
          include: this.include,
        });

        if (settings.stockControl) {
          for (const item of sale.items) {
            await this.stock.move(tx as Tx, {
              companyId: u.companyId, branchId: sale.branchId, productId: item.productId,
              type: 'CANCELAMENTO', quantity: item.quantity,
              reason: `Cancelamento da venda #${sale.number}`, refType: 'Sale', refId: sale.id,
              userId: u.sub, at,
            });
          }
        }

        if (sale.cashSessionId) {
          const session = await tx.cashSession.findFirst({
            where: { id: sale.cashSessionId, companyId: u.companyId },
          });
          // caixa já fechado não é remexido: o estorno entra no caixa aberto atual
          const target = session?.status === 'open' ? session : await tx.cashSession.findFirst({
            where: { companyId: u.companyId, branchId: sale.branchId, status: 'open' },
          });
          if (target) {
            for (const p of sale.payments) {
              await tx.cashMovement.create({
                data: {
                  companyId: u.companyId, sessionId: target.id, type: 'estorno',
                  amountCents: -p.amountCents, paymentMethodId: p.paymentMethodId,
                  description: `Cancelamento da venda #${sale.number} · ${p.methodName}`,
                  userId: u.sub, refType: 'Sale', refId: sale.id, createdAtLocal: at,
                },
              });
            }
          }
        }

        await tx.financeEntry.updateMany({
          where: { companyId: u.companyId, saleId: sale.id },
          data: { status: 'cancelled', notes: `Venda cancelada: ${dto.reason}` },
        });
        return updated;
      }, TX));

    await this.audit.log(u, 'cancel', 'Sale', id,
      { numero: sale.number, total: sale.totalCents, motivo: dto.reason }, req.ip);
    await this.notify.create(u.companyId, 'venda', 'Venda cancelada',
      `#${sale.number} · ${fmtBRL(sale.totalCents)} · ${dto.reason}`, `/venda.html?id=${id}`);
    return cancelled;
  }
}

@Module({
  imports: [],
  controllers: [SalesController],
  providers: [StockService, SalesService],
  exports: [SalesService],
})
export class SalesModule {}
