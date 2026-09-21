import {
  BadRequestException, Body, Controller, Get, Inject, Module, Param, Post,
} from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import * as QRCode from 'qrcode';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';

const BLUE_BASE = process.env.PIX_API_BASE || 'https://api.bluevisionsolucoes.com.br/functions/v1';
// A Blue sinaliza pagamento aprovado com um destes status.
const PAID = ['paid', 'approved', 'confirmed', 'succeeded'];

class PixCustomerDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() document?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
}

class PixChargeDto {
  @IsInt() @Min(1) @Max(100_000_000) amountCents!: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @ValidateNested() @Type(() => PixCustomerDto) customer?: PixCustomerDto;
}

@Controller('api/payments')
export class PaymentsController {
  constructor(@Inject(PRISMA) private db: Db) {}

  /** Lê as credenciais do PIX no servidor (a secret nunca sai daqui). */
  private async config(companyId: string) {
    const company = await this.db.company.findUnique({
      where: { id: companyId },
      select: { pixEnabled: true, pixSecretKey: true },
    });
    if (!company?.pixEnabled || !company.pixSecretKey) {
      throw new BadRequestException('PIX não está habilitado ou sem credenciais. Configure em Configurações.');
    }
    return company.pixSecretKey;
  }

  private authHeader(secret: string) {
    // Basic base64("<secret>:x") — mesmo formato do gateway Blue.
    return `Basic ${Buffer.from(`${secret}:x`).toString('base64')}`;
  }

  private async blue(secret: string, path: string, init?: RequestInit) {
    let res: Response;
    try {
      res = await fetch(`${BLUE_BASE}${path}`, {
        ...init,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: this.authHeader(secret),
          ...(init?.headers || {}),
        },
      });
    } catch {
      throw new BadRequestException('Não consegui falar com o gateway PIX. Verifique a conexão.');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (body as any)?.message || (body as any)?.error || `Gateway respondeu ${res.status}.`;
      throw new BadRequestException(typeof msg === 'string' ? msg : 'Falha no gateway PIX.');
    }
    return body as any;
  }

  /** Gera uma cobrança PIX e devolve o QR (imagem + copia-e-cola). */
  @Post('pix') @Perms('pdv.acessar')
  async createPix(@CurrentUser() u: SessionUser, @Body() dto: PixChargeDto) {
    const secret = await this.config(u.companyId);
    const customer = dto.customer?.name || dto.customer?.document
      ? {
        name: dto.customer.name || 'Consumidor Final',
        ...(dto.customer.document ? { document: { number: dto.customer.document.replace(/\D/g, '') } } : {}),
        ...(dto.customer.email ? { email: dto.customer.email } : {}),
        ...(dto.customer.phone ? { phone: dto.customer.phone.replace(/\D/g, '') } : {}),
      }
      : { name: 'Consumidor Final' };

    const data = await this.blue(secret, '/transactions', {
      method: 'POST',
      body: JSON.stringify({
        paymentMethod: 'PIX',
        amount: dto.amountCents,
        installments: 1,
        customer,
        items: [{ title: dto.description || 'Venda PDV', unitPrice: dto.amountCents, quantity: 1 }],
      }),
    });

    const copia = data?.pix?.qrcode as string | undefined;
    if (!data?.id || !copia) throw new BadRequestException('O gateway não retornou o QR do PIX.');
    const qrImage = await QRCode.toDataURL(copia, { margin: 1, width: 320 });
    return {
      id: data.id as string,
      status: data.status as string,
      paid: PAID.includes(String(data.status)),
      qrcode: copia,
      qrImage,
      expiresAt: data?.pix?.expirationDate ?? null,
    };
  }

  /** Consulta o status da cobrança (polling do PDV). */
  @Get('pix/:id') @Perms('pdv.acessar')
  async statusPix(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    const secret = await this.config(u.companyId);
    const data = await this.blue(secret, `/transactions/${encodeURIComponent(id)}`);
    return {
      id: data?.id ?? id,
      status: data?.status ?? 'unknown',
      paid: PAID.includes(String(data?.status)),
      paidAt: data?.paidAt ?? null,
    };
  }
}

@Module({ controllers: [PaymentsController] })
export class PaymentsModule {}
