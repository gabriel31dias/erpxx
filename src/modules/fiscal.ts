import {
  BadRequestException, Body, Controller, Get, Inject, Module, NotFoundException,
  Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { PRISMA, Db, TX } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService } from '../common/core';
import { paging } from '../common/util';

// ---------- Provedor (agnóstico) ----------
/** Contexto normalizado que qualquer adaptador de provedor recebe. */
export interface EmitContext {
  company: any; sale: any; items: any[]; customer: any | null;
  type: 'nfce' | 'nfe'; serie: number; numero: number; env: string; payload: any;
}
export interface EmitResult {
  status: 'authorized' | 'processing' | 'rejected' | 'error';
  accessKey?: string; protocol?: string; providerRef?: string;
  xmlUrl?: string; danfeUrl?: string; qrcode?: string; rejectionReason?: string;
}
export interface FiscalProvider {
  emitir(ctx: EmitContext): Promise<EmitResult>;
  cancelar(doc: any, reason: string): Promise<EmitResult>;
  consultar(doc: any): Promise<EmitResult>;
}

/** Provedor de simulação: autoriza na hora em homologação. Serve para testar as
 *  telas sem uma API real. Em produção, recusa (troque pelo adaptador de verdade). */
class StubProvider implements FiscalProvider {
  async emitir(ctx: EmitContext): Promise<EmitResult> {
    if (ctx.env === 'producao') {
      return { status: 'error', rejectionReason: 'Provedor de simulação não emite em produção. Configure um provedor real.' };
    }
    // chave de acesso fake (44 dígitos) só para exercitar o fluxo
    const rnd = () => Math.floor(Math.random() * 10);
    const accessKey = Array.from({ length: 44 }, rnd).join('');
    return {
      status: 'authorized',
      accessKey,
      protocol: '135' + Date.now(),
      providerRef: 'stub_' + accessKey.slice(0, 12),
      qrcode: `https://www.homologacao.nfce.fazenda.gov.br/consulta?p=${accessKey}|2|2|1|${accessKey.slice(-8)}`,
    };
  }
  async cancelar(): Promise<EmitResult> { return { status: 'authorized' }; } // cancelamento aceito no stub
  async consultar(doc: any): Promise<EmitResult> { return { status: doc.status }; }
}

/** Adaptadores reais entram aqui quando a API for escolhida. */
function getProvider(company: any): FiscalProvider {
  switch (company.fiscalProvider) {
    // case 'focusnfe': return new FocusNfeProvider(company.fiscalToken, company.fiscalEnv);
    // case 'nfeio': return new NfeIoProvider(company.fiscalToken, company.fiscalEnv);
    default: return new StubProvider();
  }
}

// ---------- DTOs ----------
class FiscalConfigDto {
  @IsOptional() @IsString() ie?: string;
  @IsOptional() @IsString() im?: string;
  @IsOptional() @IsIn(['1', '2', '3']) crt?: string;
  @IsOptional() @IsString() cnae?: string;
  @IsOptional() @IsString() fiscalProvider?: string;
  @IsOptional() @IsString() fiscalToken?: string; // só grava quando enviado
  @IsOptional() @IsIn(['homologacao', 'producao']) fiscalEnv?: string;
  @IsOptional() @IsBoolean() fiscalEnabled?: boolean;
  @IsOptional() @IsInt() @Min(1) nfceSerie?: number;
  @IsOptional() @IsInt() @Min(1) nfceProx?: number;
  @IsOptional() @IsInt() @Min(1) nfeSerie?: number;
  @IsOptional() @IsInt() @Min(1) nfeProx?: number;
  @IsOptional() @IsString() cscId?: string;
  @IsOptional() @IsString() csc?: string; // só grava quando enviado
}

class EmitDto {
  @IsString() saleId!: string;
}

class CancelDto {
  @IsString() @MinLength(15, { message: 'A justificativa precisa de ao menos 15 caracteres.' }) reason!: string;
}

@Controller('api/fiscal')
export class FiscalController {
  constructor(@Inject(PRISMA) private db: Db, private audit: AuditService) {}

  // ---------------- Configuração ----------------
  @Get('config') @Perms('empresa.gerenciar')
  async config(@CurrentUser() u: SessionUser) {
    const c = await this.db.company.findUniqueOrThrow({ where: { id: u.companyId } });
    return {
      ie: c.ie, im: c.im, crt: c.crt, cnae: c.cnae,
      fiscalProvider: c.fiscalProvider, fiscalEnv: c.fiscalEnv, fiscalEnabled: c.fiscalEnabled,
      nfceSerie: c.nfceSerie, nfceProx: c.nfceProx, nfeSerie: c.nfeSerie, nfeProx: c.nfeProx,
      cscId: c.cscId,
      tokenConfigured: !!c.fiscalToken, cscConfigured: !!c.csc,
      // ajuda a saber o que ainda falta para emitir
      pronto: !!(c.document && c.ie && c.fiscalProvider && c.fiscalToken && c.city && c.state),
      empresa: { document: c.document, name: c.name, city: c.city, state: c.state, zip: c.zip },
    };
  }

