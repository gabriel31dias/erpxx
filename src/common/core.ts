import {
  BadRequestException, ForbiddenException, Global, Inject, Injectable, Module, NotFoundException,
} from '@nestjs/common';
import { PRISMA, Db } from './prisma.service';
import { monthOf, nowIn, today } from './util';
import type { SessionUser } from './auth.guard';

/** Registra ações relevantes (quem, quando, o quê, antes/depois). */
@Injectable()
export class AuditService {
  constructor(@Inject(PRISMA) private db: Db) {}

  async log(
    user: Pick<SessionUser, 'sub' | 'companyId'> | { sub?: string; companyId: string },
    action: string,
    entity: string,
    entityId?: string,
    data?: unknown,
    ip?: string,
  ) {
    await this.db.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.sub ?? null,
        action, entity,
        entityId: entityId ?? null,
        data: JSON.stringify(data ?? {}),
        ip: ip ?? null,
      },
    });
  }

  /** Diferença entre antes/depois só com os campos que mudaram. */
  static diff(before: Record<string, any>, after: Record<string, any>) {
    const out: Record<string, { de: any; para: any }> = {};
    for (const k of Object.keys(after)) {
      if (before[k] !== undefined && String(before[k]) !== String(after[k])) {
        out[k] = { de: before[k], para: after[k] };
      }
    }
    return out;
  }
}

@Injectable()
export class NotifyService {
  constructor(@Inject(PRISMA) private db: Db) {}

  create(companyId: string, type: string, title: string, body?: string, link?: string, userId?: string | null) {
    return this.db.notification.create({
      data: { companyId, type, title, body: body ?? null, link: link ?? null, userId: userId ?? null },
    });
  }
}

/**
 * Configurações da empresa (JSON em Company.settings) com os padrões num lugar só.
 * ponytail: uma tabela Settings chave/valor daria o mesmo resultado com mais joins.
 */
export const DEFAULT_SETTINGS = {
  allowNegativeStock: false,
  stockControl: true,
  requireCustomer: false,
  maxDiscountPct: 10, // desconto máximo do operador sem permissão pdv.desconto
  autoPrint: false,
  decimals: 2,
  sangriaApprovalCents: 50000, // acima disso, exige perfil gerente/admin
  receiptFooter: 'Obrigado pela preferência! Este documento não tem valor fiscal.',
  extSellerPix: true, // app do vendedor externo gera cobrança PIX no gateway
  crediarioIntervalDays: 30, // dias entre a venda e cada parcela do crediário
  crediarioGraceDays: 0, // atraso tolerado antes de barrar nova compra no crediário
  visitRadiusM: 150, // check-in mais longe que isso do cliente vira alerta "fora do local"
};
export type Settings = typeof DEFAULT_SETTINGS;

@Injectable()
export class SettingsService {
  constructor(@Inject(PRISMA) private db: Db) {}

  async of(companyId: string): Promise<Settings> {
    const company = await this.db.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(company.settings || '{}') };
  }

  async save(companyId: string, patch: Partial<Settings>) {
    const current = await this.of(companyId);
    const next = { ...current, ...patch };
    await this.db.company.update({ where: { id: companyId }, data: { settings: JSON.stringify(next) } });
    return next;
  }
}

export interface PlanInfo {
  code: string;
  name: string;
  priceCents: number;
  maxUsers: number;
  maxBranches: number;
  maxRegisters: number;
  maxProducts: number;
  features: string[];
}

/**
 * Serviço central de entitlement: nenhum módulo consulta plano na mão.
 * Limite -1 = ilimitado.
 */
@Injectable()
export class PlanService {
  constructor(@Inject(PRISMA) private db: Db) {}

