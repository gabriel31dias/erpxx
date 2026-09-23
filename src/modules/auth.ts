import {
  BadRequestException, Body, ConflictException, Controller, Get, Inject, Injectable, Logger, Module,
  OnApplicationBootstrap, Post, Req, Res, UnauthorizedException,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PRISMA, Db } from '../common/prisma.service';
import { AUTH_COOKIE, CurrentUser, Public, SessionUser } from '../common/auth.guard';
import { AuditService, DEFAULT_SETTINGS } from '../common/core';
import { permissionsOf, ROLE_LABELS } from '../common/rbac';
import { slugify } from '../common/util';

class RegisterDto {
  @IsString() @MinLength(2) companyName!: string;
  @IsString() @MinLength(2) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsOptional() @IsString() phone?: string;
}

class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}

class ForgotDto {
  @IsEmail() email!: string;
}

class ResetDto {
  @IsString() token!: string;
  @IsString() @MinLength(8) password!: string;
}

class ChangePasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

class AcceptInviteDto {
  @IsString() token!: string;
  @IsString() @MinLength(2) name!: string;
  @IsString() @MinLength(8) password!: string;
}

class ProfileDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsIn(['light', 'dark']) theme?: string;
}

/** Formas de pagamento que toda loja usa no primeiro dia. */
export const DEFAULT_PAYMENT_METHODS = [
  { name: 'Dinheiro', type: 'dinheiro', requiresChange: true, sortOrder: 1 },
  { name: 'PIX', type: 'pix', sortOrder: 2 },
  { name: 'Cartão de débito', type: 'debito', sortOrder: 3 },
  { name: 'Cartão de crédito', type: 'credito', allowsInstallments: true, maxInstallments: 12, sortOrder: 4 },
  { name: 'Crediário', type: 'crediario', allowsInstallments: true, maxInstallments: 10, sortOrder: 5 },
];

/**
 * Garante as formas padrão em toda empresa (as criadas antes de uma forma virar
 * padrão também recebem). Tipo que a empresa já teve — mesmo excluído ou
 * inativo — não volta: foi decisão da loja.
 */
export async function ensureDefaultPaymentMethods(db: Db) {
  const companies = await db.company.findMany({
    where: { deletedAt: null }, select: { id: true, paymentMethods: { select: { type: true } } },
  });
  const data = companies.flatMap((c) => {
    const has = new Set(c.paymentMethods.map((m) => m.type));
    return DEFAULT_PAYMENT_METHODS.filter((m) => !has.has(m.type)).map((m) => ({ ...m, companyId: c.id }));
  });
  if (data.length) await db.paymentMethod.createMany({ data });
  return data.length;
}

export const DEFAULT_FINANCIAL_CATEGORIES = [
  { name: 'Vendas', type: 'RECEITA' },
  { name: 'Outras receitas', type: 'RECEITA' },
  { name: 'Fornecedores', type: 'DESPESA' },
  { name: 'Aluguel', type: 'DESPESA' },
  { name: 'Folha de pagamento', type: 'DESPESA' },
  { name: 'Água, luz e internet', type: 'DESPESA' },
  { name: 'Impostos', type: 'DESPESA' },
  { name: 'Outras despesas', type: 'DESPESA' },
];