  @Patch('config') @Perms('empresa.gerenciar')
  async saveConfig(@CurrentUser() u: SessionUser, @Body() dto: FiscalConfigDto, @Req() req: Request) {
    const data: any = {};
    for (const k of ['ie', 'im', 'cnae', 'fiscalProvider', 'cscId'] as const) if (dto[k] !== undefined) data[k] = dto[k] || null;
    if (dto.crt !== undefined) data.crt = dto.crt;
    if (dto.fiscalEnv !== undefined) data.fiscalEnv = dto.fiscalEnv;
    if (dto.fiscalEnabled !== undefined) data.fiscalEnabled = dto.fiscalEnabled;
    for (const k of ['nfceSerie', 'nfceProx', 'nfeSerie', 'nfeProx'] as const) if (dto[k] !== undefined) data[k] = dto[k];
    if (dto.fiscalToken) data.fiscalToken = dto.fiscalToken.trim(); // só troca quando digita
    if (dto.csc) data.csc = dto.csc.trim();
    await this.db.company.update({ where: { id: u.companyId }, data });
    await this.audit.log(u, 'update', 'FiscalConfig', u.companyId, { provider: dto.fiscalProvider, env: dto.fiscalEnv }, req.ip);
    return this.config(u);
  }

  // ---------------- Emissão NFC-e ----------------
  @Post('nfce') @Perms('pdv.acessar')
  async emitirNfce(@CurrentUser() u: SessionUser, @Body() dto: EmitDto, @Req() req: Request) {
    const company = await this.db.company.findUniqueOrThrow({ where: { id: u.companyId } });
    if (!company.fiscalEnabled) throw new BadRequestException('Emissão fiscal desabilitada. Ative em Notas fiscais › Configuração.');
    if (!company.fiscalProvider) throw new BadRequestException('Configure o provedor de NF-e antes de emitir.');
    if (!company.document || !company.ie) throw new BadRequestException('Cadastre CNPJ e Inscrição Estadual da empresa.');

    const sale = await this.db.sale.findFirst({
      where: { id: dto.saleId, companyId: u.companyId },
      include: { items: { include: { product: true } }, payments: true, customer: true, branch: true },
    });
    if (!sale) throw new NotFoundException('Venda não encontrada.');
    if (sale.status === 'cancelled') throw new BadRequestException('Venda cancelada não emite nota.');

    // idempotência: uma nota autorizada/processando por venda
    const existente = await this.db.fiscalDocument.findFirst({
      where: { companyId: u.companyId, saleId: sale.id, type: 'nfce', status: { in: ['authorized', 'processing'] } },
    });
    if (existente) return existente;

    // todo item precisa de NCM
    const semNcm = sale.items.filter((i) => !i.product?.ncm);
    if (semNcm.length) {
      throw new BadRequestException(`Sem NCM: ${semNcm.map((i) => i.name).join(', ')}. Preencha os dados fiscais desses produtos.`);
    }

    // aloca número da NFC-e de forma atômica
    const doc = await this.db.$transaction(async (tx) => {
      const c = await tx.company.findUniqueOrThrow({ where: { id: u.companyId } });
      const numero = c.nfceProx;
      await tx.company.update({ where: { id: u.companyId }, data: { nfceProx: numero + 1 } });

      const payload = this.montarPayload(c, sale, 'nfce', c.nfceSerie, numero);
      const provider = getProvider(c);
      let res: EmitResult;
      try {
        res = await provider.emitir({ company: c, sale, items: sale.items, customer: sale.customer, type: 'nfce', serie: c.nfceSerie, numero, env: c.fiscalEnv, payload });
      } catch (e: any) {
        res = { status: 'error', rejectionReason: e?.message || 'Falha ao comunicar com o provedor.' };
      }

      return tx.fiscalDocument.create({
        data: {
          companyId: u.companyId, branchId: sale.branchId, saleId: sale.id, type: 'nfce',
          status: res.status, environment: c.fiscalEnv, number: numero, serie: c.nfceSerie,
          accessKey: res.accessKey || null, protocol: res.protocol || null, providerRef: res.providerRef || null,
          provider: c.fiscalProvider, xmlUrl: res.xmlUrl || null, danfeUrl: res.danfeUrl || null,
          qrcode: res.qrcode || null, rejectionReason: res.rejectionReason || null,
          payload: JSON.stringify(payload), createdById: u.sub,
          issuedAt: res.status === 'authorized' ? new Date() : null,
        },
      });
    }, TX);

    await this.audit.log(u, 'create', 'FiscalDocument', doc.id, { venda: sale.number, status: doc.status, numero: doc.number }, req.ip);
    return doc;
  }

