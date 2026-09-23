import {
  BadRequestException, Body, CanActivate, ConflictException, Controller, Delete, ExecutionContext, Get,
  HttpException, Inject, Injectable, Logger, Module, NotFoundException, Param, Patch, Post, Query, Req,
  Res, UnauthorizedException, UploadedFile, UseGuards, UseInterceptors, createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Min, MinLength,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, Public, SessionUser, SkipCsrf } from '../common/auth.guard';
import { AuditService, BranchService, IdempotencyService, SettingsService, TimeService } from '../common/core';
import { DATE_RE, DT_RE, isCpf, onlyDigits, paging } from '../common/util';
import { SALE_INCLUDE, SaleItemDto, SalePaymentDto, SalesModule, SalesService } from './sales';
import { PaymentsModule, PixGateway } from './payments';
import { CreditModule, CreditService, CreditStatus } from './credit';
import { AttachmentsModule, AttachmentsService, RECEIPT_UPLOAD, UploadFile } from './attachments';

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;
const APP_PAYMENT_METHODS = ['pix', 'cartao', 'boleto'];

// ======================= cadastro (tela do ERP) =======================

class SellerDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsString() cpf!: string;
  @IsString() @Matches(USERNAME_RE, { message: 'Usuário: 3 a 40 caracteres entre letras minúsculas, números, ponto, hífen e sublinhado.' })
  username!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class CreateSellerDto extends SellerDto {
  @IsString() @MinLength(8) password!: string;
}

class PasswordDto {
  @IsString() @MinLength(8) password!: string;
}

@Controller('api/sellers')
@Perms('usuario.gerenciar')
export class SellersController {
  constructor(@Inject(PRISMA) private db: Db, private audit: AuditService) {}

  @Get()
  async list(@CurrentUser() u: SessionUser) {
    const rows = await this.db.seller.findMany({
      where: { companyId: u.companyId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, phone: true, email: true, cpf: true, username: true,
        active: true, lastLoginAt: true, createdAt: true,
      },
    });
    return { rows };
  }

  @Post()
  async create(@CurrentUser() u: SessionUser, @Body() dto: CreateSellerDto, @Req() req: Request) {
    const data = await this.clean(u.companyId, dto);
    const seller = await this.db.seller.create({
      data: { ...data, companyId: u.companyId, passwordHash: await bcrypt.hash(dto.password, 12) },
    });
    await this.audit.log(u, 'create', 'Seller', seller.id, { nome: seller.name, usuario: seller.username }, req.ip);
    return { id: seller.id };
  }

  @Patch(':id')
  async update(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: SellerDto, @Req() req: Request) {
    const before = await this.find(u.companyId, id);
    const data = await this.clean(u.companyId, dto, id);
    const seller = await this.db.seller.update({ where: { id }, data });
    await this.audit.log(u, 'update', 'Seller', id, AuditService.diff(before, seller), req.ip);
    return { ok: true };
  }

  @Post(':id/password')
  async password(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: PasswordDto, @Req() req: Request) {
    await this.find(u.companyId, id);
    await this.db.seller.update({ where: { id }, data: { passwordHash: await bcrypt.hash(dto.password, 12) } });
    await this.audit.log(u, 'update', 'Seller', id, { senha: 'redefinida pelo administrador' }, req.ip);
    return { ok: true };
  }

  @Delete(':id')
  async remove(@CurrentUser() u: SessionUser, @Param('id') id: string, @Req() req: Request) {
    const seller = await this.find(u.companyId, id);
    // vendas continuam apontando para o vendedor: exclusão lógica. O usuário é
    // liberado (é único no sistema todo) para poder ser reaproveitado.
    await this.db.seller.update({
      where: { id },
      data: { deletedAt: new Date(), active: false, username: `${seller.username}#${id}`, cpf: `${seller.cpf}#${id}` },
    });
    await this.audit.log(u, 'delete', 'Seller', id, { nome: seller.name }, req.ip);
    return { ok: true };
  }

