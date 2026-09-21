import { Controller, Get, Header, Inject, Module, Query } from '@nestjs/common';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { BranchService, PlanService, TimeService } from '../common/core';
import { addDays, fmtBRL, periodRange, toCsv } from '../common/util';

/**
 * Relatórios e dashboard. As contas pesadas usam groupBy/aggregate no banco;
 * ponytail: os cruzamentos pequenos (top produtos do dia) somam em memória sobre
 * um recorte já filtrado por período — virar view materializada só se doer.
 */
@Controller('api/reports')
@Perms('relatorio.visualizar')
export class ReportsController {
  constructor(
    @Inject(PRISMA) private db: Db,
    private branches: BranchService,
    private plans: PlanService,
    private clock: TimeService,
  ) {}

  private range(period: string, from?: string, to?: string) {
    return from && to ? { from, to } : periodRange(period);
  }

  private saleWhere(u: SessionUser, from: string, to: string, branchId?: string) {
    return {
      companyId: u.companyId, status: 'COMPLETED',
      ...this.branches.scope(u, branchId),
      soldAt: { gte: `${from} 00:00`, lte: `${to} 23:59` },
    };
  }

  // ---------- dashboard ----------
  @Get('dashboard')
  @Perms('dashboard.visualizar')
  async dashboard(
    @CurrentUser() u: SessionUser,
    @Query('period') period = 'mes',
    @Query('from') fromQ?: string,
    @Query('to') toQ?: string,
    @Query('branchId') branchId?: string,
  ) {
    const { from, to } = this.range(period, fromQ, toQ);
    const today = await this.clock.today(u.companyId);
    const scope = this.branches.scope(u, branchId);

    const [periodAgg, todayAgg, sales, expenses, lowStock, openSessions] = await Promise.all([
      this.db.sale.aggregate({
        where: this.saleWhere(u, from, to, branchId),
        _sum: { totalCents: true, costTotalCents: true, discountCents: true }, _count: true,
      }),
      this.db.sale.aggregate({
        where: this.saleWhere(u, today, today, branchId),
        _sum: { totalCents: true, costTotalCents: true }, _count: true,
      }),
      this.db.sale.findMany({
        where: this.saleWhere(u, from, to, branchId),
        select: { soldAt: true, totalCents: true, items: { select: { productId: true, name: true, quantity: true, totalCents: true } }, payments: { select: { methodName: true, amountCents: true } } },
      }),
      this.db.financeEntry.groupBy({
        by: ['type'],
        where: {
          companyId: u.companyId, deletedAt: null, status: 'paid', ...scope,
          paidAt: { gte: from, lte: to },
        },
        _sum: { amountCents: true },
      }),
      this.db.product.findMany({
        where: { companyId: u.companyId, deletedAt: null, active: true },
        select: { id: true, name: true, minStock: true, unit: true, stocks: { select: { branchId: true, quantity: true } } },
      }),
      this.db.cashSession.findMany({
        where: { companyId: u.companyId, status: 'open', ...scope },
        include: { register: { select: { name: true } }, operator: { select: { name: true } } },
      }),
    ]);

    // gráficos derivados das vendas do período (uma leitura só)
    const byDay = new Map<string, { date: string; totalCents: number; count: number }>();
    const byProduct = new Map<string, { productId: string; name: string; quantity: number; totalCents: number }>();
    const byPayment = new Map<string, { name: string; totalCents: number }>();
    for (const sale of sales) {
      const day = sale.soldAt.slice(0, 10);
      const d = byDay.get(day) ?? { date: day, totalCents: 0, count: 0 };
      d.totalCents += sale.totalCents; d.count += 1;
      byDay.set(day, d);
      for (const item of sale.items) {
        const p = byProduct.get(item.productId) ?? { productId: item.productId, name: item.name, quantity: 0, totalCents: 0 };
        p.quantity += item.quantity; p.totalCents += item.totalCents;
        byProduct.set(item.productId, p);
      }
      for (const pay of sale.payments) {
        const m = byPayment.get(pay.methodName) ?? { name: pay.methodName, totalCents: 0 };
        m.totalCents += pay.amountCents;
        byPayment.set(pay.methodName, m);
      }
    }

    const stock = lowStock.map((p) => {
      const qty = (scope.branchId ? p.stocks.filter((s) => s.branchId === scope.branchId) : p.stocks)
        .reduce((s, x) => s + x.quantity, 0);
      return { id: p.id, name: p.name, unit: p.unit, quantity: qty, minStock: p.minStock };
    });

    const revenue = periodAgg._sum.totalCents ?? 0;
    const cost = periodAgg._sum.costTotalCents ?? 0;
    const count = periodAgg._count || 0;
    const receita = expenses.find((e) => e.type === 'RECEITA')?._sum.amountCents ?? 0;
    const despesa = expenses.find((e) => e.type === 'DESPESA')?._sum.amountCents ?? 0;
    const cashOnHand = openSessions.length
      ? (await Promise.all(openSessions.map(async (s) => {
          const movements = await this.db.cashMovement.findMany({ where: { companyId: u.companyId, sessionId: s.id } });
          return movements.reduce((sum, m) => sum + (m.type === 'abertura' ? 0 : m.amountCents), s.openingCents);
        }))).reduce((a, b) => a + b, 0)
      : 0;

    return {
      period: { from, to },
      cards: {
        todayCents: todayAgg._sum.totalCents ?? 0,
        todayCount: todayAgg._count || 0,
        revenueCents: revenue,
        salesCount: count,
        avgTicketCents: count ? Math.round(revenue / count) : 0,
        profitCents: revenue - cost,
        discountCents: periodAgg._sum.discountCents ?? 0,
        incomeCents: receita,
        expenseCents: despesa,
        balanceCents: receita - despesa,
        cashOnHandCents: cashOnHand,
        lowStockCount: stock.filter((s) => s.minStock > 0 && s.quantity <= s.minStock && s.quantity > 0).length,
        outOfStockCount: stock.filter((s) => s.quantity <= 0).length,
      },
      charts: {
        byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
        topProducts: [...byProduct.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 8),
        byPayment: [...byPayment.values()].sort((a, b) => b.totalCents - a.totalCents),
      },
      lowStock: stock.filter((s) => s.quantity <= 0 || (s.minStock > 0 && s.quantity <= s.minStock))
        .sort((a, b) => a.quantity - b.quantity).slice(0, 10),
      openSessions: openSessions.map((s) => ({
        id: s.id, register: s.register.name, operator: s.operator?.name, openedAt: s.openedAt,
      })),
    };
  }

