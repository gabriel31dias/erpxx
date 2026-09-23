import {
  BadRequestException, Body, Controller, Get, Inject, Injectable, Module, NotFoundException, Param, Patch, Req,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import type { Request } from 'express';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService, PlanService, SettingsService, TimeService } from '../common/core';
import { addDays, fmtBRL } from '../common/util';

export const CREDIT_STATUS = ['LIBERADO', 'BLOQUEADO'];

/** Contas a receber em aberto do cliente: é o que ocupa o limite (crediário, boleto, venda do app não paga). */
const OPEN = { type: 'RECEITA', status: 'pending', deletedAt: null } as const;

export interface CreditStatus {
  customerId: string;
  limitCents: number | null; // null = sem crediário aprovado
  usedCents: number;
  availableCents: number;
  status: string;
  blockReason: string | null;
  overdue: { count: number; amountCents: number; oldestDueDate: string | null; days: number };
}

/**
 * Crédito do cliente (crediário). Limite, exposição (tudo que ele deve e não
 * pagou) e atraso — a mesma checagem vale para o PDV, o ERP e o app do vendedor.
 */
@Injectable()
export class CreditService {
  constructor(
    @Inject(PRISMA) private db: Db,
    private plans: PlanService,
    private settings: SettingsService,
    private clock: TimeService,
  ) {}

  /** O plano da loja inclui crediário? */
  enabled(companyId: string) {
    return this.plans.hasFeature(companyId, 'crediario');
  }

  /** Situação de crédito de vários clientes de uma vez (lista do app). */
  async statusOf(companyId: string, customerIds: string[]): Promise<Map<string, CreditStatus>> {
    const ids = [...new Set(customerIds)];
    if (!ids.length) return new Map();
    const [customers, open, overdueRows] = await Promise.all([
      this.db.customer.findMany({
        where: { companyId, id: { in: ids } },
        select: { id: true, creditLimitCents: true, creditStatus: true, creditBlockReason: true },
      }),
      this.db.financeEntry.groupBy({
        by: ['customerId'], where: { companyId, ...OPEN, customerId: { in: ids } }, _sum: { amountCents: true },
      }),
      this.overdue(companyId, ids),
    ]);
    const used = new Map(open.map((o) => [o.customerId!, o._sum.amountCents ?? 0]));
    return new Map(customers.map((c) => {
      const usedCents = used.get(c.id) ?? 0;
      return [c.id, {
        customerId: c.id,
        limitCents: c.creditLimitCents,
        usedCents,
        availableCents: Math.max(0, (c.creditLimitCents ?? 0) - usedCents),
        status: c.creditStatus,
        blockReason: c.creditBlockReason,
        overdue: overdueRows.get(c.id) ?? { count: 0, amountCents: 0, oldestDueDate: null, days: 0 },
      }];
    }));
  }

  async status(companyId: string, customerId: string) {
    const s = (await this.statusOf(companyId, [customerId])).get(customerId);
    if (!s) throw new NotFoundException('Cliente não encontrado.');
    return s;
  }

  /** Parcelas vencidas além da tolerância, por cliente. */
  private async overdue(companyId: string, ids: string[]) {
    const [today, settings] = await Promise.all([this.clock.today(companyId), this.settings.of(companyId)]);
    const limit = addDays(today, -settings.crediarioGraceDays); // vencida antes deste dia = em atraso
    const rows = await this.db.financeEntry.findMany({
      where: { companyId, ...OPEN, customerId: { in: ids }, dueDate: { lt: limit } },
      select: { customerId: true, amountCents: true, dueDate: true },
    });
    const out = new Map<string, CreditStatus['overdue']>();
    for (const r of rows) {
      const o = out.get(r.customerId!) ?? { count: 0, amountCents: 0, oldestDueDate: null, days: 0 };
      o.count++;
      o.amountCents += r.amountCents;
      if (!o.oldestDueDate || r.dueDate < o.oldestDueDate) o.oldestDueDate = r.dueDate;
      out.set(r.customerId!, o);
    }
    for (const o of out.values()) {
      o.days = Math.round((Date.parse(today) - Date.parse(o.oldestDueDate!)) / 86_400_000);
    }
    return out;
  }