  async of(companyId: string): Promise<PlanInfo> {
    const company = await this.db.company.findUnique({ where: { id: companyId }, include: { plan: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    return { ...company.plan, features: JSON.parse(company.plan.features || '[]') };
  }

  async hasFeature(companyId: string, feature: string) {
    return (await this.of(companyId)).features.includes(feature);
  }

  async requireFeature(companyId: string, feature: string, label: string) {
    if (!(await this.hasFeature(companyId, feature))) {
      throw new ForbiddenException(`${label} está disponível a partir do plano Profissional.`);
    }
  }

  /** Assinatura vencida/suspensa bloqueia o que não é leitura. */
  async assertActive(companyId: string) {
    const sub = await this.db.subscription.findFirst({
      where: { companyId }, orderBy: { startedAt: 'desc' },
    });
    if (!sub) return;
    if (['cancelled', 'suspended'].includes(sub.status)) {
      throw new ForbiddenException('Assinatura inativa. Regularize em Assinatura para continuar usando o sistema.');
    }
    if (sub.status === 'trial' && sub.trialEndsAt && sub.trialEndsAt < new Date()) {
      throw new ForbiddenException('Seu período de teste terminou. Escolha um plano em Assinatura.');
    }
  }

  async assertLimit(companyId: string, kind: 'users' | 'branches' | 'registers' | 'products') {
    const plan = await this.of(companyId);
    const check = (used: number, max: number, label: string) => {
      if (max >= 0 && used >= max) {
        throw new ForbiddenException(
          `Limite do plano ${plan.name} atingido (${max} ${label}). Faça upgrade em Assinatura.`,
        );
      }
    };
    if (kind === 'users') {
      return check(await this.db.user.count({ where: { companyId, deletedAt: null } }), plan.maxUsers, 'usuários');
    }
    if (kind === 'branches') {
      return check(await this.db.branch.count({ where: { companyId, deletedAt: null } }), plan.maxBranches, 'filiais');
    }
    if (kind === 'registers') {
      return check(await this.db.cashRegister.count({ where: { companyId, deletedAt: null } }), plan.maxRegisters, 'PDVs');
    }
    return check(await this.db.product.count({ where: { companyId, deletedAt: null } }), plan.maxProducts, 'produtos');
  }
}

/**
 * Idempotência de operações críticas: a mesma chave devolve a resposta guardada
 * em vez de criar uma segunda venda quando o PDV reenvia por timeout.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(PRISMA) private db: Db) {}

  async run<T>(companyId: string, scope: string, key: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (!key) return fn();
    const found = await this.db.idempotencyKey.findFirst({ where: { companyId, scope, key } });
    if (found) return JSON.parse(found.response) as T;
    const result = await fn();
    // corrida entre duas requisições idênticas: a segunda perde o unique e lê a primeira
    try {
      await this.db.idempotencyKey.create({
        data: { companyId, scope, key, response: JSON.stringify(result ?? {}) },
      });
    } catch {
      const again = await this.db.idempotencyKey.findFirst({ where: { companyId, scope, key } });
      if (again) return JSON.parse(again.response) as T;
    }
    return result;
  }
}

/**
 * Filial em que a operação acontece. Usuário preso a uma filial não escolhe outra;
 * quem enxerga tudo pode filtrar por uma ou ver todas.
 */
@Injectable()
export class BranchService {
  constructor(@Inject(PRISMA) private db: Db) {}

  /** Filtro de leitura: {} = todas as filiais permitidas. */
  scope(u: SessionUser, branchId?: string) {
    if (u.branchId) return { branchId: u.branchId };
    return branchId ? { branchId } : {};
  }

  /** Filial obrigatória para escrever (venda, estoque, caixa). */
  async require(u: SessionUser, branchId?: string): Promise<string> {
    const wanted = u.branchId || branchId;
    if (wanted) {
      const branch = await this.db.branch.findFirst({
        where: { id: wanted, companyId: u.companyId, deletedAt: null, active: true },
      });
      if (!branch) throw new NotFoundException('Filial não encontrada.');
      return branch.id;
    }
    const main = await this.db.branch.findFirst({
      where: { companyId: u.companyId, deletedAt: null, active: true },
      orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }],
    });
    if (!main) throw new BadRequestException('Cadastre uma filial antes de operar.');
    return main.id;
  }
}

/**
 * Relógio no fuso da empresa. O fuso quase nunca muda, então fica em memória —
 * ponytail: um Map em vez de consultar a empresa em toda venda.
 */
@Injectable()
export class TimeService {
  private tz = new Map<string, string>();
  constructor(@Inject(PRISMA) private db: Db) {}

  /** Agora — ou o instante `at` — como "YYYY-MM-DD HH:mm" no fuso da empresa. */
  async now(companyId: string, at?: Date): Promise<string> {
    let zone = this.tz.get(companyId);
    if (!zone) {
      const c = await this.db.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
      zone = c?.timezone || 'America/Sao_Paulo';
      this.tz.set(companyId, zone);
    }
    return nowIn(zone, at);
  }

  async today(companyId: string) {
    return (await this.now(companyId)).slice(0, 10);
  }

  forget(companyId: string) {
    this.tz.delete(companyId);
  }
}

export { monthOf, today };

const PROVIDERS = [
  AuditService, NotifyService, PlanService, SettingsService, IdempotencyService, BranchService, TimeService,
];

@Global()
@Module({ providers: PROVIDERS, exports: PROVIDERS })
export class CoreModule {}
