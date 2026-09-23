import {
  BadRequestException, Body, Controller, Delete, Get, Inject, Module, NotFoundException,
  Param, Patch, Post, Req,
} from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService, DEFAULT_SETTINGS, PlanService, SettingsService, TimeService } from '../common/core';

class CompanyDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() tradeName?: string;
  @IsOptional() @IsString() document?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() whatsapp?: string;
  @IsOptional() @IsEmail({}, { message: 'E-mail inválido.' }) email?: string;
  @IsOptional() @IsString() zip?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() number?: string;
  @IsOptional() @IsString() complement?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() logoPath?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsIn(['light', 'dark']) theme?: string;
}

class SettingsDto {
  @IsOptional() @IsBoolean() allowNegativeStock?: boolean;
  @IsOptional() @IsBoolean() stockControl?: boolean;
  @IsOptional() @IsBoolean() requireCustomer?: boolean;
  @IsOptional() @IsBoolean() autoPrint?: boolean;
  @IsOptional() @IsBoolean() extSellerPix?: boolean;
  @IsOptional() @IsNumber() @Min(0) maxDiscountPct?: number;
  @IsOptional() @IsInt() @Min(0) sangriaApprovalCents?: number;
  @IsOptional() @IsInt() @Min(0) decimals?: number;
  @IsOptional() @IsString() receiptFooter?: string;
}

class PixConfigDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  /** Só é gravada quando enviada; string vazia limpa a credencial. */
  @IsOptional() @IsString() secretKey?: string;
}

class BranchDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() document?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() zip?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class PaymentMethodDto {
  @IsString() @MinLength(2) name!: string;
  @IsIn(['dinheiro', 'pix', 'debito', 'credito', 'vale', 'crediario', 'outro']) type!: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() requiresChange?: boolean;
  @IsOptional() @IsBoolean() allowsInstallments?: boolean;
  @IsOptional() @IsInt() @Min(1) maxInstallments?: number;
  @IsOptional() @IsNumber() @Min(0) feePct?: number;
  @IsOptional() @IsInt() sortOrder?: number;
}

@Controller('api/company')
export class CompanyController {
  constructor(
    @Inject(PRISMA) private db: Db,
    private audit: AuditService,
    private settings: SettingsService,
    private plans: PlanService,
    private clock: TimeService,
  ) {}

  @Get()
  async detail(@CurrentUser() u: SessionUser) {
    const company = await this.db.company.findUniqueOrThrow({
      where: { id: u.companyId }, include: { plan: true },
    });
    // a secret do PIX nunca vai para o cliente — só se está configurada
    const { pixSecretKey, ...rest } = company;
    return {
      ...rest,
      settings: { ...DEFAULT_SETTINGS, ...JSON.parse(company.settings || '{}') },
      plan: { ...company.plan, features: JSON.parse(company.plan.features || '[]') },
      pix: { enabled: company.pixEnabled, configured: !!pixSecretKey },
    };
  }

  @Patch('pix') @Perms('empresa.gerenciar')
  async savePix(@CurrentUser() u: SessionUser, @Body() dto: PixConfigDto, @Req() req: Request) {
    const data: { pixEnabled: boolean; pixSecretKey?: string | null } = { pixEnabled: !!dto.enabled };
    // só troca a secret quando o usuário digita uma nova; string vazia limpa
    if (dto.secretKey !== undefined) data.pixSecretKey = dto.secretKey.trim() || null;
    await this.db.company.update({ where: { id: u.companyId }, data });
    await this.audit.log(u, 'update', 'Company', u.companyId, { pix: { enabled: data.pixEnabled, secretKey: dto.secretKey ? '***' : undefined } }, req.ip);
    const fresh = await this.db.company.findUniqueOrThrow({ where: { id: u.companyId }, select: { pixEnabled: true, pixSecretKey: true } });
    return { enabled: fresh.pixEnabled, configured: !!fresh.pixSecretKey };
  }