  /**
   * Pode vender `amountCents` no crediário para o cliente? Devolve os motivos que
   * impedem (vazio = pode). Quem tem `credito.liberar` passa por cima dos motivos;
   * plano sem crediário, venda sem cliente ou offline são erro direto, sem liberação.
   */
  async check(companyId: string, customerId: string | undefined, amountCents: number, opts: { offline?: boolean } = {}) {
    if (!(await this.enabled(companyId))) {
      throw new BadRequestException('O crediário não está incluído no plano da loja.');
    }
    if (!customerId) throw new BadRequestException('Venda no crediário exige identificar o cliente.');
    if (opts.offline) {
      throw new BadRequestException('Venda no crediário precisa de conexão: o limite do cliente é conferido na hora.');
    }
    const s = await this.status(companyId, customerId);
    const reasons: string[] = [];
    if (s.limitCents === null) reasons.push('Cliente sem crediário aprovado.');
    if (s.status === 'BLOQUEADO') reasons.push(`Crediário bloqueado${s.blockReason ? `: ${s.blockReason}` : ''}.`);
    if (s.overdue.count) {
      reasons.push(`${s.overdue.count} parcela(s) em atraso (${fmtBRL(s.overdue.amountCents)}, há ${s.overdue.days} dia(s)).`);
    }
    if (s.limitCents !== null && s.availableCents <= 0) {
      reasons.push(`Limite de crédito esgotado (${fmtBRL(s.usedCents)} em aberto para ${fmtBRL(s.limitCents)} de limite).`);
    } else if (s.limitCents !== null && amountCents > s.availableCents) {
      reasons.push(`Limite disponível ${fmtBRL(s.availableCents)} para ${fmtBRL(amountCents)} no crediário.`);
    }
    return { status: s, reasons };
  }

  /** Parcelas em aberto do cliente, vencimento mais próximo primeiro. */
  openInstallments(companyId: string, customerId: string) {
    return this.db.financeEntry.findMany({
      where: { companyId, ...OPEN, customerId },
      orderBy: [{ dueDate: 'asc' }, { installmentNo: 'asc' }],
      select: {
        id: true, description: true, amountCents: true, dueDate: true, instrument: true,
        installmentNo: true, installmentOf: true, saleId: true, sale: { select: { number: true } },
      },
    });
  }
}

/**
 * Divide o valor em parcelas iguais; os centavos que sobram vão na primeira.
 * Vencimentos a cada `intervalDays` a partir da data da venda.
 */
export function installmentPlan(amountCents: number, count: number, saleDate: string, intervalDays: number) {
  const base = Math.floor(amountCents / count);
  return Array.from({ length: count }, (_, i) => ({
    no: i + 1,
    amountCents: base + (i === 0 ? amountCents - base * count : 0),
    dueDate: addDays(saleDate, intervalDays * (i + 1)),
  }));
}

class CreditDto {
  /** null tira o crediário do cliente. */
  @IsOptional() @IsInt() @Min(0) creditLimitCents?: number | null;
  @IsOptional() @IsIn(CREDIT_STATUS) creditStatus?: string;
  @IsOptional() @IsString() creditBlockReason?: string;
}

@Controller('api/customers/:id/credit')
@Perms('cliente.visualizar')
export class CreditController {
  constructor(@Inject(PRISMA) private db: Db, private credit: CreditService, private audit: AuditService) {}

  /** Limite, usado, disponível, atraso e parcelas em aberto (ficha do cliente e PDV). */
  @Get()
  async get(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const status = await this.credit.status(u.companyId, id);
    return { ...status, installments: await this.credit.openInstallments(u.companyId, id) };
  }

  @Patch() @Perms('credito.gerenciar')
  async update(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: CreditDto, @Req() req: Request) {
    const before = await this.db.customer.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!before) throw new NotFoundException('Cliente não encontrado.');
    const blocking = dto.creditStatus === 'BLOQUEADO';
    const data = {
      ...(dto.creditLimitCents !== undefined ? { creditLimitCents: dto.creditLimitCents } : {}),
      ...(dto.creditStatus ? {
        creditStatus: dto.creditStatus,
        creditBlockReason: blocking ? dto.creditBlockReason?.trim() || null : null,
      } : {}),
    };
    const after = await this.db.customer.update({ where: { id }, data });
    await this.audit.log(u, 'credit', 'Customer', id, AuditService.diff(
      { limite: before.creditLimitCents, situacao: before.creditStatus, motivo: before.creditBlockReason },
      { limite: after.creditLimitCents, situacao: after.creditStatus, motivo: after.creditBlockReason },
    ), req.ip);
    return this.get(u, id);
  }
}

@Module({
  controllers: [CreditController],
  providers: [CreditService],
  exports: [CreditService],
})
export class CreditModule {}
