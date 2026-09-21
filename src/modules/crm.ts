import {
  Body, Controller, Delete, Get, Inject, Module, NotFoundException, Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import type { Request } from 'express';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService } from '../common/core';
import { DATE_RE, paging } from '../common/util';

class CustomerDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() document?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() whatsapp?: string;
  @IsOptional() @IsEmail({}, { message: 'E-mail inválido.' }) email?: string;
  @IsOptional() @Matches(DATE_RE, { message: 'Data de nascimento inválida.' }) birthdate?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class SupplierDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() tradeName?: string;
  @IsOptional() @IsString() document?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() whatsapp?: string;
  @IsOptional() @IsEmail({}, { message: 'E-mail inválido.' }) email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Controller('api/customers')
@Perms('cliente.visualizar')
export class CustomersController {
  constructor(@Inject(PRISMA) private db: Db, private audit: AuditService) {}

  @Get()
  async list(
    @CurrentUser() u: SessionUser,
    @Query('q') q = '',
    @Query('status') status = '',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { take, skip, ...rest } = paging(page, pageSize);
    const term = q.trim();
    const where = {
      companyId: u.companyId, deletedAt: null,
      ...(status === 'ativo' ? { active: true } : status === 'inativo' ? { active: false } : {}),
      ...(term ? {
        OR: [
          { name: { contains: term } }, { phone: { contains: term } },
          { whatsapp: { contains: term } }, { document: { contains: term } },
          { email: { contains: term } },
        ],
      } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.customer.findMany({ where, orderBy: { name: 'asc' }, take, skip }),
      this.db.customer.count({ where }),
    ]);
    return { rows, total, ...rest };
  }

