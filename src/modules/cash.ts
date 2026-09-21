import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Module,
  NotFoundException, Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService, BranchService, PlanService, SettingsService, TimeService } from '../common/core';
import { fmtBRL, paging } from '../common/util';

class RegisterDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class OpenDto {
  @IsString() registerId!: string;
  @IsOptional() @IsString() branchId?: string;
  @IsInt() @Min(0) openingCents!: number;
  @IsOptional() @IsString() notes?: string;
}

class CloseDto {
  @IsInt() @Min(0) countedCents!: number;
  @IsOptional() @IsString() notes?: string;
  /** Contagem por forma de pagamento: { paymentMethodId: centavos } */
  @IsOptional() counted?: Record<string, number>;
}

class MovementDto {
  @IsInt() @Min(1) amountCents!: number;
  @IsString() @MinLength(3) reason!: string;
}

@Controller('api/cash')
@Perms('caixa.visualizar')
export class CashController {
  constructor(
    @Inject(PRISMA) private db: Db,
    private branches: BranchService,
    private audit: AuditService,
    private settings: SettingsService,
    private plans: PlanService,
    private clock: TimeService,
  ) {}

  // ---------- PDVs ----------
  @Get('registers')
  async registers(@CurrentUser() u: SessionUser, @Query('branchId') branchId?: string) {
    const rows = await this.db.cashRegister.findMany({
      where: { companyId: u.companyId, deletedAt: null, ...this.branches.scope(u, branchId) },
      orderBy: { name: 'asc' },
      include: {
        branch: { select: { id: true, name: true } },
        sessions: { where: { status: 'open' }, take: 1, include: { operator: { select: { name: true } } } },
      },
    });
    return {
      rows: rows.map((r) => ({
        id: r.id, name: r.name, active: r.active, branchId: r.branchId, branch: r.branch.name,
        openSession: r.sessions[0]
          ? { id: r.sessions[0].id, openedAt: r.sessions[0].openedAt, operator: r.sessions[0].operator?.name }
          : null,
      })),
    };
  }

  @Post('registers') @Perms('empresa.gerenciar')
  async createRegister(@CurrentUser() u: SessionUser, @Body() dto: RegisterDto, @Req() req: Request) {
    await this.plans.assertLimit(u.companyId, 'registers');
    const branchId = await this.branches.require(u, dto.branchId);
    const register = await this.db.cashRegister.create({
      data: { companyId: u.companyId, branchId, name: dto.name.trim() },
    });
    await this.audit.log(u, 'create', 'CashRegister', register.id, { nome: register.name }, req.ip);
    return register;
  }

