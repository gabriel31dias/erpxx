import {
  BadRequestException, Body, Controller, Get, Inject, Module, NotFoundException, Post, Req,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService } from '../common/core';
import { addMonths, today } from '../common/util';

/**
 * Planos vêm do .env para o time comercial mexer sem deploy.
 * LIMITS = usuários,filiais,PDVs,produtos (-1 = ilimitado)
 */
export function envPlans() {
  const parse = (code: string, fallbackName: string, order: number) => {
    const prefix = `PLAN_${code.toUpperCase()}`;
    const limits = (process.env[`${prefix}_LIMITS`] || '-1,-1,-1,-1').split(',').map((n) => Number(n.trim()));
    const price = Number((process.env[`${prefix}_PRICE`] || '0').replace(/\./g, '').replace(',', '.')) * 100;
    return {
      code,
      name: process.env[`${prefix}_NAME`] || fallbackName,
      priceCents: Math.round(price),
      maxUsers: limits[0] ?? -1,
      maxBranches: limits[1] ?? -1,
      maxRegisters: limits[2] ?? -1,
      maxProducts: limits[3] ?? -1,
      features: JSON.stringify((process.env[`${prefix}_FEATURES`] || '').split(',').map((f) => f.trim()).filter(Boolean)),
      sortOrder: order,
    };
  };
  return [parse('basico', 'Básico', 1), parse('pro', 'Profissional', 2), parse('premium', 'Premium', 3)];
}

/** Cria/atualiza os planos a partir do .env (idempotente). */
export async function syncPlans(db: Db) {
  for (const plan of envPlans()) {
    await db.plan.upsert({ where: { code: plan.code }, create: plan, update: plan });
  }
  return db.plan.findMany({ orderBy: { sortOrder: 'asc' } });
}

class SubscribeDto {
  @IsString() planCode!: string;
  @IsOptional() @IsIn(['monthly', 'yearly']) period?: string;
}

class CancelDto {
  @IsOptional() @IsString() reason?: string;
}

@Controller('api/subscription')
export class BillingController {
  constructor(@Inject(PRISMA) private db: Db, private audit: AuditService) {}

  @Get()
  async current(@CurrentUser() u: SessionUser) {
    const [company, plans, subscription, usage] = await Promise.all([
      this.db.company.findUniqueOrThrow({ where: { id: u.companyId }, include: { plan: true } }),
      this.db.plan.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.db.subscription.findFirst({ where: { companyId: u.companyId }, orderBy: { startedAt: 'desc' } }),
      Promise.all([
        this.db.user.count({ where: { companyId: u.companyId, deletedAt: null } }),
        this.db.branch.count({ where: { companyId: u.companyId, deletedAt: null } }),
        this.db.cashRegister.count({ where: { companyId: u.companyId, deletedAt: null } }),
        this.db.product.count({ where: { companyId: u.companyId, deletedAt: null } }),
      ]),
    ]);
    const [users, branches, registers, products] = usage;
    return {
      plan: { ...company.plan, features: JSON.parse(company.plan.features || '[]') },
      plans: plans.map((p) => ({ ...p, features: JSON.parse(p.features || '[]') })),
      subscription,
      usage: {
        users, branches, registers, products,
        limits: {
          users: company.plan.maxUsers, branches: company.plan.maxBranches,
          registers: company.plan.maxRegisters, products: company.plan.maxProducts,
        },
      },
    };
  }

  /**
   * Troca de plano. ponytail: sem gateway no MVP — a assinatura fica `active` e o
   * checkout entra aqui (mesmo ponto onde o AgendaFlow pluga o Mercado Pago).
   */
  @Post() @Perms('plano.gerenciar')
  async subscribe(@CurrentUser() u: SessionUser, @Body() dto: SubscribeDto, @Req() req: Request) {
    const plan = await this.db.plan.findUnique({ where: { code: dto.planCode } });
    if (!plan) throw new NotFoundException('Plano não encontrado.');

    const [users, branches, registers, products] = await Promise.all([
      this.db.user.count({ where: { companyId: u.companyId, deletedAt: null } }),
      this.db.branch.count({ where: { companyId: u.companyId, deletedAt: null } }),
      this.db.cashRegister.count({ where: { companyId: u.companyId, deletedAt: null } }),
      this.db.product.count({ where: { companyId: u.companyId, deletedAt: null } }),
    ]);
    const over = [
      plan.maxUsers >= 0 && users > plan.maxUsers ? `${users} usuários` : null,
      plan.maxBranches >= 0 && branches > plan.maxBranches ? `${branches} filiais` : null,
      plan.maxRegisters >= 0 && registers > plan.maxRegisters ? `${registers} PDVs` : null,
      plan.maxProducts >= 0 && products > plan.maxProducts ? `${products} produtos` : null,
    ].filter(Boolean);
    if (over.length) {
      throw new BadRequestException(`O plano ${plan.name} não comporta ${over.join(', ')}. Reduza antes de trocar.`);
    }

    const period = dto.period || 'monthly';
    await this.db.company.update({ where: { id: u.companyId }, data: { planId: plan.id } });
    const subscription = await this.db.subscription.create({
      data: {
        companyId: u.companyId, planId: plan.id, status: 'active', period,
        amountCents: period === 'yearly' ? plan.priceCents * 10 : plan.priceCents,
        nextChargeAt: new Date(`${addMonths(today(), period === 'yearly' ? 12 : 1)}T12:00:00Z`),
      },
    });
    await this.audit.log(u, 'update', 'Subscription', subscription.id, { plano: plan.code, periodo: period }, req.ip);
    return { ok: true, subscription, message: `Plano alterado para ${plan.name}.` };
  }

  @Post('cancel') @Perms('plano.gerenciar')
  async cancel(@CurrentUser() u: SessionUser, @Body() dto: CancelDto, @Req() req: Request) {
    const subscription = await this.db.subscription.findFirst({
      where: { companyId: u.companyId }, orderBy: { startedAt: 'desc' },
    });
    if (!subscription) throw new NotFoundException('Nenhuma assinatura ativa.');
    const updated = await this.db.subscription.update({
      where: { id: subscription.id },
      data: { status: 'cancelled', cancelledAt: new Date(), endsAt: subscription.nextChargeAt },
    });
    await this.audit.log(u, 'update', 'Subscription', subscription.id, { acao: 'cancelada', motivo: dto.reason }, req.ip);
    return { ok: true, subscription: updated };
  }
}

@Module({ controllers: [BillingController] })
export class BillingModule {}
