import {
  CanActivate, ConflictException, Controller, ExecutionContext, Get, Inject, Injectable, Module,
  NotFoundException, Param, Post, Query, Req, UnauthorizedException, UseGuards, createParamDecorator, Body,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { PRISMA, Db, Tx } from '../common/prisma.service';
import { ApproverSession, AUTH_COOKIE, Public } from '../common/auth.guard';
import { AuditService } from '../common/core';
import { paging } from '../common/util';

const STATUSES = ['pendente', 'aprovada', 'recusada'] as const;

class RejectDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class ListQuery {
  @IsOptional() @IsIn(STATUSES) status?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}

export const CurrentApprover = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApproverSession =>
    ctx.switchToHttp().getRequest<Request & { approver: ApproverSession }>().approver,
);

/**
 * Mesma sessão em cookie do ERP, mas só aceita token de aprovador — e o
 * aprovador desativado perde o acesso na hora, mesmo com token válido.
 */
@Injectable()
export class ApproverGuard implements CanActivate {
  constructor(private jwt: JwtService, @Inject(PRISMA) private db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { approver?: ApproverSession }>();
    const token = (req.cookies || {})[AUTH_COOKIE];
    if (!token) throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    let payload: ApproverSession;
    try {
      payload = await this.jwt.verifyAsync<ApproverSession>(token);
    } catch {
      throw new UnauthorizedException('Sessão inválida. Entre novamente.');
    }
    if (payload.typ !== 'aprovador') throw new UnauthorizedException('Sessão inválida. Entre novamente.');
    const approver = await this.db.approver.findFirst({ where: { id: payload.sub, active: true }, select: { id: true } });
    if (!approver) throw new UnauthorizedException('Usuário bloqueado. Fale com o administrador.');
    req.approver = payload;
    return true;
  }
}

// CSRF continua valendo: o guard global confere o header antes do @Public liberar.
@Public() @UseGuards(ApproverGuard)
@Controller('api/platform')
export class PlatformController {
  constructor(@Inject(PRISMA) private db: Db, private audit: AuditService) {}

  @Get('me')
  me(@CurrentApprover() a: ApproverSession) {
    return { approver: { id: a.sub, name: a.name } };
  }

  @Get('accounts')
  async list(@Query() q: ListQuery) {
    const where = { deletedAt: null, status: q.status || 'pendente' };
    const { take, skip, page, pageSize } = paging(q.page, q.pageSize);
    const [rows, total, counts] = await Promise.all([
      this.db.company.findMany({
        where, take, skip,
        orderBy: { createdAt: where.status === 'pendente' ? 'asc' : 'desc' },
        select: {
          id: true, name: true, email: true, phone: true, status: true, createdAt: true,
          reviewedAt: true, rejectReason: true, reviewedBy: { select: { name: true } },
          users: { where: { role: 'proprietario', deletedAt: null }, select: { name: true, email: true }, take: 1 },
        },
      }),
      this.db.company.count({ where }),
      this.db.company.groupBy({ by: ['status'], where: { deletedAt: null }, _count: true }),
    ]);
    return {
      rows: rows.map(({ users, reviewedBy, ...c }) => ({ ...c, owner: users[0] ?? null, reviewedBy: reviewedBy?.name ?? null })),
      total, page, pageSize,
      counts: Object.fromEntries(STATUSES.map((s) => [s, counts.find((c) => c.status === s)?._count ?? 0])),
    };
  }

  @Post('accounts/:id/approve')
  async approve(@CurrentApprover() a: ApproverSession, @Param('id') id: string, @Req() req: Request) {
    const now = new Date();
    const trialEnds = new Date(now.getTime() + Number(process.env.TRIAL_DAYS || 14) * 86400_000);
    await this.db.$transaction(async (tx) => {
      await this.review(tx as Tx, id, { status: 'aprovada', reviewedAt: now, reviewedById: a.sub });
      // o teste grátis conta a partir da liberação, não do cadastro
      await tx.subscription.updateMany({
        where: { companyId: id, status: 'trial' }, data: { trialEndsAt: trialEnds, nextChargeAt: trialEnds },
      });
    });
    await this.audit.log({ companyId: id }, 'update', 'Company', id, { conta: 'aprovada', aprovador: a.name }, req.ip);
    return { ok: true };
  }

  @Post('accounts/:id/reject')
  async reject(@CurrentApprover() a: ApproverSession, @Param('id') id: string, @Body() dto: RejectDto, @Req() req: Request) {
    const reason = dto.reason?.trim() || null;
    await this.review(this.db, id, { status: 'recusada', reviewedAt: new Date(), reviewedById: a.sub, rejectReason: reason });
    await this.audit.log({ companyId: id }, 'update', 'Company', id, { conta: 'recusada', aprovador: a.name, motivo: reason }, req.ip);
    return { ok: true };
  }

  /** Só sai de "pendente" uma vez: dois aprovadores no mesmo clique não sobrescrevem um ao outro. */
  private async review(db: Tx, id: string, data: { status: string; reviewedAt: Date; reviewedById: string; rejectReason?: string | null }) {
    const { count } = await db.company.updateMany({ where: { id, status: 'pendente', deletedAt: null }, data });
    if (count) return;
    const company = await db.company.findUnique({ where: { id }, select: { status: true, deletedAt: true } });
    if (!company || company.deletedAt) throw new NotFoundException('Conta não encontrada.');
    throw new ConflictException(`Esta conta já foi ${company.status}.`);
  }
}

@Module({
  controllers: [PlatformController],
  providers: [ApproverGuard],
})
export class PlatformModule {}