  @Patch('registers/:id') @Perms('empresa.gerenciar')
  async updateRegister(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: RegisterDto) {
    const found = await this.db.cashRegister.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!found) throw new NotFoundException('PDV não encontrado.');
    return this.db.cashRegister.update({
      where: { id },
      data: { name: dto.name.trim(), active: dto.active ?? found.active },
    });
  }

  // ---------- sessões ----------
  @Get('sessions')
  async sessions(
    @CurrentUser() u: SessionUser,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('operatorId') operatorId?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { take, skip, ...rest } = paging(page, pageSize);
    const where: any = {
      companyId: u.companyId,
      ...this.branches.scope(u, branchId),
      ...(status ? { status } : {}),
      ...(operatorId ? { operatorId } : {}),
      ...(from || to ? { openedAt: { ...(from ? { gte: `${from} 00:00` } : {}), ...(to ? { lte: `${to} 23:59` } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.cashSession.findMany({
        where, orderBy: { openedAt: 'desc' }, take, skip,
        include: {
          register: { select: { name: true } }, operator: { select: { name: true } },
          branch: { select: { name: true } }, _count: { select: { sales: true } },
        },
      }),
      this.db.cashSession.count({ where }),
    ]);
    return {
      rows: rows.map((s) => ({ ...s, sales: s._count.sales, _count: undefined })),
      total, ...rest,
    };
  }

  /** Sessão aberta do operador — o PDV chama isto ao abrir a tela. */
  @Get('current')
  async current(@CurrentUser() u: SessionUser, @Query('branchId') branchId?: string) {
    const scope = this.branches.scope(u, branchId);
    const session = await this.db.cashSession.findFirst({
      where: { companyId: u.companyId, status: 'open', ...scope, operatorId: u.sub },
      orderBy: { openedAt: 'desc' },
      include: { register: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } } },
    });
    if (session) return { session, summary: await this.summary(u.companyId, session.id) };

    const other = await this.db.cashSession.findFirst({
      where: { companyId: u.companyId, status: 'open', ...scope },
      orderBy: { openedAt: 'desc' },
      include: {
        register: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } },
        operator: { select: { name: true } },
      },
    });
    return { session: null, otherOpen: other, summary: null };
  }

  @Get('sessions/:id')
  async session(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const session = await this.db.cashSession.findFirst({
      where: { id, companyId: u.companyId },
      include: {
        register: { select: { name: true } }, operator: { select: { name: true } },
        branch: { select: { name: true } },
        movements: { orderBy: { createdAtLocal: 'desc' }, include: { user: { select: { name: true } }, method: { select: { name: true } } } },
      },
    });
    if (!session) throw new NotFoundException('Sessão de caixa não encontrada.');
    return {
      session: { ...session, closingData: JSON.parse(session.closingData || '{}') },
      summary: await this.summary(u.companyId, id),
    };
  }

  @Post('open') @Perms('caixa.abrir')
  async open(@CurrentUser() u: SessionUser, @Body() dto: OpenDto, @Req() req: Request) {
    await this.plans.assertActive(u.companyId);
    const branchId = await this.branches.require(u, dto.branchId);
    const register = await this.db.cashRegister.findFirst({
      where: { id: dto.registerId, companyId: u.companyId, branchId, deletedAt: null, active: true },
    });
    if (!register) throw new NotFoundException('PDV não encontrado.');

    const busy = await this.db.cashSession.findFirst({
      where: { companyId: u.companyId, registerId: register.id, status: 'open' },
      include: { operator: { select: { name: true } } },
    });
    if (busy) throw new BadRequestException(`Este PDV já está aberto por ${busy.operator?.name ?? 'outro operador'}.`);

    const at = await this.clock.now(u.companyId);
    const session = await this.db.cashSession.create({
      data: {
        companyId: u.companyId, branchId, registerId: register.id, operatorId: u.sub,
        openingCents: dto.openingCents, openedAt: at, notes: dto.notes || null,
        movements: dto.openingCents > 0 ? {
          create: {
            companyId: u.companyId, type: 'abertura', amountCents: dto.openingCents,
            description: 'Valor inicial (fundo de troco)', userId: u.sub, createdAtLocal: at,
          },
        } : undefined,
      },
      include: { register: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } } },
    });
    await this.audit.log(u, 'create', 'CashSession', session.id,
      { pdv: register.name, abertura: dto.openingCents }, req.ip);
    return session;
  }

  @Post('sessions/:id/sangria') @Perms('caixa.sangria')
  async sangria(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: MovementDto, @Req() req: Request) {
    const session = await this.openSession(u, id);
    const settings = await this.settings.of(u.companyId);
    // acima do teto, só gerente/admin/proprietário (briefing 21)
    if (dto.amountCents > settings.sangriaApprovalCents && !['proprietario', 'admin', 'gerente'].includes(u.role)) {
      throw new ForbiddenException(
        `Sangria acima de ${fmtBRL(settings.sangriaApprovalCents)} precisa de autorização de um gerente.`);
    }
    const available = (await this.summary(u.companyId, session.id)).cashOnHandCents;
    if (dto.amountCents > available) {
      throw new BadRequestException(`Só há ${fmtBRL(available)} em dinheiro no caixa.`);
    }

    const at = await this.clock.now(u.companyId);
    const movement = await this.db.cashMovement.create({
      data: {
        companyId: u.companyId, sessionId: session.id, type: 'sangria',
        amountCents: -dto.amountCents, description: dto.reason, userId: u.sub, createdAtLocal: at,
      },
    });
    await this.audit.log(u, 'sangria', 'CashSession', session.id,
      { valor: dto.amountCents, motivo: dto.reason }, req.ip);
    return movement;
  }

  @Post('sessions/:id/suprimento') @Perms('caixa.suprimento')
  async suprimento(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: MovementDto, @Req() req: Request) {
    const session = await this.openSession(u, id);
    const at = await this.clock.now(u.companyId);
    const movement = await this.db.cashMovement.create({
      data: {
        companyId: u.companyId, sessionId: session.id, type: 'suprimento',
        amountCents: dto.amountCents, description: dto.reason, userId: u.sub, createdAtLocal: at,
      },
    });
    await this.audit.log(u, 'suprimento', 'CashSession', session.id,
      { valor: dto.amountCents, motivo: dto.reason }, req.ip);
    return movement;
  }

  /** Fechamento: guarda esperado × contado por forma de pagamento, com a diferença. */
  @Post('sessions/:id/close') @Perms('caixa.fechar')
  async close(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: CloseDto, @Req() req: Request) {
    const session = await this.openSession(u, id);
    const summary = await this.summary(u.companyId, id);
    const at = await this.clock.now(u.companyId);

    const byMethod = summary.byMethod.map((m) => {
      const counted = m.isCash ? dto.countedCents : dto.counted?.[m.paymentMethodId] ?? m.expectedCents;
      return { ...m, countedCents: counted, differenceCents: counted - m.expectedCents };
    });

    const closed = await this.db.cashSession.update({
      where: { id },
      data: {
        status: 'closed', closedAt: at,
        expectedCents: summary.cashOnHandCents,
        countedCents: dto.countedCents,
        differenceCents: dto.countedCents - summary.cashOnHandCents,
        closingData: JSON.stringify({ byMethod, totals: summary.totals }),
        notes: dto.notes || session.notes,
      },
      include: { register: { select: { name: true } }, operator: { select: { name: true } } },
    });

    await this.audit.log(u, 'close', 'CashSession', id, {
      esperado: summary.cashOnHandCents, contado: dto.countedCents,
      diferenca: dto.countedCents - summary.cashOnHandCents,
    }, req.ip);
    return { ...closed, closingData: JSON.parse(closed.closingData), summary };
  }

  /**
   * Esperado por forma de pagamento. Dinheiro soma abertura, vendas em dinheiro,
   * suprimentos e estornos e desconta as sangrias; as demais formas só somam vendas.
   */
  async summary(companyId: string, sessionId: string) {
    const [session, movements, methods, sales] = await Promise.all([
      this.db.cashSession.findFirst({ where: { id: sessionId, companyId } }),
      this.db.cashMovement.findMany({ where: { companyId, sessionId }, include: { method: true } }),
      this.db.paymentMethod.findMany({ where: { companyId, deletedAt: null } }),
      this.db.sale.aggregate({
        where: { companyId, cashSessionId: sessionId, status: 'COMPLETED' },
        _sum: { totalCents: true }, _count: true,
      }),
    ]);
    if (!session) throw new NotFoundException('Sessão de caixa não encontrada.');

    const cashMethods = new Set(methods.filter((m) => m.requiresChange).map((m) => m.id));
    const byMethodMap = new Map<string, { paymentMethodId: string; name: string; isCash: boolean; expectedCents: number }>();
    for (const m of methods) {
      byMethodMap.set(m.id, {
        paymentMethodId: m.id, name: m.name, isCash: m.requiresChange,
        expectedCents: m.requiresChange ? session.openingCents : 0,
      });
    }

    let sangrias = 0;
    let suprimentos = 0;
    let estornos = 0;
    let vendas = 0;
    for (const mv of movements) {
      if (mv.type === 'abertura') continue; // já entra pelo openingCents
      if (mv.type === 'sangria') sangrias += -mv.amountCents;
      if (mv.type === 'suprimento') suprimentos += mv.amountCents;
      if (mv.type === 'estorno') estornos += -mv.amountCents;
      if (mv.type === 'venda' && mv.paymentMethodId && cashMethods.has(mv.paymentMethodId)) vendas += mv.amountCents;

      if (mv.paymentMethodId && byMethodMap.has(mv.paymentMethodId)) {
        const entry = byMethodMap.get(mv.paymentMethodId)!;
        entry.expectedCents += mv.amountCents;
      } else if (mv.type !== 'venda') {
        // sangria/suprimento sem forma definida são sempre dinheiro
        // ponytail: com duas formas "em dinheiro" o valor entraria em ambas —
        // amarrar a sangria a uma forma específica se isso virar realidade.
        for (const [id, entry] of byMethodMap) {
          if (cashMethods.has(id)) entry.expectedCents += mv.amountCents;
        }
      }
    }

    const byMethod = [...byMethodMap.values()].filter((m) => m.isCash || m.expectedCents !== 0);
    const cashOnHandCents = byMethod.filter((m) => m.isCash).reduce((s, m) => s + m.expectedCents, 0);

    return {
      byMethod,
      cashOnHandCents,
      totals: {
        openingCents: session.openingCents,
        salesCents: sales._sum.totalCents ?? 0,
        salesCount: sales._count,
        cashSalesCents: vendas,
        sangriaCents: sangrias,
        suprimentoCents: suprimentos,
        estornoCents: estornos,
        expectedCents: cashOnHandCents,
      },
    };
  }

  private async openSession(u: SessionUser, id: string) {
    const session = await this.db.cashSession.findFirst({ where: { id, companyId: u.companyId } });
    if (!session) throw new NotFoundException('Sessão de caixa não encontrada.');
    if (session.status !== 'open') throw new BadRequestException('Este caixa já foi fechado.');
    return session;
  }
}

@Module({ controllers: [CashController] })
export class CashModule {}