  /** Comparação com o período anterior de mesmo tamanho. */
  @Get('compare')
  async compare(
    @CurrentUser() u: SessionUser,
    @Query('period') period = 'mes',
    @Query('from') fromQ?: string,
    @Query('to') toQ?: string,
    @Query('branchId') branchId?: string,
  ) {
    const { from, to } = this.range(period, fromQ, toQ);
    const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(days - 1));

    const [current, previous] = await Promise.all([
      this.db.sale.aggregate({ where: this.saleWhere(u, from, to, branchId), _sum: { totalCents: true }, _count: true }),
      this.db.sale.aggregate({ where: this.saleWhere(u, prevFrom, prevTo, branchId), _sum: { totalCents: true }, _count: true }),
    ]);
    const a = current._sum.totalCents ?? 0;
    const b = previous._sum.totalCents ?? 0;
    return {
      current: { from, to, totalCents: a, count: current._count || 0 },
      previous: { from: prevFrom, to: prevTo, totalCents: b, count: previous._count || 0 },
      variationPct: b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null,
    };
  }

  // ---------- vendas ----------
  @Get('sales')
  async sales(
    @CurrentUser() u: SessionUser,
    @Query('groupBy') groupBy = 'day',
    @Query('period') period = 'mes',
    @Query('from') fromQ?: string,
    @Query('to') toQ?: string,
    @Query('branchId') branchId?: string,
  ) {
    const { from, to } = this.range(period, fromQ, toQ);
    const where = this.saleWhere(u, from, to, branchId);
    const rows = await this.db.sale.findMany({
      where,
      include: {
        items: { include: { product: { select: { categoryId: true } } } },
        payments: true,
        customer: { select: { id: true, name: true } },
        operator: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    const categories = await this.db.category.findMany({ where: { companyId: u.companyId, deletedAt: null } });
    const catName = new Map(categories.map((c) => [c.id, c.name]));

    type Row = { key: string; label: string; quantity: number; totalCents: number; costCents: number; count: number };
    const map = new Map<string, Row>();
    const add = (key: string, label: string, total: number, cost: number, qty = 0) => {
      const r = map.get(key) ?? { key, label, quantity: 0, totalCents: 0, costCents: 0, count: 0 };
      r.totalCents += total; r.costCents += cost; r.quantity += qty; r.count += 1;
      map.set(key, r);
    };

    for (const sale of rows) {
      if (groupBy === 'day') add(sale.soldAt.slice(0, 10), sale.soldAt.slice(0, 10), sale.totalCents, sale.costTotalCents);
      else if (groupBy === 'operator') add(sale.operatorId ?? 'sem', sale.operator?.name ?? 'Sem operador', sale.totalCents, sale.costTotalCents);
      else if (groupBy === 'branch') add(sale.branchId, sale.branch.name, sale.totalCents, sale.costTotalCents);
      else if (groupBy === 'customer') add(sale.customerId ?? 'sem', sale.customer?.name ?? 'Não identificado', sale.totalCents, sale.costTotalCents);
      else if (groupBy === 'payment') {
        for (const p of sale.payments) add(p.paymentMethodId, p.methodName, p.amountCents, 0);
      } else if (groupBy === 'product') {
        for (const i of sale.items) {
          add(i.productId, i.name, i.totalCents, Math.round(i.unitCostCents * i.quantity), i.quantity);
        }
      } else if (groupBy === 'category') {
        for (const i of sale.items) {
          const key = i.product.categoryId ?? 'sem';
          add(key, catName.get(key) ?? 'Sem categoria', i.totalCents, Math.round(i.unitCostCents * i.quantity), i.quantity);
        }
      }
    }

    const result = [...map.values()]
      .map((r) => ({ ...r, profitCents: r.totalCents - r.costCents }))
      .sort((a, b) => (groupBy === 'day' ? a.key.localeCompare(b.key) : b.totalCents - a.totalCents));

    return {
      from, to, groupBy, rows: result,
      totals: {
        totalCents: rows.reduce((s, r) => s + r.totalCents, 0),
        costCents: rows.reduce((s, r) => s + r.costTotalCents, 0),
        profitCents: rows.reduce((s, r) => s + r.totalCents - r.costTotalCents, 0),
        count: rows.length,
        avgTicketCents: rows.length ? Math.round(rows.reduce((s, r) => s + r.totalCents, 0) / rows.length) : 0,
      },
    };
  }

  /** Produtos parados: vendidos abaixo de um limite no período. */
  @Get('slow-movers')
  async slowMovers(
    @CurrentUser() u: SessionUser,
    @Query('period') period = 'mes',
    @Query('from') fromQ?: string,
    @Query('to') toQ?: string,
    @Query('branchId') branchId?: string,
  ) {
    const { from, to } = this.range(period, fromQ, toQ);
    const sold = await this.db.saleItem.groupBy({
      by: ['productId'],
      where: {
        companyId: u.companyId,
        sale: { status: 'COMPLETED', soldAt: { gte: `${from} 00:00`, lte: `${to} 23:59` }, ...this.branches.scope(u, branchId) },
      },
      _sum: { quantity: true, totalCents: true },
    });
    const soldBy = new Map(sold.map((s) => [s.productId, s]));
    const products = await this.db.product.findMany({
      where: { companyId: u.companyId, deletedAt: null, active: true },
      select: { id: true, name: true, unit: true, priceCents: true, stocks: { select: { quantity: true, branchId: true } } },
    });
    const scope = this.branches.scope(u, branchId);
    return {
      from, to,
      rows: products.map((p) => ({
        id: p.id, name: p.name, unit: p.unit, priceCents: p.priceCents,
        quantity: soldBy.get(p.id)?._sum.quantity ?? 0,
        totalCents: soldBy.get(p.id)?._sum.totalCents ?? 0,
        stock: (scope.branchId ? p.stocks.filter((s) => s.branchId === scope.branchId) : p.stocks)
          .reduce((s, x) => s + x.quantity, 0),
      })).sort((a, b) => a.quantity - b.quantity).slice(0, 100),
    };
  }

  // ---------- exportação ----------
  @Get('export')
  @Perms('relatorio.exportar')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="relatorio.csv"')
  async export(
    @CurrentUser() u: SessionUser,
    @Query('type') type = 'sales',
    @Query('groupBy') groupBy = 'day',
    @Query('period') period = 'mes',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    await this.plans.requireFeature(u.companyId, 'export', 'A exportação de relatórios');
    if (type === 'stock') {
      const products = await this.db.product.findMany({
        where: { companyId: u.companyId, deletedAt: null },
        include: { stocks: true, category: { select: { name: true } } },
        orderBy: { name: 'asc' },
      });
      const scope = this.branches.scope(u, branchId);
      return toCsv(products.map((p) => ({
        Produto: p.name, SKU: p.sku ?? '', 'Código de barras': p.barcode ?? '',
        Categoria: p.category?.name ?? '', Unidade: p.unit,
        Estoque: (scope.branchId ? p.stocks.filter((s) => s.branchId === scope.branchId) : p.stocks)
          .reduce((s, x) => s + x.quantity, 0),
        'Estoque mínimo': p.minStock,
        Custo: fmtBRL(p.costCents), Preço: fmtBRL(p.priceCents),
      })));
    }
    const report = await this.sales(u, groupBy, period, from, to, branchId);
    return toCsv(report.rows.map((r) => ({
      Referência: r.label, Vendas: r.count, Quantidade: r.quantity,
      Total: fmtBRL(r.totalCents), Custo: fmtBRL(r.costCents), Lucro: fmtBRL(r.profitCents),
    })));
  }
}

@Module({ controllers: [ReportsController] })
export class ReportsModule {}