  @Get(':id')
  async detail(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const customer = await this.db.customer.findFirst({
      where: { id, companyId: u.companyId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');

    const sales = await this.db.sale.findMany({
      where: { companyId: u.companyId, customerId: id, status: 'COMPLETED' },
      orderBy: { soldAt: 'desc' }, take: 50,
      include: { payments: true, _count: { select: { items: true } } },
    });
    const agg = await this.db.sale.aggregate({
      where: { companyId: u.companyId, customerId: id, status: 'COMPLETED' },
      _sum: { totalCents: true }, _count: true, _max: { soldAt: true },
    });
    const count = agg._count || 0;
    const totalCents = agg._sum.totalCents ?? 0;
    const open = await this.db.financeEntry.aggregate({
      where: { companyId: u.companyId, customerId: id, type: 'RECEITA', status: 'pending', deletedAt: null },
      _sum: { amountCents: true },
    });

    return {
      customer,
      stats: {
        salesCount: count,
        totalCents,
        avgTicketCents: count ? Math.round(totalCents / count) : 0,
        lastSaleAt: agg._max.soldAt,
        openReceivableCents: open._sum.amountCents ?? 0,
      },
      sales: sales.map((s) => ({
        id: s.id, number: s.number, soldAt: s.soldAt, totalCents: s.totalCents,
        items: s._count.items, payments: s.payments.map((p) => p.methodName).join(', '),
      })),
    };
  }

  @Post() @Perms('cliente.gerenciar')
  async create(@CurrentUser() u: SessionUser, @Body() dto: CustomerDto, @Req() req: Request) {
    const customer = await this.db.customer.create({ data: { ...this.data(dto), companyId: u.companyId } });
    await this.audit.log(u, 'create', 'Customer', customer.id, { nome: customer.name }, req.ip);
    return customer;
  }

  @Patch(':id') @Perms('cliente.gerenciar')
  async update(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: CustomerDto, @Req() req: Request) {
    const before = await this.db.customer.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!before) throw new NotFoundException('Cliente não encontrado.');
    const customer = await this.db.customer.update({ where: { id }, data: this.data(dto) });
    await this.audit.log(u, 'update', 'Customer', id, AuditService.diff(before, customer), req.ip);
    return customer;
  }

  @Delete(':id') @Perms('cliente.gerenciar')
  async remove(@CurrentUser() u: SessionUser, @Param('id') id: string, @Req() req: Request) {
    const customer = await this.db.customer.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');
    await this.db.customer.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    await this.audit.log(u, 'delete', 'Customer', id, { nome: customer.name }, req.ip);
    return { ok: true };
  }

  private data(dto: CustomerDto) {
    return {
      name: dto.name.trim(),
      document: dto.document || null,
      phone: dto.phone || null,
      whatsapp: dto.whatsapp || dto.phone || null,
      email: dto.email?.toLowerCase() || null,
      birthdate: dto.birthdate || null,
      address: dto.address || null,
      notes: dto.notes || null,
      active: dto.active ?? true,
    };
  }
}

@Controller('api/suppliers')
@Perms('fornecedor.visualizar')
export class SuppliersController {
  constructor(@Inject(PRISMA) private db: Db, private audit: AuditService) {}

  @Get()
  async list(
    @CurrentUser() u: SessionUser,
    @Query('q') q = '',
    @Query('status') status = '',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { take, skip, ...rest } = paging(page, pageSize);
    const term = q.trim();
    const where = {
      companyId: u.companyId, deletedAt: null,
      ...(status === 'ativo' ? { active: true } : status === 'inativo' ? { active: false } : {}),
      ...(term ? {
        OR: [
          { name: { contains: term } }, { tradeName: { contains: term } },
          { document: { contains: term } }, { phone: { contains: term } },
        ],
      } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.supplier.findMany({ where, orderBy: { name: 'asc' }, take, skip }),
      this.db.supplier.count({ where }),
    ]);
    return { rows, total, ...rest };
  }

  @Get(':id')
  async detail(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const supplier = await this.db.supplier.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado.');

    const entries = await this.db.stockEntry.findMany({
      where: { companyId: u.companyId, supplierId: id },
      orderBy: { createdAtLocal: 'desc' }, take: 50,
      include: { _count: { select: { items: true } }, branch: { select: { name: true } } },
    });
    const payable = await this.db.financeEntry.aggregate({
      where: { companyId: u.companyId, supplierId: id, type: 'DESPESA', status: 'pending', deletedAt: null },
      _sum: { amountCents: true },
    });
    return {
      supplier,
      stats: {
        entriesCount: entries.length,
        totalCents: entries.reduce((s, e) => s + e.totalCents, 0),
        openPayableCents: payable._sum.amountCents ?? 0,
        lastEntryAt: entries[0]?.createdAtLocal ?? null,
      },
      entries: entries.map((e) => ({
        id: e.id, createdAtLocal: e.createdAtLocal, totalCents: e.totalCents,
        items: e._count.items, branch: e.branch.name, document: e.document,
      })),
    };
  }

  @Post() @Perms('fornecedor.gerenciar')
  async create(@CurrentUser() u: SessionUser, @Body() dto: SupplierDto, @Req() req: Request) {
    const supplier = await this.db.supplier.create({ data: { ...this.data(dto), companyId: u.companyId } });
    await this.audit.log(u, 'create', 'Supplier', supplier.id, { nome: supplier.name }, req.ip);
    return supplier;
  }

  @Patch(':id') @Perms('fornecedor.gerenciar')
  async update(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: SupplierDto, @Req() req: Request) {
    const before = await this.db.supplier.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!before) throw new NotFoundException('Fornecedor não encontrado.');
    const supplier = await this.db.supplier.update({ where: { id }, data: this.data(dto) });
    await this.audit.log(u, 'update', 'Supplier', id, AuditService.diff(before, supplier), req.ip);
    return supplier;
  }

  @Delete(':id') @Perms('fornecedor.gerenciar')
  async remove(@CurrentUser() u: SessionUser, @Param('id') id: string, @Req() req: Request) {
    const supplier = await this.db.supplier.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado.');
    await this.db.supplier.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    await this.audit.log(u, 'delete', 'Supplier', id, { nome: supplier.name }, req.ip);
    return { ok: true };
  }

  private data(dto: SupplierDto) {
    return {
      name: dto.name.trim(),
      tradeName: dto.tradeName || null,
      document: dto.document || null,
      phone: dto.phone || null,
      whatsapp: dto.whatsapp || dto.phone || null,
      email: dto.email?.toLowerCase() || null,
      address: dto.address || null,
      notes: dto.notes || null,
      active: dto.active ?? true,
    };
  }
}

@Module({ controllers: [CustomersController, SuppliersController] })
export class CrmModule {}