  private async find(companyId: string, id: string) {
    const seller = await this.db.seller.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!seller) throw new NotFoundException('Vendedor não encontrado.');
    return seller;
  }

  private async clean(companyId: string, dto: SellerDto, id?: string) {
    const cpf = onlyDigits(dto.cpf);
    if (!isCpf(cpf)) throw new BadRequestException('CPF inválido.');
    const username = dto.username.trim().toLowerCase();
    const taken = await this.db.seller.findUnique({ where: { username } });
    if (taken && taken.id !== id) throw new ConflictException('Este usuário já está em uso. Escolha outro.');
    const sameCpf = await this.db.seller.findFirst({ where: { companyId, cpf, deletedAt: null } });
    if (sameCpf && sameCpf.id !== id) throw new ConflictException('Já existe um vendedor com este CPF.');
    return {
      name: dto.name.trim(), phone: dto.phone?.trim() || null, email: dto.email?.trim().toLowerCase() || null,
      cpf, username, ...(dto.active !== undefined ? { active: dto.active } : {}),
    };
  }
}

// ======================= API do app do vendedor =======================

export interface SellerSession {
  sub: string; // Seller.id
  companyId: string;
  typ: 'seller';
}

export const CurrentSeller = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SellerSession =>
    ctx.switchToHttp().getRequest<Request & { seller: SellerSession }>().seller,
);

/**
 * O app manda `Authorization: Bearer <token>` (sem cookie, então sem CSRF).
 * Vendedor bloqueado/excluído perde o acesso na hora, mesmo com token válido.
 */
@Injectable()
export class SellerGuard implements CanActivate {
  constructor(private jwt: JwtService, @Inject(PRISMA) private db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { seller?: SellerSession }>();
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Token ausente. Faça login.');
    let payload: SellerSession;
    try {
      payload = await this.jwt.verifyAsync<SellerSession>(token);
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado. Faça login.');
    }
    if (payload.typ !== 'seller') throw new UnauthorizedException('Token inválido. Faça login.');
    const seller = await this.db.seller.findFirst({
      where: { id: payload.sub, companyId: payload.companyId, deletedAt: null, active: true },
      select: { id: true },
    });
    if (!seller) throw new UnauthorizedException('Vendedor bloqueado. Fale com a loja.');
    req.seller = payload;
    return true;
  }
}

class ExtLoginDto {
  /** Usuário ou e-mail do vendedor. */
  @IsString() username!: string;
  @IsString() password!: string;
}

class ExtSaleDto {
  /** Id gerado no aparelho: reenviar o mesmo lote não duplica venda. */
  @IsString() @MinLength(8) idempotencyKey!: string;
  /** Momento da venda no aparelho ("YYYY-MM-DD HH:mm", fuso da loja). */
  @IsOptional() @Matches(DT_RE, { message: 'soldAt deve ser "YYYY-MM-DD HH:mm".' }) soldAt?: string;
  /** Venda gerada sem internet (ficou na fila do aparelho). */
  @IsBoolean() offline!: boolean;
  /** Cliente já pagou pelo app. */
  @IsBoolean() paidInApp!: boolean;
  /** Obrigatório quando paidInApp = true. */
  @ValidateIf((o) => o.paidInApp === true)
  @IsIn(APP_PAYMENT_METHODS, { message: `appPaymentMethod deve ser ${APP_PAYMENT_METHODS.join(', ')}.` })
  appPaymentMethod?: string;
  /** Id da transação PIX/cartão ou nosso número do boleto. */
  @IsOptional() @IsString() appPaymentRef?: string;
  /** Vencimento da conta a receber (boleto ou venda não paga). Padrão: dia da venda. */
  @IsOptional() @Matches(DATE_RE, { message: 'dueDate deve ser "YYYY-MM-DD".' }) dueDate?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsInt() @Min(0) discountCents?: number;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => SaleItemDto) items!: SaleItemDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => SalePaymentDto) payments!: SalePaymentDto[];
}

class ExtBatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => ExtSaleDto)
  sales!: ExtSaleDto[];
}

class ExtPixSaleDto {
  /** Id gerado no aparelho: repetir a chamada devolve a mesma venda e o mesmo QR. */
  @IsString() @MinLength(8) idempotencyKey!: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsInt() @Min(0) discountCents?: number;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SaleItemDto) items!: SaleItemDto[];
}

const TOKEN_TTL = '30d';