  @Patch() @Perms('empresa.gerenciar')
  async update(@CurrentUser() u: SessionUser, @Body() dto: CompanyDto, @Req() req: Request) {
    const before = await this.db.company.findUniqueOrThrow({ where: { id: u.companyId } });
    const company = await this.db.company.update({
      where: { id: u.companyId },
      data: {
        name: dto.name.trim(), tradeName: dto.tradeName || null, document: dto.document || null,
        phone: dto.phone || null, whatsapp: dto.whatsapp || dto.phone || null,
        email: dto.email?.toLowerCase() || null, zip: dto.zip || null, address: dto.address || null,
        number: dto.number || null, complement: dto.complement || null, district: dto.district || null,
        city: dto.city || null, state: dto.state || null, logoPath: dto.logoPath || null,
        timezone: dto.timezone || before.timezone, theme: dto.theme || before.theme,
      },
    });
    if (dto.timezone && dto.timezone !== before.timezone) this.clock.forget(u.companyId);
    await this.audit.log(u, 'update', 'Company', u.companyId, AuditService.diff(before, company), req.ip);
    return company;
  }

  @Patch('settings') @Perms('empresa.gerenciar')
  async saveSettings(@CurrentUser() u: SessionUser, @Body() dto: SettingsDto, @Req() req: Request) {
    const next = await this.settings.save(u.companyId, dto);
    await this.audit.log(u, 'update', 'Settings', u.companyId, dto, req.ip);
    return next;
  }

  /** Marca o assistente inicial como concluído. */
  @Post('onboarded')
  async onboarded(@CurrentUser() u: SessionUser) {
    await this.db.company.update({ where: { id: u.companyId }, data: { onboarded: true } });
    return { ok: true };
  }

  /** Progresso do onboarding — cada passo é uma pergunta ao banco. */
  @Get('onboarding')
  async onboarding(@CurrentUser() u: SessionUser) {
    const [company, branches, methods, products, registers, sessions, sales] = await Promise.all([
      this.db.company.findUniqueOrThrow({ where: { id: u.companyId } }),
      this.db.branch.count({ where: { companyId: u.companyId, deletedAt: null } }),
      this.db.paymentMethod.count({ where: { companyId: u.companyId, deletedAt: null, active: true } }),
      this.db.product.count({ where: { companyId: u.companyId, deletedAt: null } }),
      this.db.cashRegister.count({ where: { companyId: u.companyId, deletedAt: null } }),
      this.db.cashSession.count({ where: { companyId: u.companyId } }),
      this.db.sale.count({ where: { companyId: u.companyId, status: 'COMPLETED' } }),
    ]);
    const steps = [
      { key: 'empresa', label: 'Dados da empresa', done: !!company.document, link: '/empresa.html' },
      { key: 'filial', label: 'Primeira filial', done: branches > 0, link: '/empresa.html' },
      { key: 'pagamento', label: 'Formas de pagamento', done: methods > 0, link: '/empresa.html' },
      { key: 'produtos', label: 'Cadastrar produtos', done: products > 0, link: '/produtos.html' },
      { key: 'pdv', label: 'Configurar PDV', done: registers > 0, link: '/empresa.html' },
      { key: 'caixa', label: 'Abrir o primeiro caixa', done: sessions > 0, link: '/caixa.html' },
      { key: 'venda', label: 'Primeira venda', done: sales > 0, link: '/pdv.html' },
    ];
    return {
      steps,
      done: steps.filter((s) => s.done).length,
      total: steps.length,
      onboarded: company.onboarded,
    };
  }