/** Empresa nova nasce utilizável: filial, PDV, formas de pagamento e categorias. */
export async function bootstrapCompany(db: Db, companyId: string, branchName = 'Loja principal') {
  const branch = await db.branch.create({ data: { companyId, name: branchName, isMain: true } });
  await db.cashRegister.create({ data: { companyId, branchId: branch.id, name: 'Caixa 1' } });
  await db.paymentMethod.createMany({
    data: DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m, companyId })),
  });
  await db.financialCategory.createMany({
    data: DEFAULT_FINANCIAL_CATEGORIES.map((c) => ({ ...c, companyId })),
  });
  return branch;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private db: Db,
    private jwt: JwtService,
    private audit: AuditService,
  ) {}

  async sign(user: { id: string; companyId: string; role: string; name: string; branchId: string | null }) {
    const payload: SessionUser = {
      sub: user.id, companyId: user.companyId, role: user.role, name: user.name, branchId: user.branchId,
    };
    return this.jwt.signAsync(payload);
  }

  setCookie(res: Response, token: string) {
    res.cookie(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 3600 * 1000,
      path: '/',
    });
  }

  async register(dto: RegisterDto, ip?: string) {
    const email = dto.email.toLowerCase().trim();
    const exists = await this.db.user.findFirst({ where: { email, companyId: { not: '' } } });
    if (exists) throw new ConflictException('Este e-mail já está em uso.');

    const plan = await this.db.plan.findFirst({ orderBy: { sortOrder: 'asc' } });
    if (!plan) throw new BadRequestException('Planos não configurados. Rode "npm run seed".');

    let slug = slugify(dto.companyName);
    while (await this.db.company.findUnique({ where: { slug } })) {
      slug = `${slugify(dto.companyName)}-${randomBytes(2).toString('hex')}`;
    }

    const trialDays = Number(process.env.TRIAL_DAYS || 14);
    const company = await this.db.company.create({
      data: {
        name: dto.companyName.trim(), tradeName: dto.companyName.trim(), slug,
        phone: dto.phone ?? null, whatsapp: dto.phone ?? null, email, planId: plan.id,
        settings: JSON.stringify(DEFAULT_SETTINGS),
        subscriptions: {
          create: {
            planId: plan.id, status: 'trial', amountCents: plan.priceCents,
            trialEndsAt: new Date(Date.now() + trialDays * 86400_000),
            nextChargeAt: new Date(Date.now() + trialDays * 86400_000),
          },
        },
      },
    });

    const branch = await bootstrapCompany(this.db, company.id);
    const user = await this.db.user.create({
      data: {
        companyId: company.id, name: dto.name.trim(), email,
        passwordHash: await bcrypt.hash(dto.password, 12), role: 'proprietario',
      },
    });

    await this.audit.log({ sub: user.id, companyId: company.id }, 'create', 'Company', company.id,
      { nome: company.name, filial: branch.name }, ip);
    return { user, company };
  }

  async validate(email: string, password: string) {
    const user = await this.db.user.findFirst({
      where: { email: email.toLowerCase().trim(), deletedAt: null, companyId: { not: '' } },
      include: { company: true },
    });
    // bcrypt sempre roda: evita descobrir e-mails válidos pelo tempo de resposta
    const ok = await bcrypt.compare(
      password, user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid');
    if (!user || !ok) throw new UnauthorizedException('E-mail ou senha inválidos.');
    if (!user.active || user.blockedAt) throw new UnauthorizedException('Usuário bloqueado. Fale com o administrador.');
    if (user.company.deletedAt || !user.company.active) throw new UnauthorizedException('Empresa inativa.');
    return user;
  }
}

@Controller('api/auth')
export class AuthController {
  constructor(
    @Inject(PRISMA) private db: Db,
    private service: AuthService,
    private audit: AuditService,
  ) {}