@Controller('api/ext/auth')
@Public() @SkipCsrf()
export class ExtAuthController {
  constructor(@Inject(PRISMA) private db: Db, private jwt: JwtService, private audit: AuditService) {}

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  async login(@Body() dto: ExtLoginDto, @Req() req: Request) {
    const login = dto.username.trim().toLowerCase();
    // entra com o usuário ou com o e-mail (este só se nenhum outro vendedor ativo usar o mesmo)
    let seller = await this.db.seller.findUnique({ where: { username: login }, include: { company: true } });
    if (!seller && login.includes('@')) {
      const byEmail = await this.db.seller.findMany({
        where: { email: login, deletedAt: null, companyId: { not: '' } }, include: { company: true }, take: 2,
      });
      if (byEmail.length === 1) seller = byEmail[0];
    }
    // bcrypt sempre roda: não revela pelo tempo se o usuário existe
    const ok = await bcrypt.compare(
      dto.password, seller?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid');
    if (!seller || seller.deletedAt || !ok) throw new UnauthorizedException('Usuário ou senha inválidos.');
    if (!seller.active) throw new UnauthorizedException('Vendedor bloqueado. Fale com a loja.');
    if (seller.company.deletedAt || !seller.company.active) throw new UnauthorizedException('Empresa inativa.');

    const payload: SellerSession = { sub: seller.id, companyId: seller.companyId, typ: 'seller' };
    const token = await this.jwt.signAsync(payload, { expiresIn: TOKEN_TTL });
    await this.db.seller.update({ where: { id: seller.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ companyId: seller.companyId }, 'login', 'Seller', seller.id, { usuario: seller.username }, req.ip);
    return {
      token, tokenType: 'Bearer', expiresIn: TOKEN_TTL,
      seller: { id: seller.id, name: seller.name, username: seller.username, email: seller.email, phone: seller.phone },
      company: { id: seller.company.id, name: seller.company.tradeName || seller.company.name },
    };
  }
}

@Controller('api/ext')
@Public() @SkipCsrf() @UseGuards(SellerGuard)
export class ExtController {
  constructor(
    @Inject(PRISMA) private db: Db,
    private sales: SalesService,
    private branches: BranchService,
    private clock: TimeService,
    private pix: PixGateway,
    private idem: IdempotencyService,
    private audit: AuditService,
    private settings: SettingsService,
    private attachments: AttachmentsService,
    private credit: CreditService,
  ) {}

  /** PIX pelo app: ligado nas configurações da loja e com o gateway configurado. */
  private async pixAllowed(companyId: string) {
    const [settings, company] = await Promise.all([
      this.settings.of(companyId),
      this.db.company.findUnique({ where: { id: companyId }, select: { pixEnabled: true, pixSecretKey: true } }),
    ]);
    return settings.extSellerPix && !!company?.pixEnabled && !!company.pixSecretKey;
  }

  /** Vendedor externo opera na filial principal (estoque e baixa das vendas). */
  private branchOf(s: SellerSession) {
    return this.branches.require({ companyId: s.companyId, branchId: null } as SessionUser);
  }

  @Get('me')
  async me(@CurrentSeller() s: SellerSession) {
    const seller = await this.db.seller.findUniqueOrThrow({
      where: { id: s.sub },
      select: { id: true, name: true, username: true, email: true, phone: true, company: { select: { id: true, name: true, tradeName: true } } },
    });
    // o app usa `pix` para mostrar ou esconder o botão de cobrar por PIX
    return { ...seller, pix: await this.pixAllowed(s.companyId) };
  }

  /** Catálogo inteiro, sem paginação — o app guarda para vender offline. */
  @Get('products')
  async products(@CurrentSeller() s: SellerSession) {
    const branchId = await this.branchOf(s);
    const rows = await this.db.product.findMany({
      where: { companyId: s.companyId, deletedAt: null, active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, description: true, sku: true, internalCode: true, barcode: true, brand: true,
        unit: true, saleType: true, priceCents: true, imageUrl: true, updatedAt: true,
        category: { select: { id: true, name: true } },
        stocks: { where: { branchId }, select: { quantity: true } },
      },
    });
    // priceCents = basePriceCents = preço do cadastro. O preço do cliente sai de GET price-lists.
    return {
      total: rows.length,
      rows: rows.map(({ stocks, ...p }) => ({ ...p, basePriceCents: p.priceCents, stock: stocks[0]?.quantity ?? 0 })),
    };
  }

  /**
   * Todas as tabelas de preço ativas, com todos os itens, sem paginação — o app
   * guarda para precificar no PDV mobile, inclusive offline. A regra é a do servidor:
   *
   *   cliente sem priceListId (ou tabela fora desta lista) → basePriceCents do produto
   *   produto com item na tabela                           → item.priceCents
   *   produto sem item                                      → round(base × (10000 + adjustBp) / 10000)
   *
   * A venda deve mandar o unitPriceCents usado. Venda offline cujo preço mudou no
   * servidor depois de soldAt é aceita com o preço do aparelho; online, o preço
   * precisa bater com o atual (senão 403 — recarregue as tabelas).
   * `updatedAt` de cada tabela muda a cada alteração: dá para baixar só quando mudar.
   */
  @Get('price-lists')
  async priceLists(@CurrentSeller() s: SellerSession) {
    const rows = await this.db.priceList.findMany({
      where: { companyId: s.companyId, deletedAt: null, active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, description: true, adjustBp: true, updatedAt: true,
        items: {
          where: { product: { deletedAt: null, active: true } },
          select: { productId: true, priceCents: true },
        },
      },
    });
    return { total: rows.length, rows };
  }

  /**
   * Todos os clientes ativos, sem paginação. `priceListId` diz a tabela de preço;
   * `credit` é a foto do crediário no momento do download (o app mostra, mas a
   * decisão é do servidor na hora da venda — use GET customers/:id/credit antes de vender).
   */
  @Get('customers')
  async customers(@CurrentSeller() s: SellerSession) {
    const rows = await this.db.customer.findMany({
      where: { companyId: s.companyId, deletedAt: null, active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, document: true, phone: true, whatsapp: true, email: true,
        birthdate: true, address: true, priceListId: true, updatedAt: true,
      },
    });
    const credit = await this.credit.statusOf(s.companyId, rows.map((c) => c.id));
    return {
      total: rows.length,
      rows: rows.map((c) => ({ ...c, credit: this.creditView(credit.get(c.id)!) })),
    };
  }

  /**
   * Crediário do cliente agora: limite, usado, disponível, atraso, parcelas em
   * aberto e se o vendedor pode vender no crediário (vendedor não tem liberação:
   * qualquer motivo em `reasons` faz a venda ser recusada).
   */
  @Get('customers/:id/credit')
  async customerCredit(@CurrentSeller() s: SellerSession, @Param('id') id: string) {
    const customer = await this.db.customer.findFirst({
      where: { id, companyId: s.companyId, deletedAt: null, active: true }, select: { id: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');
    const [status, installments, enabled] = await Promise.all([
      this.credit.status(s.companyId, id),
      this.credit.openInstallments(s.companyId, id),
      this.credit.enabled(s.companyId),
    ]);
    const reasons = enabled ? (await this.credit.check(s.companyId, id, 0)).reasons : ['O crediário não está incluído no plano da loja.'];
    return {
      ...this.creditView(status),
      canSell: reasons.length === 0,
      reasons,
      installments: installments.map((i) => ({
        id: i.id, saleNumber: i.sale?.number ?? null, description: i.description, amountCents: i.amountCents,
        dueDate: i.dueDate, installmentNo: i.installmentNo, installmentOf: i.installmentOf, instrument: i.instrument,
      })),
    };
  }

  private creditView(c: CreditStatus) {
    return {
      limitCents: c.limitCents, usedCents: c.usedCents, availableCents: c.availableCents,
      status: c.status, blockReason: c.blockReason,
      overdueCount: c.overdue.count, overdueCents: c.overdue.amountCents, overdueDays: c.overdue.days,
    };
  }

  /** Formas de pagamento aceitas no lote de vendas (crediário só se o plano da loja incluir). */
  @Get('payment-methods')
  async paymentMethods(@CurrentSeller() s: SellerSession) {
    const rows = await this.db.paymentMethod.findMany({
      where: { companyId: s.companyId, deletedAt: null, active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, type: true, requiresChange: true, allowsInstallments: true, maxInstallments: true },
    });
    const crediario = await this.credit.enabled(s.companyId);
    return { rows: rows.filter((m) => crediario || m.type !== 'crediario') };
  }

  /** Vendas do próprio vendedor, paginadas (uso online). */
  @Get('sales')
  async list(
    @CurrentSeller() s: SellerSession,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { take, skip, ...rest } = paging(page, pageSize);
    const where = {
      companyId: s.companyId, sellerId: s.sub,
      ...(status ? { status: { in: status.split(',') } } : {}),
      ...(from || to ? { soldAt: { ...(from ? { gte: `${from} 00:00` } : {}), ...(to ? { lte: `${to} 23:59` } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.sale.findMany({ where, orderBy: { soldAt: 'desc' }, take, skip, include: SALE_INCLUDE }),
      this.db.sale.count({ where }),
    ]);
    return { rows, total, ...rest, pages: Math.ceil(total / take) };
  }

  @Get('sales/:id')
  async detail(@CurrentSeller() s: SellerSession, @Param('id') id: string) {
    const sale = await this.db.sale.findFirst({ where: { id, companyId: s.companyId, sellerId: s.sub }, include: SALE_INCLUDE });
    if (!sale) throw new NotFoundException('Venda não encontrada.');
    return sale;
  }

  /**
   * Venda online paga por PIX no gateway: grava a venda (baixa o estoque e abre a
   * conta a receber) e devolve o QR + copia-e-cola. O app consulta
   * GET sales/:id/pix até `paid: true`; aí a venda vira paga no financeiro.
   * PIX não pago: a loja cancela a venda no ERP e o estoque volta.
   */
  @Post('sales/pix')
  async pixSale(@CurrentSeller() s: SellerSession, @Body() dto: ExtPixSaleDto, @Req() req: Request) {
    return this.idem.run(s.companyId, 'ext-pix', `${s.sub}:${dto.idempotencyKey}`, async () => {
      // PIX desligado: falha antes de mexer em estoque
      if (!(await this.settings.of(s.companyId)).extSellerPix) {
        throw new BadRequestException('A loja desativou o PIX nas vendas do app. Fale com a loja.');
      }
      await this.pix.config(s.companyId);
      const method = await this.db.paymentMethod.findFirst({
        where: { companyId: s.companyId, type: 'pix', active: true, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
      if (!method) throw new BadRequestException('A loja não tem a forma de pagamento PIX ativa.');

      // mesma precificação que a venda vai gravar (cadastro ou tabela do cliente)
      const actor = { companyId: s.companyId, branchId: null, role: 'vendedor_externo', userId: null, sellerId: s.sub };
      const { total } = await this.sales.price(actor, dto, await this.clock.now(s.companyId));
      if (total <= 0) throw new BadRequestException('Total da venda precisa ser maior que zero.');

      const customer = dto.customerId
        ? await this.db.customer.findFirst({ where: { id: dto.customerId, companyId: s.companyId, deletedAt: null } })
        : null;
      const seller = await this.db.seller.findUniqueOrThrow({ where: { id: s.sub }, select: { name: true } });
      const charge = await this.pix.charge(s.companyId, total, `Venda externa · ${seller.name}`, customer ?? undefined);

      const sale = await this.sales.create(
        actor,
        {
          customerId: dto.customerId, discountCents: dto.discountCents, notes: dto.notes, items: dto.items,
          payments: [{ paymentMethodId: method.id, amountCents: total }],
          idempotencyKey: `ext-pix:${s.sub}:${dto.idempotencyKey}`,
        },
        req.ip, undefined,
        // fica pendente até o gateway confirmar
        { offline: false, paidInApp: false, appPaymentMethod: 'pix', appPaymentRef: charge.id },
      );
      return {
        saleId: sale.id, number: sale.number, totalCents: sale.totalCents,
        pix: {
          id: charge.id, status: charge.status, paid: false,
          qrcode: charge.qrcode, // copia e cola
          qrImage: charge.qrImage, // data:image/png;base64,...
          expiresAt: charge.expiresAt,
        },
      };
    });
  }

  /** Status do PIX da venda. Pago no gateway → marca a venda e o financeiro como recebidos. */
  @Get('sales/:id/pix')
  async pixStatus(@CurrentSeller() s: SellerSession, @Param('id') id: string, @Req() req: Request) {
    const sale = await this.db.sale.findFirst({
      where: { id, companyId: s.companyId, sellerId: s.sub, appPaymentMethod: 'pix' },
    });
    if (!sale || !sale.appPaymentRef) throw new NotFoundException('Venda PIX não encontrada.');
    if (sale.paidInApp) {
      return { saleId: sale.id, saleStatus: sale.status, paid: true, status: 'paid', qrcode: null, expiresAt: null };
    }
    const charge = await this.pix.status(s.companyId, sale.appPaymentRef);
    if (charge.paid && sale.status === 'COMPLETED') {
      const hoje = await this.clock.today(s.companyId);
      await this.db.$transaction([
        this.db.sale.update({ where: { id }, data: { paidInApp: true } }),
        this.db.financeEntry.updateMany({
          where: { companyId: s.companyId, saleId: id, status: 'pending' },
          data: { status: 'paid', paidAt: hoje, instrument: 'pix' },
        }),
      ]);
      await this.audit.log({ companyId: s.companyId }, 'update', 'Sale', id,
        { numero: sale.number, pix: 'recebido', transacao: sale.appPaymentRef }, req.ip);
    }
    return {
      saleId: sale.id, saleStatus: sale.status, paid: charge.paid, status: charge.status,
      paidAt: charge.paidAt, qrcode: charge.paid ? null : charge.qrcode, expiresAt: charge.expiresAt,
    };
  }

  // ---------- comprovantes de pagamento ----------
  /** Anexa um comprovante (JPG, PNG, WEBP ou PDF, até 5 MB) a uma venda do vendedor. */
  @Post('sales/:id/receipts')
  @UseInterceptors(RECEIPT_UPLOAD)
  async attach(
    @CurrentSeller() s: SellerSession, @Param('id') id: string, @UploadedFile() file: UploadFile,
    @Body('notes') notes: string | undefined, @Req() req: Request,
  ) {
    const sale = await this.db.sale.findFirst({ where: { id, companyId: s.companyId, sellerId: s.sub }, select: { id: true } });
    if (!sale) throw new NotFoundException('Venda não encontrada.');
    return this.attachments.save({ companyId: s.companyId, sellerId: s.sub }, id, file, notes, req.ip);
  }

  @Get('sales/:id/receipts')
  async receipts(@CurrentSeller() s: SellerSession, @Param('id') id: string) {
    const sale = await this.db.sale.findFirst({ where: { id, companyId: s.companyId, sellerId: s.sub }, select: { id: true } });
    if (!sale) throw new NotFoundException('Venda não encontrada.');
    return { rows: await this.attachments.list(s.companyId, id) };
  }

  @Get('receipts/:attId/file')
  receiptFile(@CurrentSeller() s: SellerSession, @Param('attId') attId: string, @Res() res: Response) {
    return this.attachments.send({ id: attId, companyId: s.companyId, sale: { sellerId: s.sub } }, res);
  }

  /**
   * Lote de vendas feitas no aparelho. Cada venda é independente: uma recusada
   * (sem estoque, cliente inexistente…) não derruba as outras. Reenviar o lote
   * inteiro é seguro — a mesma idempotencyKey devolve a venda já gravada.
   */
  @Post('sales/batch')
  async batch(@CurrentSeller() s: SellerSession, @Body() dto: ExtBatchDto, @Req() req: Request) {
    const now = await this.clock.now(s.companyId);
    const actor = { companyId: s.companyId, branchId: null, role: 'vendedor_externo', userId: null, sellerId: s.sub };
    const results: Array<Record<string, unknown> & { ok: boolean }> = [];
    for (const sale of dto.sales) {
      try {
        const created = await this.sales.create(actor, {
          customerId: sale.customerId, discountCents: sale.discountCents, notes: sale.notes,
          items: sale.items, payments: sale.payments,
          // chave por vendedor: dois aparelhos não colidem entre si nem com o PDV
          idempotencyKey: `ext:${s.sub}:${sale.idempotencyKey}`,
        }, req.ip, sale.soldAt && sale.soldAt < now ? sale.soldAt : now, {
          offline: sale.offline,
          paidInApp: sale.paidInApp,
          appPaymentMethod: sale.paidInApp ? sale.appPaymentMethod! : null,
          appPaymentRef: sale.paidInApp ? sale.appPaymentRef?.trim() || null : null,
          dueDate: sale.dueDate,
        });
        results.push({
          idempotencyKey: sale.idempotencyKey, ok: true,
          saleId: created.id, number: created.number, totalCents: created.totalCents,
          offline: created.offline, paidInApp: created.paidInApp, appPaymentMethod: created.appPaymentMethod,
        });
      } catch (e) {
        const status = e instanceof HttpException ? e.getStatus() : 500;
        const message = e instanceof HttpException ? e.message : 'Erro inesperado ao gravar a venda.';
        if (status >= 500) new Logger('ExtSales').error(e);
        results.push({ idempotencyKey: sale.idempotencyKey, ok: false, status, error: message });
      }
    }
    const accepted = results.filter((r) => r.ok).length;
    return { accepted, rejected: results.length - accepted, results };
  }
}

@Module({
  imports: [SalesModule, PaymentsModule, AttachmentsModule, CreditModule],
  controllers: [SellersController, ExtAuthController, ExtController],
  providers: [SellerGuard],
})
export class SellersModule {}