  // ---------- filiais ----------
  @Get('branches')
  async branches(@CurrentUser() u: SessionUser) {
    const rows = await this.db.branch.findMany({
      where: { companyId: u.companyId, deletedAt: null },
      orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { users: true, registers: true, sales: true } } },
    });
    return { rows: rows.map((b) => ({ ...b, counts: b._count, _count: undefined })) };
  }

  @Post('branches') @Perms('empresa.gerenciar')
  async createBranch(@CurrentUser() u: SessionUser, @Body() dto: BranchDto, @Req() req: Request) {
    await this.plans.assertLimit(u.companyId, 'branches');
    const branch = await this.db.branch.create({
      data: { companyId: u.companyId, ...this.branchData(dto) },
    });
    await this.audit.log(u, 'create', 'Branch', branch.id, { nome: branch.name }, req.ip);
    return branch;
  }

  @Patch('branches/:id') @Perms('empresa.gerenciar')
  async updateBranch(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: BranchDto, @Req() req: Request) {
    const before = await this.db.branch.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!before) throw new NotFoundException('Filial não encontrada.');
    const branch = await this.db.branch.update({ where: { id }, data: this.branchData(dto) });
    await this.audit.log(u, 'update', 'Branch', id, AuditService.diff(before, branch), req.ip);
    return branch;
  }

  @Delete('branches/:id') @Perms('empresa.gerenciar')
  async removeBranch(@CurrentUser() u: SessionUser, @Param('id') id: string, @Req() req: Request) {
    const branch = await this.db.branch.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!branch) throw new NotFoundException('Filial não encontrada.');
    if (branch.isMain) throw new BadRequestException('A filial principal não pode ser excluída.');
    const sales = await this.db.sale.count({ where: { companyId: u.companyId, branchId: id } });
    if (sales) throw new BadRequestException('Esta filial tem vendas; desative-a em vez de excluir.');
    await this.db.branch.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    await this.audit.log(u, 'delete', 'Branch', id, { nome: branch.name }, req.ip);
    return { ok: true };
  }

  private branchData(dto: BranchDto) {
    return {
      name: dto.name.trim(), document: dto.document || null, phone: dto.phone || null,
      zip: dto.zip || null, address: dto.address || null, city: dto.city || null,
      state: dto.state || null, active: dto.active ?? true,
    };
  }

  // ---------- formas de pagamento ----------
  @Get('payment-methods')
  async paymentMethods(@CurrentUser() u: SessionUser) {
    return {
      rows: await this.db.paymentMethod.findMany({
        where: { companyId: u.companyId, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    };
  }

  @Post('payment-methods') @Perms('empresa.gerenciar')
  async createMethod(@CurrentUser() u: SessionUser, @Body() dto: PaymentMethodDto, @Req() req: Request) {
    const method = await this.db.paymentMethod.create({
      data: { companyId: u.companyId, ...this.methodData(dto) },
    });
    await this.audit.log(u, 'create', 'PaymentMethod', method.id, { nome: method.name }, req.ip);
    return method;
  }

  @Patch('payment-methods/:id') @Perms('empresa.gerenciar')
  async updateMethod(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: PaymentMethodDto, @Req() req: Request) {
    const before = await this.db.paymentMethod.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!before) throw new NotFoundException('Forma de pagamento não encontrada.');
    const method = await this.db.paymentMethod.update({ where: { id }, data: this.methodData(dto) });
    await this.audit.log(u, 'update', 'PaymentMethod', id, AuditService.diff(before, method), req.ip);
    return method;
  }

  @Delete('payment-methods/:id') @Perms('empresa.gerenciar')
  async removeMethod(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const used = await this.db.salePayment.count({ where: { companyId: u.companyId, paymentMethodId: id } });
    if (used) {
      // histórico depende dela: desativa em vez de sumir
      await this.db.paymentMethod.updateMany({ where: { id, companyId: u.companyId }, data: { active: false } });
      return { ok: true, deactivated: true };
    }
    await this.db.paymentMethod.updateMany({
      where: { id, companyId: u.companyId }, data: { deletedAt: new Date(), active: false },
    });
    return { ok: true };
  }

  private methodData(dto: PaymentMethodDto) {
    return {
      name: dto.name.trim(), type: dto.type, active: dto.active ?? true,
      requiresChange: dto.requiresChange ?? dto.type === 'dinheiro',
      allowsInstallments: dto.allowsInstallments ?? dto.type === 'credito',
      maxInstallments: dto.maxInstallments ?? (dto.type === 'credito' ? 12 : 1),
      feePct: dto.feePct ?? 0,
      sortOrder: dto.sortOrder ?? 0,
    };
  }
}

@Module({ controllers: [CompanyController] })
export class CompanyModule {}
