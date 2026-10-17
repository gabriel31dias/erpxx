import { Body, Controller, Get, Inject, Module, NotFoundException, Param, Patch, Query, Req } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService, BranchService, TimeService } from '../common/core';

/** Sem venda há mais que isso, a maquininha deixa de contar como "em uso". */
const ONLINE_MS = 30 * 60_000;
/** Vendeu nos últimos dias: segue "ativa". Depois disso, "parada". */
const ACTIVE_DAYS = 7;

class TerminalDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

/**
 * Maquininhas (POS) integradas. Não há cadastro manual: cada uma aparece sozinha
 * na primeira venda que chega em POST /api/sales com o `terminalId` do aparelho.
 */
@Controller('api/terminals')
@Perms('venda.visualizar')
export class TerminalsController {
  constructor(
    @Inject(PRISMA) private db: Db,
    private branches: BranchService,
    private audit: AuditService,
    private clock: TimeService,
  ) {}

  @Get()
  async list(@CurrentUser() u: SessionUser, @Query('branchId') branchId?: string) {
    const now = await this.clock.now(u.companyId);
    const today = now.slice(0, 10);
    const since = new Date(Date.now() - ACTIVE_DAYS * 86_400_000);
    const sinceLocal = await this.clock.now(u.companyId, since);

    const terminals = await this.db.terminal.findMany({
      where: { companyId: u.companyId, ...this.branches.scope(u, branchId) },
      include: { branch: { select: { id: true, name: true } } },
      orderBy: { lastSeenAt: 'desc' },
    });
    const ids = terminals.map((t) => t.id);
    const done = { companyId: u.companyId, status: 'COMPLETED', terminalId: { in: ids } };
    const [day, week, operators] = await Promise.all([
      this.db.sale.groupBy({
        by: ['terminalId'], where: { ...done, soldAt: { gte: `${today} 00:00` } },
        _count: true, _sum: { totalCents: true },
      }),
      this.db.sale.groupBy({
        by: ['terminalId'], where: { ...done, soldAt: { gte: sinceLocal } },
        _count: true, _sum: { totalCents: true },
      }),
      this.db.user.findMany({
        where: { companyId: u.companyId, id: { in: terminals.map((t) => t.lastOperatorId).filter(Boolean) as string[] } },
        select: { id: true, name: true },
      }),
    ]);
    const dayBy = new Map(day.map((r) => [r.terminalId, r]));
    const weekBy = new Map(week.map((r) => [r.terminalId, r]));
    const opBy = new Map(operators.map((o) => [o.id, o.name]));

    const rows = terminals.map((t) => {
      const idle = Date.now() - t.lastSeenAt.getTime();
      const status = !t.active ? 'disabled'
        : idle <= ONLINE_MS ? 'online'
          : t.lastSeenAt >= since ? 'active' : 'idle';
      return {
        id: t.id, serial: t.serial, name: t.name, model: t.model, active: t.active, status,
        branch: t.branch, firstSeenAt: t.firstSeenAt, lastSeenAt: t.lastSeenAt, lastSaleAt: t.lastSaleAt,
        lastOperator: t.lastOperatorId ? opBy.get(t.lastOperatorId) ?? null : null,
        todayCount: dayBy.get(t.id)?._count ?? 0,
        todayCents: dayBy.get(t.id)?._sum.totalCents ?? 0,
        weekCount: weekBy.get(t.id)?._count ?? 0,
        weekCents: weekBy.get(t.id)?._sum.totalCents ?? 0,
      };
    });
    return {
      rows,
      summary: {
        total: rows.length,
        active: rows.filter((r) => r.status === 'online' || r.status === 'active').length,
        online: rows.filter((r) => r.status === 'online').length,
        todayCount: rows.reduce((s, r) => s + r.todayCount, 0),
        todayCents: rows.reduce((s, r) => s + r.todayCents, 0),
      },
    };
  }

  /** Apelido e desativação. A maquininha que voltar a vender reativa sozinha. */
  @Patch(':id') @Perms('empresa.gerenciar')
  async update(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: TerminalDto, @Req() req: Request) {
    const before = await this.db.terminal.findFirst({ where: { id, companyId: u.companyId } });
    if (!before) throw new NotFoundException('Maquininha não encontrada.');
    const after = await this.db.terminal.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    await this.audit.log(u, 'update', 'Terminal', id, AuditService.diff(before, after), req.ip);
    return after;
  }
}

@Module({ controllers: [TerminalsController] })
export class TerminalsModule {}