  @Public() @Post('register')
  @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, company } = await this.service.register(dto, req.ip);
    this.service.setCookie(res, await this.service.sign(user));
    return { ok: true, redirect: '/onboarding.html', company: { id: company.id, name: company.name } };
  }

  @Public() @Post('login')
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.service.validate(dto.email, dto.password);
    this.service.setCookie(res, await this.service.sign(user));
    await this.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ sub: user.id, companyId: user.companyId }, 'login', 'User', user.id, {}, req.ip);
    return { ok: true, redirect: user.company.onboarded ? '/' : '/onboarding.html' };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE, { path: '/' });
    return { ok: true, redirect: '/login.html' };
  }

  @Get('me')
  async me(@CurrentUser() u: SessionUser) {
    const user = await this.db.user.findUnique({
      where: { id: u.sub },
      include: { company: { include: { plan: true } }, branch: true },
    });
    if (!user || user.deletedAt) throw new UnauthorizedException('Sessão inválida.');
    const { company } = user;
    const branches = await this.db.branch.findMany({
      where: { companyId: u.companyId, deletedAt: null, active: true, ...(user.branchId ? { id: user.branchId } : {}) },
      orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isMain: true },
    });
    const subscription = await this.db.subscription.findFirst({
      where: { companyId: u.companyId }, orderBy: { startedAt: 'desc' },
    });
    return {
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        roleLabel: ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role,
        branchId: user.branchId,
      },
      company: {
        id: company.id, name: company.name, tradeName: company.tradeName, logoPath: company.logoPath,
        theme: company.theme, timezone: company.timezone, currency: company.currency,
        onboarded: company.onboarded,
        pixEnabled: company.pixEnabled && !!company.pixSecretKey,
        settings: { ...DEFAULT_SETTINGS, ...JSON.parse(company.settings || '{}') },
        plan: {
          code: company.plan.code, name: company.plan.name,
          features: JSON.parse(company.plan.features || '[]'),
        },
        subscription: subscription
          ? { status: subscription.status, trialEndsAt: subscription.trialEndsAt, nextChargeAt: subscription.nextChargeAt }
          : null,
      },
      branches,
      permissions: permissionsOf(user.role),
    };
  }

  @Post('profile')
  async profile(@CurrentUser() u: SessionUser, @Body() dto: ProfileDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.db.user.update({ where: { id: u.sub }, data: { name: dto.name.trim() } });
    if (dto.theme) await this.db.company.update({ where: { id: u.companyId }, data: { theme: dto.theme } });
    this.service.setCookie(res, await this.service.sign(user));
    return { ok: true };
  }

  @Post('change-password')
  async changePassword(@CurrentUser() u: SessionUser, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: u.sub } });
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Senha atual incorreta.');
    }
    await this.db.user.update({
      where: { id: u.sub },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 12) },
    });
    await this.audit.log(u, 'update', 'User', u.sub, { senha: 'alterada' }, req.ip);
    return { ok: true, message: 'Senha alterada com sucesso.' };
  }

  @Public() @Post('forgot-password')
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  async forgot(@Body() dto: ForgotDto) {
    const user = await this.db.user.findFirst({
      where: { email: dto.email.toLowerCase().trim(), deletedAt: null, companyId: { not: '' } },
    });
    const response: any = { ok: true, message: 'Se o e-mail existir, enviaremos as instruções de recuperação.' };
    if (user) {
      const token = randomBytes(24).toString('hex');
      await this.db.user.update({
        where: { id: user.id },
        data: { resetToken: token, resetExpiresAt: new Date(Date.now() + 3600_000) },
      });
      // ponytail: sem SMTP no projeto — em dev o link volta na resposta.
      // Trocar por envio de e-mail (Resend/SES) plugando aqui.
      const link = `/reset-password.html?token=${token}`;
      console.log(`[recuperação de senha] ${user.email}: ${link}`);
      if (process.env.NODE_ENV !== 'production') response.devLink = link;
    }
    return response;
  }

  @Public() @Post('reset-password')
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  async reset(@Body() dto: ResetDto) {
    const user = await this.db.user.findFirst({ where: { resetToken: dto.token, companyId: { not: '' } } });
    if (!user || !user.resetExpiresAt || user.resetExpiresAt < new Date()) {
      throw new BadRequestException('Link de recuperação inválido ou expirado.');
    }
    await this.db.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(dto.password, 12), resetToken: null, resetExpiresAt: null },
    });
    return { ok: true, message: 'Senha redefinida. Faça login.', redirect: '/login.html' };
  }

  @Public() @Post('accept-invite')
  async acceptInvite(@Body() dto: AcceptInviteDto, @Res({ passthrough: true }) res: Response) {
    const invite = await this.db.invite.findUnique({ where: { token: dto.token } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw new BadRequestException('Convite inválido ou expirado.');
    }
    const existing = await this.db.user.findFirst({
      where: { companyId: invite.companyId, email: invite.email },
    });
    if (existing) throw new ConflictException('Este e-mail já faz parte da empresa.');

    const user = await this.db.user.create({
      data: {
        companyId: invite.companyId, email: invite.email, name: dto.name.trim(),
        role: invite.role, branchId: invite.branchId,
        passwordHash: await bcrypt.hash(dto.password, 12),
      },
    });
    await this.db.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    this.service.setCookie(res, await this.service.sign(user));
    return { ok: true, redirect: '/' };
  }
}

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: process.env.JWT_SECRET || 'dev-secret-lojaflow',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule implements OnApplicationBootstrap {
  constructor(@Inject(PRISMA) private db: Db) {}

  async onApplicationBootstrap() {
    const created = await ensureDefaultPaymentMethods(this.db);
    if (created) new Logger('LojaFlow').log(`Formas de pagamento padrão criadas: ${created}`);
  }
}
