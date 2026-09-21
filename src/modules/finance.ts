import {
  BadRequestException, Body, Controller, Delete, Get, Inject, Module, NotFoundException,
  Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { PRISMA, Db, TX } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService, BranchService, IdempotencyService, TimeService } from '../common/core';
import { DATE_RE, addMonths, paging, periodRange } from '../common/util';

const INSTRUMENTS = ['dinheiro', 'pix', 'boleto', 'cheque', 'transferencia', 'cartao', 'outro'];

class EntryDto {
  @IsIn(['RECEITA', 'DESPESA']) type!: string;
  @IsString() @MinLength(2) description!: string;
  @IsInt() @Min(1) amountCents!: number;
  @Matches(DATE_RE, { message: 'Vencimento inválido.' }) dueDate!: string;
  @IsOptional() @Matches(DATE_RE, { message: 'Data de pagamento inválida.' }) paidAt?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() paymentMethodId?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsIn(['none', 'weekly', 'monthly']) recurrence?: string;
  /** Repete o lançamento por N meses com o MESMO valor (contas fixas). */
  @IsOptional() @IsInt() @Min(1) repeat?: number;
  /** Parcela o VALOR TOTAL em N vezes (amountCents é o total). */
  @IsOptional() @IsInt() @Min(1) installments?: number;
  @IsOptional() @IsString() bankAccountId?: string;
  @IsOptional() @IsString() costCenterId?: string;
  @IsOptional() @IsIn(INSTRUMENTS) instrument?: string;
  @IsOptional() instrumentInfo?: Record<string, unknown>;
  @IsOptional() @IsString() idempotencyKey?: string;
}

class PayDto {
  @IsOptional() @Matches(DATE_RE) paidAt?: string;
  @IsOptional() @IsString() paymentMethodId?: string;
  /** Conta bancária/caixa por onde o dinheiro entrou/saiu (gera movimento). */
  @IsOptional() @IsString() bankAccountId?: string;
  @IsOptional() @IsIn(INSTRUMENTS) instrument?: string;
}

class CategoryDto {
  @IsString() @MinLength(2) name!: string;
  @IsIn(['RECEITA', 'DESPESA']) type!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class BankAccountDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsIn(['corrente', 'poupanca', 'caixa', 'carteira', 'aplicacao']) type?: string;
  @IsOptional() @IsString() bank?: string;
  @IsOptional() @IsString() agency?: string;
  @IsOptional() @IsString() account?: string;
  @IsOptional() @IsString() document?: string;
  @IsOptional() @IsInt() openingCents?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class CostCenterDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class BankTxDto {
  @Matches(DATE_RE, { message: 'Data inválida.' }) date!: string;
  @IsString() @MinLength(1) description!: string;
  /** Positivo = crédito (entrada); negativo = débito (saída). */
  @IsInt() amountCents!: number;
}

class ReconcileDto {
  @IsString() financeEntryId!: string;
}

@Controller('api/finance')
@Perms('financeiro.visualizar')
export class FinanceController {
  constructor(
    @Inject(PRISMA) private db: Db,
    private branches: BranchService,
    private audit: AuditService,
    private clock: TimeService,
    private idem: IdempotencyService,
  ) {}

  @Get('categories')
  async categories(@CurrentUser() u: SessionUser, @Query('type') type?: string) {
    return {
      rows: await this.db.financialCategory.findMany({
        where: { companyId: u.companyId, deletedAt: null, ...(type ? { type } : {}) },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      }),
    };
  }

  @Post('categories') @Perms('financeiro.gerenciar')
  async createCategory(@CurrentUser() u: SessionUser, @Body() dto: CategoryDto) {
    return this.db.financialCategory.create({
      data: { companyId: u.companyId, name: dto.name.trim(), type: dto.type },
    });
  }

  @Patch('categories/:id') @Perms('financeiro.gerenciar')
  async updateCategory(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: CategoryDto) {
    const found = await this.db.financialCategory.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!found) throw new NotFoundException('Categoria não encontrada.');
    return this.db.financialCategory.update({
      where: { id }, data: { name: dto.name.trim(), type: dto.type, active: dto.active ?? found.active },
    });
  }