  /** Monta o payload normalizado (o adaptador do provedor mapeia para o formato dele). */
  private montarPayload(company: any, sale: any, type: string, serie: number, numero: number) {
    return {
      tipo: type, ambiente: company.fiscalEnv, serie, numero,
      emitente: {
        cnpj: company.document, ie: company.ie, im: company.im, crt: company.crt,
        razaoSocial: company.name, nomeFantasia: company.tradeName,
        endereco: {
          logradouro: company.address, numero: company.number, complemento: company.complement,
          bairro: company.district, municipio: company.city, uf: company.state, cep: company.zip,
        },
      },
      destinatario: sale.customer ? {
        nome: sale.customer.name, documento: sale.customer.document,
        email: sale.customer.email, telefone: sale.customer.phone,
      } : null,
      itens: sale.items.map((it: any, i: number) => ({
        item: i + 1, codigo: it.product?.sku || it.product?.internalCode || it.productId,
        ean: it.product?.barcode || 'SEM GTIN', descricao: it.name,
        ncm: it.product?.ncm, cest: it.product?.cest || undefined,
        cfop: it.product?.cfop || '5102', unidade: it.unit,
        quantidade: it.quantity, valorUnitario: it.unitPriceCents / 100,
        valorTotal: it.totalCents / 100, descontoCents: it.discountCents,
        origem: it.product?.origem ?? '0',
        csosn: company.crt === '1' ? (it.product?.csosn || '102') : undefined,
        cst: company.crt !== '1' ? (it.product?.cstIcms || '00') : undefined,
        cstPis: it.product?.cstPis || '49', cstCofins: it.product?.cstCofins || '49',
      })),
      pagamentos: sale.payments.map((p: any) => ({ tipo: p.methodType || 'outro', valorCents: p.amountCents })),
      totais: { produtosCents: sale.subtotalCents, descontoCents: sale.discountCents, totalCents: sale.totalCents },
    };
  }

  // ---------------- Consulta / lista ----------------
  @Get('documents') @Perms('venda.visualizar')
  async documents(
    @CurrentUser() u: SessionUser,
    @Query('type') type?: string, @Query('status') status?: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
  ) {
    const { take, skip, ...rest } = paging(page, pageSize);
    const where: any = { companyId: u.companyId, ...(type ? { type } : {}), ...(status ? { status } : {}) };
    const [rows, total] = await Promise.all([
      this.db.fiscalDocument.findMany({
        where, orderBy: { createdAt: 'desc' }, take, skip,
        include: { sale: { select: { number: true } } },
      }),
      this.db.fiscalDocument.count({ where }),
    ]);
    return { rows, total, ...rest };
  }

  @Get('documents/:id') @Perms('venda.visualizar')
  async document(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const doc = await this.db.fiscalDocument.findFirst({
      where: { id, companyId: u.companyId }, include: { sale: { select: { number: true } } },
    });
    if (!doc) throw new NotFoundException('Documento não encontrado.');
    return doc;
  }

  @Get('documents/:id/refresh') @Perms('venda.visualizar')
  async refresh(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const doc = await this.db.fiscalDocument.findFirst({ where: { id, companyId: u.companyId } });
    if (!doc) throw new NotFoundException('Documento não encontrado.');
    const company = await this.db.company.findUniqueOrThrow({ where: { id: u.companyId } });
    const res = await getProvider(company).consultar(doc);
    return this.db.fiscalDocument.update({
      where: { id }, data: { status: res.status, accessKey: res.accessKey ?? doc.accessKey, protocol: res.protocol ?? doc.protocol },
    });
  }

  @Post('documents/:id/cancel') @Perms('pdv.acessar')
  async cancel(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: CancelDto, @Req() req: Request) {
    const doc = await this.db.fiscalDocument.findFirst({ where: { id, companyId: u.companyId } });
    if (!doc) throw new NotFoundException('Documento não encontrado.');
    if (doc.status !== 'authorized') throw new BadRequestException('Só é possível cancelar nota autorizada.');
    const company = await this.db.company.findUniqueOrThrow({ where: { id: u.companyId } });
    const res = await getProvider(company).cancelar(doc, dto.reason);
    if (res.status === 'error' || res.status === 'rejected') throw new BadRequestException(res.rejectionReason || 'Cancelamento recusado.');
    const updated = await this.db.fiscalDocument.update({
      where: { id }, data: { status: 'cancelled', cancelReason: dto.reason, cancelledAt: new Date() },
    });
    await this.audit.log(u, 'update', 'FiscalDocument', id, { acao: 'cancelamento', motivo: dto.reason }, req.ip);
    return updated;
  }
}

@Module({ controllers: [FiscalController] })
export class FiscalModule {}
