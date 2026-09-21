import { Controller, Get, Inject, Module, Param, Post, Query } from '@nestjs/common';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, Public, SessionUser } from '../common/auth.guard';
import { BranchService } from '../common/core';
import { can } from '../common/rbac';
import { paging } from '../common/util';

@Controller('api')
export class MiscController {
  constructor(@Inject(PRISMA) private db: Db, private branches: BranchService) {}

  @Public() @Get('health')
  async health() {
    await this.db.$queryRawUnsafe('SELECT 1');
    return { ok: true, at: new Date().toISOString(), uptime: Math.round(process.uptime()) };
  }

  /** Busca global: produto, cliente, venda e fornecedor — sempre no tenant e com permissão. */
  @Get('search')
  async search(@CurrentUser() u: SessionUser, @Query('q') q = '') {
    const term = q.trim();
    if (term.length < 2) return { products: [], customers: [], sales: [], suppliers: [] };
    const take = 5;

    const [products, customers, sales, suppliers] = await Promise.all([
      can(u.role, 'produto.visualizar') ? this.db.product.findMany({
        where: {
          companyId: u.companyId, deletedAt: null,
          OR: [{ name: { contains: term } }, { sku: { contains: term } }, { barcode: { contains: term } }],
        },
        select: { id: true, name: true, sku: true, priceCents: true }, take,
      }) : [],
      can(u.role, 'cliente.visualizar') ? this.db.customer.findMany({
        where: {
          companyId: u.companyId, deletedAt: null,
          OR: [{ name: { contains: term } }, { phone: { contains: term } }, { document: { contains: term } }],
        },
        select: { id: true, name: true, phone: true }, take,
      }) : [],
      can(u.role, 'venda.visualizar') ? this.db.sale.findMany({
        where: {
          companyId: u.companyId,
          ...this.branches.scope(u),
          OR: [
            ...(Number(term) ? [{ number: Number(term) }] : []),
            { customer: { name: { contains: term } } },
          ],
        },
        select: { id: true, number: true, soldAt: true, totalCents: true, customer: { select: { name: true } } },
        orderBy: { soldAt: 'desc' }, take,
      }) : [],
      can(u.role, 'fornecedor.visualizar') ? this.db.supplier.findMany({
        where: {
          companyId: u.companyId, deletedAt: null,
          OR: [{ name: { contains: term } }, { tradeName: { contains: term } }, { document: { contains: term } }],
        },
        select: { id: true, name: true, phone: true }, take,
      }) : [],
    ]);

    return {
      products, customers, suppliers,
      sales: sales.map((s) => ({
        id: s.id, label: `#${s.number} · ${s.customer?.name ?? 'Não identificado'}`,
        soldAt: s.soldAt, totalCents: s.totalCents,
      })),
    };
  }

  @Get('notifications')
  async notifications(@CurrentUser() u: SessionUser, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const { take, skip, ...rest } = paging(page, pageSize);
    const where = { companyId: u.companyId, OR: [{ userId: null }, { userId: u.sub }] };
    const [rows, total, unread] = await Promise.all([
      this.db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      this.db.notification.count({ where }),
      this.db.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return { rows, total, unread, ...rest };
  }

  @Post('notifications/read')
  async readAll(@CurrentUser() u: SessionUser) {
    await this.db.notification.updateMany({
      where: { companyId: u.companyId, readAt: null, OR: [{ userId: null }, { userId: u.sub }] },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  @Post('notifications/:id/read')
  async read(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    await this.db.notification.updateMany({ where: { id, companyId: u.companyId }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Get('audit') @Perms('auditoria.visualizar')
  async audit(
    @CurrentUser() u: SessionUser,
    @Query('entity') entity?: string,
    @Query('action') action?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { take, skip, ...rest } = paging(page, pageSize);
    const where: any = {
      companyId: u.companyId,
      ...(entity ? { entity } : {}),
      ...(action ? { action } : {}),
      ...(userId ? { userId } : {}),
      ...(from || to ? {
        createdAt: {
          ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
          ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
        },
      } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.auditLog.findMany({
        where, orderBy: { createdAt: 'desc' }, take, skip,
        include: { user: { select: { name: true } } },
      }),
      this.db.auditLog.count({ where }),
    ]);
    return {
      rows: rows.map((r) => ({ ...r, data: JSON.parse(r.data || '{}') })),
      total, ...rest,
    };
  }
}

@Module({ controllers: [MiscController] })
export class MiscModule {}