  @Delete('categories/:id') @Perms('financeiro.gerenciar')
  async removeCategory(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const used = await this.db.financeEntry.count({ where: { companyId: u.companyId, categoryId: id, deletedAt: null } });
    if (used) throw new BadRequestException(`Esta categoria tem ${used} lançamento(s).`);
    await this.db.financialCategory.updateMany({
      where: { id, companyId: u.companyId }, data: { deletedAt: new Date(), active: false },
    });
    return { ok: true };
  }

  // ---------- lançamentos ----------
  @Get('entries')
  async entries(
    @CurrentUser() u: SessionUser,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('categoryId') categoryId?: string,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('by') by = 'due', // due | paid
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { take, skip, ...rest } = paging(page, pageSize);
    const field = by === 'paid' ? 'paidAt' : 'dueDate';
    const where: any = {
      companyId: u.companyId, deletedAt: null,
      ...this.branches.scope(u, branchId),
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(q?.trim() ? { description: { contains: q.trim() } } : {}),
      ...(from || to ? { [field]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const [rows, total, agg] = await Promise.all([
      this.db.financeEntry.findMany({
        where, orderBy: [{ [field]: 'desc' }, { createdAt: 'desc' }], take, skip,
        include: {
          category: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
          method: { select: { name: true } },
        },
      }),
      this.db.financeEntry.count({ where }),
      this.db.financeEntry.groupBy({ by: ['type', 'status'], where, _sum: { amountCents: true } }),
    ]);

    const sum = (t: string, s?: string) => agg
      .filter((a) => a.type === t && (!s || a.status === s))
      .reduce((acc, a) => acc + (a._sum.amountCents ?? 0), 0);

    const today = await this.clock.today(u.companyId);
    return {
      rows: rows.map((r) => ({ ...r, overdue: r.status === 'pending' && r.dueDate < today })),
      total, ...rest,
      summary: {
        receitaCents: sum('RECEITA', 'paid'),
        despesaCents: sum('DESPESA', 'paid'),
        saldoCents: sum('RECEITA', 'paid') - sum('DESPESA', 'paid'),
        aReceberCents: sum('RECEITA', 'pending'),
        aPagarCents: sum('DESPESA', 'pending'),
      },
    };
  }

  @Get('entries/:id')
  async entry(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const entry = await this.db.financeEntry.findFirst({
      where: { id, companyId: u.companyId },
      include: { category: true, supplier: true, customer: true, method: true },
    });
    if (!entry) throw new NotFoundException('Lançamento não encontrado.');
    return entry;
  }

  /** Fluxo de caixa do período: entradas, saídas e saldo por dia. */
  @Get('cashflow')
  async cashflow(
    @CurrentUser() u: SessionUser,
    @Query('period') period = 'mes',
    @Query('from') fromQ?: string,
    @Query('to') toQ?: string,
    @Query('branchId') branchId?: string,
  ) {
    const { from, to } = fromQ && toQ ? { from: fromQ, to: toQ } : periodRange(period);
    const rows = await this.db.financeEntry.findMany({
      where: {
        companyId: u.companyId, deletedAt: null, status: 'paid',
        ...this.branches.scope(u, branchId),
        paidAt: { gte: from, lte: to },
      },
      select: { paidAt: true, type: true, amountCents: true, categoryId: true },
    });

    const byDay = new Map<string, { date: string; inCents: number; outCents: number }>();
    for (const r of rows) {
      const day = r.paidAt!;
      const item = byDay.get(day) ?? { date: day, inCents: 0, outCents: 0 };
      if (r.type === 'RECEITA') item.inCents += r.amountCents;
      else item.outCents += r.amountCents;
      byDay.set(day, item);
    }
    const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));

    const categories = await this.db.financialCategory.findMany({ where: { companyId: u.companyId, deletedAt: null } });
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const byCategory = new Map<string, { name: string; type: string; totalCents: number }>();
    for (const r of rows) {
      const key = `${r.type}:${r.categoryId ?? 'sem'}`;
      const item = byCategory.get(key)
        ?? { name: catName.get(r.categoryId ?? '') ?? 'Sem categoria', type: r.type, totalCents: 0 };
      item.totalCents += r.amountCents;
      byCategory.set(key, item);
    }

    const inCents = days.reduce((s, d) => s + d.inCents, 0);
    const outCents = days.reduce((s, d) => s + d.outCents, 0);
    return {
      from, to, days,
      byCategory: [...byCategory.values()].sort((a, b) => b.totalCents - a.totalCents),
      totals: { inCents, outCents, balanceCents: inCents - outCents },
    };
  }

  @Post('entries') @Perms('financeiro.gerenciar')
  async create(@CurrentUser() u: SessionUser, @Body() dto: EntryDto, @Req() req: Request) {
    const branchId = dto.branchId ? await this.branches.require(u, dto.branchId) : null;
    // parcelamento (divide o total) tem prioridade sobre repeat (repete o valor fixo)
    const installments = Math.min(dto.installments ?? 0, 60);
    const parcelado = installments > 1;
    const n = parcelado ? installments : Math.min(dto.repeat ?? 1, 60);
    // divide o total em N; a sobra dos centavos vai na 1ª parcela
    const base = parcelado ? Math.floor(dto.amountCents / installments) : dto.amountCents;
    const resto = parcelado ? dto.amountCents - base * installments : 0;
    const grupo = n > 1 ? `grp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` : null;
    const info = dto.instrumentInfo ? JSON.stringify(dto.instrumentInfo) : null;

    const created = await this.idem.run(u.companyId, 'finance-entry', dto.idempotencyKey, () =>
      this.db.$transaction(async (tx) => {
        const rows: any[] = [];
        for (let i = 0; i < n; i++) {
          const valor = parcelado ? base + (i === 0 ? resto : 0) : dto.amountCents;
          rows.push(await tx.financeEntry.create({
            data: {
              companyId: u.companyId, branchId, type: dto.type,
              description: n > 1 ? `${dto.description.trim()} (${i + 1}/${n})` : dto.description.trim(),
              amountCents: valor,
              dueDate: addMonths(dto.dueDate, i),
              paidAt: i === 0 ? dto.paidAt ?? null : null,
              status: i === 0 && dto.paidAt ? 'paid' : 'pending',
              categoryId: dto.categoryId || null,
              paymentMethodId: dto.paymentMethodId || null,
              supplierId: dto.supplierId || null,
              customerId: dto.customerId || null,
              recurrence: dto.recurrence || null,
              notes: dto.notes || null,
              createdById: u.sub,
              bankAccountId: dto.bankAccountId || null,
              costCenterId: dto.costCenterId || null,
              instrument: dto.instrument || null,
              instrumentInfo: info,
              installmentGroup: grupo,
              installmentNo: n > 1 ? i + 1 : null,
              installmentOf: n > 1 ? n : null,
            },
          }));
        }
        // se a 1ª parcela já nasce paga com conta bancária, gera o movimento
        if (dto.paidAt && dto.bankAccountId) {
          await this.registrarMovimento(tx, u.companyId, rows[0], dto.bankAccountId, dto.paidAt);
        }
        return rows;
      }, TX));

    await this.audit.log(u, 'create', 'FinanceEntry', created[0].id,
      { tipo: dto.type, valor: dto.amountCents, vencimento: dto.dueDate, parcelas: n, parcelado }, req.ip);
    return { rows: created };
  }

  /** Gera a movimentação bancária de uma baixa (crédito p/ receita, débito p/ despesa). */
  private async registrarMovimento(tx: any, companyId: string, entry: any, bankAccountId: string, date: string) {
    const conta = await tx.bankAccount.findFirst({ where: { id: bankAccountId, companyId, deletedAt: null } });
    if (!conta) throw new BadRequestException('Conta bancária não encontrada.');
    const signed = entry.type === 'RECEITA' ? entry.amountCents : -entry.amountCents;
    await tx.bankTransaction.create({
      data: {
        companyId, bankAccountId, date, description: entry.description,
        amountCents: signed, reconciled: true, financeEntryId: entry.id, source: 'baixa',
      },
    });
    await tx.financeEntry.update({
      where: { id: entry.id }, data: { bankAccountId, reconciledAt: new Date() },
    });
  }

  @Patch('entries/:id') @Perms('financeiro.gerenciar')
  async update(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: EntryDto, @Req() req: Request) {
    const before = await this.db.financeEntry.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!before) throw new NotFoundException('Lançamento não encontrado.');
    if (before.saleId) throw new BadRequestException('Lançamento gerado por venda não pode ser editado.');

    const entry = await this.db.financeEntry.update({
      where: { id },
      data: {
        type: dto.type, description: dto.description.trim(), amountCents: dto.amountCents,
        dueDate: dto.dueDate, paidAt: dto.paidAt ?? null, status: dto.paidAt ? 'paid' : 'pending',
        categoryId: dto.categoryId || null, paymentMethodId: dto.paymentMethodId || null,
        supplierId: dto.supplierId || null, customerId: dto.customerId || null,
        notes: dto.notes || null,
      },
    });
    await this.audit.log(u, 'update', 'FinanceEntry', id, AuditService.diff(before, entry), req.ip);
    return entry;
  }

  /** Baixa: marca como pago/recebido na data informada (hoje por padrão). */
  @Post('entries/:id/pay') @Perms('financeiro.gerenciar')
  async pay(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: PayDto, @Req() req: Request) {
    const entry = await this.db.financeEntry.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!entry) throw new NotFoundException('Lançamento não encontrado.');
    if (entry.status === 'paid') return entry;

    const paidAt = dto.paidAt ?? await this.clock.today(u.companyId);
    const bankAccountId = dto.bankAccountId ?? entry.bankAccountId ?? null;
    const updated = await this.db.$transaction(async (tx) => {
      const e = await tx.financeEntry.update({
        where: { id },
        data: {
          status: 'paid', paidAt,
          paymentMethodId: dto.paymentMethodId ?? entry.paymentMethodId,
          instrument: dto.instrument ?? entry.instrument,
          bankAccountId,
          reconciledAt: bankAccountId ? new Date() : undefined,
        },
      });
      // baixa em conta bancária/caixa: registra o movimento (concilia automático)
      if (bankAccountId) await this.registrarMovimento(tx, u.companyId, e, bankAccountId, paidAt);
      return e;
    }, TX);
    await this.audit.log(u, 'update', 'FinanceEntry', id,
      { acao: entry.type === 'RECEITA' ? 'recebido' : 'pago', em: paidAt, valor: entry.amountCents, conta: bankAccountId }, req.ip);
    return updated;
  }

  @Post('entries/:id/reopen') @Perms('financeiro.gerenciar')
  async reopen(@CurrentUser() u: SessionUser, @Param('id') id: string, @Req() req: Request) {
    const entry = await this.db.financeEntry.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!entry) throw new NotFoundException('Lançamento não encontrado.');
    if (entry.saleId) throw new BadRequestException('Lançamento de venda não pode ser reaberto.');
    const updated = await this.db.financeEntry.update({ where: { id }, data: { status: 'pending', paidAt: null } });
    await this.audit.log(u, 'update', 'FinanceEntry', id, { acao: 'reaberto' }, req.ip);
    return updated;
  }

  @Delete('entries/:id') @Perms('financeiro.gerenciar')
  async remove(@CurrentUser() u: SessionUser, @Param('id') id: string, @Req() req: Request) {
    const entry = await this.db.financeEntry.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!entry) throw new NotFoundException('Lançamento não encontrado.');
    if (entry.saleId) throw new BadRequestException('Cancele a venda para remover este lançamento.');
    // histórico financeiro não some: fica cancelado
    await this.db.financeEntry.update({ where: { id }, data: { status: 'cancelled', deletedAt: new Date() } });
    await this.audit.log(u, 'delete', 'FinanceEntry', id, { descricao: entry.description }, req.ip);
    return { ok: true };
  }

  // ---------------- Contas bancárias ----------------
  private async saldos(companyId: string) {
    const grupos = await this.db.bankTransaction.groupBy({
      by: ['bankAccountId'], where: { companyId }, _sum: { amountCents: true },
    });
    return new Map(grupos.map((g) => [g.bankAccountId, g._sum.amountCents ?? 0]));
  }

  @Get('bank-accounts')
  async bankAccounts(@CurrentUser() u: SessionUser) {
    const [rows, mov] = await Promise.all([
      this.db.bankAccount.findMany({
        where: { companyId: u.companyId, deletedAt: null }, orderBy: [{ active: 'desc' }, { name: 'asc' }],
      }),
      this.saldos(u.companyId),
    ]);
    return {
      rows: rows.map((a) => ({ ...a, balanceCents: a.openingCents + (mov.get(a.id) ?? 0) })),
      totalCents: rows.filter((a) => a.active).reduce((s, a) => s + a.openingCents + (mov.get(a.id) ?? 0), 0),
    };
  }

  @Post('bank-accounts') @Perms('financeiro.gerenciar')
  async createBankAccount(@CurrentUser() u: SessionUser, @Body() dto: BankAccountDto, @Req() req: Request) {
    const acc = await this.db.bankAccount.create({
      data: {
        companyId: u.companyId, name: dto.name.trim(), type: dto.type || 'corrente',
        bank: dto.bank || null, agency: dto.agency || null, account: dto.account || null,
        document: dto.document || null, openingCents: dto.openingCents ?? 0, active: dto.active ?? true,
      },
    });
    await this.audit.log(u, 'create', 'BankAccount', acc.id, { nome: acc.name }, req.ip);
    return acc;
  }

  @Patch('bank-accounts/:id') @Perms('financeiro.gerenciar')
  async updateBankAccount(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: BankAccountDto) {
    const acc = await this.db.bankAccount.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!acc) throw new NotFoundException('Conta não encontrada.');
    return this.db.bankAccount.update({
      where: { id },
      data: {
        name: dto.name.trim(), type: dto.type || acc.type, bank: dto.bank ?? acc.bank,
        agency: dto.agency ?? acc.agency, account: dto.account ?? acc.account,
        document: dto.document ?? acc.document,
        openingCents: dto.openingCents ?? acc.openingCents, active: dto.active ?? acc.active,
      },
    });
  }

  @Delete('bank-accounts/:id') @Perms('financeiro.gerenciar')
  async removeBankAccount(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const acc = await this.db.bankAccount.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!acc) throw new NotFoundException('Conta não encontrada.');
    await this.db.bankAccount.update({ where: { id }, data: { active: false, deletedAt: new Date() } });
    return { ok: true };
  }

  @Get('bank-accounts/:id/transactions')
  async bankTransactions(
    @CurrentUser() u: SessionUser, @Param('id') id: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
  ) {
    const acc = await this.db.bankAccount.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!acc) throw new NotFoundException('Conta não encontrada.');
    const { take, skip, ...rest } = paging(page, pageSize);
    const where = { companyId: u.companyId, bankAccountId: id };
    const [rows, total, agg] = await Promise.all([
      this.db.bankTransaction.findMany({
        where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take, skip,
        include: { financeEntry: { select: { id: true, description: true } } },
      }),
      this.db.bankTransaction.count({ where }),
      this.db.bankTransaction.aggregate({ where, _sum: { amountCents: true } }),
    ]);
    return { rows, total, ...rest, balanceCents: acc.openingCents + (agg._sum.amountCents ?? 0) };
  }

  @Post('bank-accounts/:id/transactions') @Perms('financeiro.gerenciar')
  async addBankTransaction(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: BankTxDto) {
    const acc = await this.db.bankAccount.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!acc) throw new NotFoundException('Conta não encontrada.');
    return this.db.bankTransaction.create({
      data: {
        companyId: u.companyId, bankAccountId: id, date: dto.date,
        description: dto.description.trim(), amountCents: dto.amountCents, source: 'manual',
      },
    });
  }

  /** Concilia uma linha do extrato com uma conta a pagar/receber. */
  @Post('bank-transactions/:id/reconcile') @Perms('financeiro.gerenciar')
  async reconcile(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: ReconcileDto) {
    const tx = await this.db.bankTransaction.findFirst({ where: { id, companyId: u.companyId } });
    if (!tx) throw new NotFoundException('Movimento não encontrado.');
    const entry = await this.db.financeEntry.findFirst({ where: { id: dto.financeEntryId, companyId: u.companyId, deletedAt: null } });
    if (!entry) throw new NotFoundException('Lançamento não encontrado.');
    await this.db.$transaction([
      this.db.bankTransaction.update({ where: { id }, data: { reconciled: true, financeEntryId: entry.id } }),
      this.db.financeEntry.update({
        where: { id: entry.id },
        data: { reconciledAt: new Date(), bankAccountId: tx.bankAccountId, ...(entry.status !== 'paid' ? { status: 'paid', paidAt: tx.date } : {}) },
      }),
    ]);
    return { ok: true };
  }

  @Post('bank-transactions/:id/unreconcile') @Perms('financeiro.gerenciar')
  async unreconcile(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const tx = await this.db.bankTransaction.findFirst({ where: { id, companyId: u.companyId } });
    if (!tx) throw new NotFoundException('Movimento não encontrado.');
    await this.db.bankTransaction.update({ where: { id }, data: { reconciled: false, financeEntryId: null } });
    if (tx.financeEntryId) await this.db.financeEntry.update({ where: { id: tx.financeEntryId }, data: { reconciledAt: null } });
    return { ok: true };
  }

  @Delete('bank-transactions/:id') @Perms('financeiro.gerenciar')
  async removeBankTransaction(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const tx = await this.db.bankTransaction.findFirst({ where: { id, companyId: u.companyId } });
    if (!tx) throw new NotFoundException('Movimento não encontrado.');
    if (tx.source === 'baixa') throw new BadRequestException('Movimento de baixa: reabra o lançamento para removê-lo.');
    await this.db.bankTransaction.delete({ where: { id } });
    return { ok: true };
  }

  // ---------------- Centros de custo ----------------
  @Get('cost-centers')
  async costCenters(@CurrentUser() u: SessionUser) {
    return { rows: await this.db.costCenter.findMany({ where: { companyId: u.companyId, deletedAt: null }, orderBy: { name: 'asc' } }) };
  }

  @Post('cost-centers') @Perms('financeiro.gerenciar')
  async createCostCenter(@CurrentUser() u: SessionUser, @Body() dto: CostCenterDto) {
    return this.db.costCenter.create({ data: { companyId: u.companyId, name: dto.name.trim(), active: dto.active ?? true } });
  }

  @Patch('cost-centers/:id') @Perms('financeiro.gerenciar')
  async updateCostCenter(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: CostCenterDto) {
    const cc = await this.db.costCenter.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!cc) throw new NotFoundException('Centro de custo não encontrado.');
    return this.db.costCenter.update({ where: { id }, data: { name: dto.name.trim(), active: dto.active ?? cc.active } });
  }

  @Delete('cost-centers/:id') @Perms('financeiro.gerenciar')
  async removeCostCenter(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const cc = await this.db.costCenter.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!cc) throw new NotFoundException('Centro de custo não encontrado.');
    await this.db.costCenter.update({ where: { id }, data: { active: false, deletedAt: new Date() } });
    return { ok: true };
  }

  // ---------------- DRE gerencial ----------------
  @Get('dre')
  async dre(
    @CurrentUser() u: SessionUser, @Query('period') period = 'mes',
    @Query('from') fromQ?: string, @Query('to') toQ?: string,
    @Query('regime') regime = 'caixa', // caixa (por pagamento) | competencia (por vencimento)
  ) {
    const { from, to } = fromQ && toQ ? { from: fromQ, to: toQ } : periodRange(period);
    const dateField = regime === 'competencia' ? 'dueDate' : 'paidAt';
    const rows = await this.db.financeEntry.findMany({
      where: {
        companyId: u.companyId, deletedAt: null,
        ...(regime === 'competencia' ? {} : { status: 'paid' }),
        [dateField]: { gte: from, lte: to },
      },
      select: { type: true, amountCents: true, categoryId: true, costCenterId: true },
    });
    const [cats, ccs] = await Promise.all([
      this.db.financialCategory.findMany({ where: { companyId: u.companyId } }),
      this.db.costCenter.findMany({ where: { companyId: u.companyId } }),
    ]);
    const catName = new Map(cats.map((c) => [c.id, c.name]));
    const ccName = new Map(ccs.map((c) => [c.id, c.name]));

    const grupo = (getKey: (r: typeof rows[number]) => string, getName: (r: typeof rows[number]) => string) => {
      const rec = new Map<string, { name: string; totalCents: number }>();
      const desp = new Map<string, { name: string; totalCents: number }>();
      for (const r of rows) {
        const alvo = r.type === 'RECEITA' ? rec : desp;
        const k = getKey(r);
        const it = alvo.get(k) ?? { name: getName(r), totalCents: 0 };
        it.totalCents += r.amountCents;
        alvo.set(k, it);
      }
      return {
        receitas: [...rec.values()].sort((a, b) => b.totalCents - a.totalCents),
        despesas: [...desp.values()].sort((a, b) => b.totalCents - a.totalCents),
      };
    };

    const receitasCents = rows.filter((r) => r.type === 'RECEITA').reduce((s, r) => s + r.amountCents, 0);
    const despesasCents = rows.filter((r) => r.type === 'DESPESA').reduce((s, r) => s + r.amountCents, 0);
    return {
      from, to, regime,
      porCategoria: grupo((r) => r.categoryId ?? 'sem', (r) => catName.get(r.categoryId ?? '') ?? 'Sem categoria'),
      porCentroDeCusto: grupo((r) => r.costCenterId ?? 'sem', (r) => ccName.get(r.costCenterId ?? '') ?? 'Sem centro de custo'),
      totals: { receitasCents, despesasCents, resultadoCents: receitasCents - despesasCents },
    };
  }

  // ---------------- Fluxo de caixa projetado ----------------
  @Get('projection')
  async projection(@CurrentUser() u: SessionUser, @Query('days') daysQ = '90') {
    const days = Math.min(Math.max(Number(daysQ) || 90, 1), 365);
    const hoje = await this.clock.today(u.companyId);
    const ate = addMonths(hoje, 0); // base
    const limite = new Date(hoje); limite.setDate(limite.getDate() + days);
    const to = limite.toISOString().slice(0, 10);

    // saldo atual = soma dos saldos das contas
    const [contas, mov, pendentes] = await Promise.all([
      this.db.bankAccount.findMany({ where: { companyId: u.companyId, deletedAt: null, active: true } }),
      this.saldos(u.companyId),
      this.db.financeEntry.findMany({
        where: { companyId: u.companyId, deletedAt: null, status: 'pending', dueDate: { gte: ate, lte: to } },
        select: { dueDate: true, type: true, amountCents: true },
      }),
    ]);
    const saldoAtualCents = contas.reduce((s, a) => s + a.openingCents + (mov.get(a.id) ?? 0), 0);

    const porDia = new Map<string, { date: string; inCents: number; outCents: number }>();
    for (const p of pendentes) {
      const it = porDia.get(p.dueDate) ?? { date: p.dueDate, inCents: 0, outCents: 0 };
      if (p.type === 'RECEITA') it.inCents += p.amountCents; else it.outCents += p.amountCents;
      porDia.set(p.dueDate, it);
    }
    let saldo = saldoAtualCents;
    const dias = [...porDia.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => {
      saldo += d.inCents - d.outCents;
      return { ...d, saldoProjetadoCents: saldo };
    });
    const aReceberCents = pendentes.filter((p) => p.type === 'RECEITA').reduce((s, p) => s + p.amountCents, 0);
    const aPagarCents = pendentes.filter((p) => p.type === 'DESPESA').reduce((s, p) => s + p.amountCents, 0);
    return {
      from: hoje, to, saldoAtualCents,
      aReceberCents, aPagarCents,
      saldoProjetadoCents: saldoAtualCents + aReceberCents - aPagarCents,
      dias,
    };
  }
}

@Module({ controllers: [FinanceController] })
export class FinanceModule {}
