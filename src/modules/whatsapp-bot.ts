import {
  BadRequestException, Body, Controller, Get, Global, Header, Inject, Injectable, Logger, Module,
  OnModuleDestroy, OnModuleInit, Param, Patch, Post, Req,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import * as QRCode from 'qrcode';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService, PlanService } from '../common/core';
import { Db, PRISMA } from '../common/prisma.service';
import { BaileysDriver, WhatsAppClient } from './whatsapp-driver';
import { WHATSAPP_TEMPLATES, WHATSAPP_VARIABLES } from './whatsapp-events';

const DEFAULT_SETTINGS = {
  enabled: false, purchaseEnabled: true, receivedEnabled: true, dispatchedEnabled: true,
  purchaseTemplate: WHATSAPP_TEMPLATES.purchase, receivedTemplate: WHATSAPP_TEMPLATES.received,
  dispatchedTemplate: WHATSAPP_TEMPLATES.dispatched,
};
class WhatsAppSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() purchaseEnabled?: boolean;
  @IsOptional() @IsBoolean() receivedEnabled?: boolean;
  @IsOptional() @IsBoolean() dispatchedEnabled?: boolean;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) purchaseTemplate?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) receivedTemplate?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) dispatchedTemplate?: string;
}
type Session = {
  state: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'reconnecting' | 'error';
  qrCode: string | null; qrExpiresAt: number; phone: string | null; name: string | null;
  error: string | null; connectedAt: string | null; client?: WhatsAppClient; generation: number;
  retry?: NodeJS.Timeout; failures: number;
};

@Injectable()
export class WhatsAppBotService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('BootWhats');
  private sessions = new Map<string, Session>();
  private locks = new Map<string, Promise<unknown>>();
  private timer?: NodeJS.Timeout;
  private working = false;
  private stopping = false;

  constructor(@Inject(PRISMA) private db: Db, private driver: BaileysDriver, private plans: PlanService) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    // O resto do ERP funciona mesmo se uma conta do WhatsApp estiver indisponível.
    const configs = await this.db.whatsAppBot.findMany({ where: { companyId: { not: '' }, autoConnect: true, company: { active: true, deletedAt: null, status: 'aprovada' } } });
    for (const config of configs) void this.connect(config.companyId).catch(() => this.log.warn('Não foi possível restaurar uma conexão do WhatsApp.'));
    this.timer = setInterval(() => { void this.processQueue().catch(() => this.log.error('Falha ao processar a fila do WhatsApp.')); }, 5000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    this.stopping = true;
    clearInterval(this.timer);
    for (const session of this.sessions.values()) {
      session.generation++;
      clearTimeout(session.retry);
      await session.client?.close(false).catch(() => undefined);
    }
  }

  private session(companyId: string) {
    let session = this.sessions.get(companyId);
    if (!session) {
      session = { state: 'disconnected', qrCode: null, qrExpiresAt: 0, phone: null, name: null, error: null, connectedAt: null, generation: 0, failures: 0 };
      this.sessions.set(companyId, session);
    }
    return session;
  }

  status(companyId: string) {
    const s = this.session(companyId);
    return {
      state: s.state, qrCode: Date.now() < s.qrExpiresAt ? s.qrCode : null,
      qrExpiresAt: s.qrExpiresAt ? new Date(s.qrExpiresAt).toISOString() : null,
      phone: s.phone, name: s.name, error: s.error, connectedAt: s.connectedAt,
    };
  }

  private async exclusive<T>(companyId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(companyId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    this.locks.set(companyId, current);
    try { return await current; }
    finally { if (this.locks.get(companyId) === current) this.locks.delete(companyId); }
  }

  async settings(companyId: string) {
    const settings = await this.db.whatsAppBot.findUnique({ where: { companyId } });
    return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => [key, settings?.[key] === '' ? fallback : settings?.[key] ?? fallback]));
  }

  async save(companyId: string, dto: WhatsAppSettingsDto) {
    await this.plans.assertActive(companyId);
    if (Object.values(dto).some((value) => value === null)) throw new BadRequestException('As configurações não podem ser nulas.');
    for (const key of ['purchaseTemplate', 'receivedTemplate', 'dispatchedTemplate']) {
      const value = dto[key];
      if (value === undefined) continue;
      if (!value.trim()) throw new BadRequestException('Preencha o texto da mensagem.');
      const invalid = [...value.matchAll(/\{([^{}]*)\}/g)].some((match) => !WHATSAPP_VARIABLES.includes(match[1]));
      if (invalid || /[{}]/.test(value.replace(/\{\w+\}/g, ''))) throw new BadRequestException('Use somente as variáveis disponíveis na tela.');
      dto[key] = value.trim();
    }
    await this.db.whatsAppBot.upsert({ where: { companyId }, create: { companyId, ...dto }, update: dto });
    return this.settings(companyId);
  }

  async connect(companyId: string) {
    return this.exclusive(companyId, async () => {
      await this.plans.assertActive(companyId);
      const company = await this.db.company.findUniqueOrThrow({ where: { id: companyId } });
      if (!company.active || company.deletedAt || company.status !== 'aprovada') throw new BadRequestException('Empresa inativa.');
      await this.db.whatsAppBot.upsert({ where: { companyId }, create: { companyId, autoConnect: true }, update: { autoConnect: true } });
      const session = this.session(companyId);
      if (['connecting', 'connected'].includes(session.state) || session.state === 'qr' && Date.now() < session.qrExpiresAt) return this.status(companyId);
      session.failures = 0;
      await this.start(companyId);
      return this.status(companyId);
    });
  }

  private async start(companyId: string) {
    if (this.stopping) return;
    const s = this.session(companyId);
    clearTimeout(s.retry);
    s.retry = undefined;
    const generation = ++s.generation;
    const old = s.client;
    s.client = undefined;
    await old?.close(false).catch(() => undefined);
    s.state = 'connecting'; s.qrCode = null; s.qrExpiresAt = 0; s.error = null;
    try {
      const client = await this.driver.create(companyId,
        (update) => { void this.exclusive(companyId, () => this.update(companyId, generation, update)).catch(() => this.connectionError(companyId, generation)); },
        () => { void this.exclusive(companyId, () => this.connectionError(companyId, generation)); });
      if (this.stopping || s.generation !== generation) await client.close(false);
      else s.client = client;
    } catch {
      if (s.generation === generation) {
        s.state = 'error'; s.error = 'Não foi possível conectar. Tente novamente ou desconecte para gerar uma nova sessão.';
        this.schedule(companyId, generation);
      }
    }
  }

  private async connectionError(companyId: string, generation: number) {
    const s = this.session(companyId);
    if (s.generation !== generation || this.stopping) return;
    s.state = 'error'; s.error = 'Falha ao guardar a sessão. Reconecte o WhatsApp.';
    this.schedule(companyId, generation);
  }

  private schedule(companyId: string, generation: number) {
    const s = this.session(companyId);
    if (s.retry || this.stopping) return;
    const delay = Math.min(60_000, 2000 * 2 ** Math.min(s.failures++, 5));
    s.retry = setTimeout(() => {
      s.retry = undefined;
      if (this.stopping || s.generation !== generation) return;
      void this.exclusive(companyId, async () => {
        const config = await this.db.whatsAppBot.findUnique({ where: { companyId } });
        if (!config?.autoConnect) return;
        await this.plans.assertActive(companyId);
        await this.start(companyId);
      }).catch(() => { s.state = 'error'; s.error = 'Conexão pausada. Verifique a assinatura e tente conectar novamente.'; });
    }, delay);
    s.retry.unref();
  }

  private async update(companyId: string, generation: number, update: any) {
    const s = this.session(companyId);
    if (this.stopping || s.generation !== generation) return;
    if (update.qr) {
      const qr = await QRCode.toDataURL(update.qr, { width: 300, margin: 2 });
      if (s.generation !== generation || !['connecting', 'qr'].includes(s.state)) return;
      s.qrCode = qr; s.qrExpiresAt = Date.now() + 60_000; s.state = 'qr'; s.error = null;
    }
    if (update.connection === 'open') {
      const user = s.client?.socket.user;
      s.state = 'connected'; s.qrCode = null; s.qrExpiresAt = 0; s.error = null; s.failures = 0;
      s.phone = user?.id?.split(':')[0]?.split('@')[0] ?? null; s.name = user?.name ?? null;
      s.connectedAt = new Date().toISOString();
    }
    if (update.connection === 'close') {
      s.qrCode = null; s.qrExpiresAt = 0;
      const code = update.lastDisconnect?.error?.output?.statusCode;
      if ([401, 440, 500, 411].includes(code) || !s.client?.socket.authState?.creds?.registered && s.failures >= 3) {
        ++s.generation;
        await s.client?.close(false).catch(() => undefined); s.client = undefined;
        s.state = 'disconnected'; s.phone = null; s.name = null; s.connectedAt = null;
        s.error = 'Sessão encerrada. Clique em Conectar WhatsApp e leia um novo QR Code.';
        await this.db.whatsAppBot.update({ where: { companyId }, data: { autoConnect: false } });
        await this.db.whatsAppAuth.deleteMany({ where: { companyId } });
      } else {
        s.state = 'reconnecting'; s.error = 'Conexão interrompida. Tentando reconectar automaticamente.';
        this.schedule(companyId, generation);
      }
    }
  }

  async disconnect(companyId: string) {
    return this.exclusive(companyId, async () => {
      await this.db.whatsAppBot.upsert({ where: { companyId }, create: { companyId, autoConnect: false }, update: { autoConnect: false } });
      const s = this.session(companyId); ++s.generation; clearTimeout(s.retry); s.retry = undefined;
      await s.client?.close(true).catch(() => undefined); s.client = undefined;
      await this.db.whatsAppAuth.deleteMany({ where: { companyId } });
      s.state = 'disconnected'; s.qrCode = null; s.qrExpiresAt = 0; s.error = null;
      s.phone = null; s.name = null; s.connectedAt = null;
      return this.status(companyId);
    });
  }

  async messages(companyId: string) {
    return this.db.whatsAppMessage.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 30,
      select: { id: true, event: true, phone: true, message: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true } });
  }

  async retry(companyId: string, id: string) {
    await this.plans.assertActive(companyId);
    const result = await this.db.whatsAppMessage.updateMany({ where: { companyId, id, status: 'failed' },
      data: { status: 'pending', attempts: 0, lastError: null, nextAttemptAt: new Date() } });
    if (!result.count) throw new BadRequestException('A mensagem não está disponível para nova tentativa.');
    return { ok: true };
  }

  /** Fila persistente: claim condicional, tentativas com intervalo e mesmo id no provedor. */
  async processQueue() {
    if (this.working || this.stopping) return;
    this.working = true;
    try {
      for (const [companyId, session] of this.sessions) {
        if (session.state !== 'connected' || !session.client) continue;
        const config = await this.db.whatsAppBot.findUnique({ where: { companyId }, include: { company: true } });
        if (!config?.enabled || !config.company.active || config.company.deletedAt || config.company.status !== 'aprovada') continue;
        try { await this.plans.assertActive(companyId); } catch { continue; }
        const now = new Date();
        await this.db.whatsAppMessage.updateMany({ where: { companyId, status: 'sending', nextAttemptAt: { lte: now } }, data: { status: 'pending' } });
        const queue = await this.db.whatsAppMessage.findMany({
          where: { companyId, status: 'pending', nextAttemptAt: { lte: now } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 10,
        });
        for (const job of queue) {
          if (session.state !== 'connected' || !session.client) break;
          if (!config[`${job.event}Enabled`]) continue;
          const ref = job.event === 'purchase'
            ? await this.db.sale.findFirst({ where: { companyId, id: job.refId, status: 'COMPLETED', paymentStatus: 'approved' } })
            : await this.db.menuOrder.findFirst({ where: { companyId, id: job.refId, status: { not: 'cancelled' }, paymentStatus: { notIn: ['pending', 'rejected', 'refund_pending'] } } });
          if (!ref) {
            await this.db.whatsAppMessage.updateMany({ where: { companyId, id: job.id, status: 'pending' }, data: { status: 'cancelled', lastError: 'Venda ou pedido cancelado ou indisponível.' } });
            continue;
          }
          if (job.event === 'dispatched' && !['delivering', 'delivered'].includes(ref.status)) continue;
          const claimed = await this.db.whatsAppMessage.updateMany({ where: { companyId, id: job.id, status: 'pending' },
            data: { status: 'sending', attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 90_000) } });
          if (!claimed.count) continue;
          try {
            // Confirma o destinatário e usa o JID devolvido pelo WhatsApp.
            const contacts = await session.client.socket.onWhatsApp(job.phone);
            const contact = contacts?.find((entry: any) => entry.exists);
            if (!contact) throw new Error('not_registered');
            const sent = await session.client.socket.sendMessage(contact.jid, { text: job.message }, { messageId: job.providerMessageId });
            if (!sent?.key?.id) throw new Error('not_confirmed');
            await this.db.whatsAppMessage.updateMany({ where: { companyId, id: job.id, status: 'sending' }, data: { status: 'sent', sentAt: new Date(), lastError: null } });
          } catch (error) {
            const noWhatsApp = (error as Error).message === 'not_registered';
            const attempts = job.attempts + 1;
            await this.db.whatsAppMessage.updateMany({ where: { companyId, id: job.id, status: 'sending' }, data: {
              status: noWhatsApp || attempts >= 5 ? 'failed' : 'pending',
              lastError: noWhatsApp ? 'O número do cliente não foi encontrado no WhatsApp.' : attempts >= 5
                ? 'O envio falhou após cinco tentativas. Verifique a conexão e clique em Tentar novamente.'
                : 'Não foi possível confirmar o envio. Uma nova tentativa será feita enquanto houver conexão.',
              nextAttemptAt: new Date(Date.now() + Math.min(600_000, 30_000 * 2 ** (attempts - 1))),
            } });
          }
        }
      }
    } finally { this.working = false; }
  }
}

@Controller('api/whatsapp-bot')
@Perms('empresa.gerenciar')
export class WhatsAppBotController {
  constructor(private bot: WhatsAppBotService, private audit: AuditService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(@CurrentUser() user: SessionUser) {
    return { settings: await this.bot.settings(user.companyId), status: this.bot.status(user.companyId), variables: WHATSAPP_VARIABLES };
  }
  @Get('status')
  @Header('Cache-Control', 'no-store')
  status(@CurrentUser() user: SessionUser) { return this.bot.status(user.companyId); }
  @Get('messages')
  @Header('Cache-Control', 'no-store')
  async messages(@CurrentUser() user: SessionUser) { return { rows: await this.bot.messages(user.companyId) }; }
  @Patch()
  async save(@CurrentUser() user: SessionUser, @Body() dto: WhatsAppSettingsDto, @Req() req: Request) {
    const settings = await this.bot.save(user.companyId, dto);
    await this.audit.log(user, 'update', 'WhatsAppBot', undefined, { enabled: settings.enabled }, req.ip);
    return settings;
  }
  @Post('connect')
  async connect(@CurrentUser() user: SessionUser, @Req() req: Request) {
    const status = await this.bot.connect(user.companyId);
    await this.audit.log(user, 'connect', 'WhatsAppBot', undefined, undefined, req.ip);
    return status;
  }
  @Post('disconnect')
  async disconnect(@CurrentUser() user: SessionUser, @Req() req: Request) {
    const status = await this.bot.disconnect(user.companyId);
    await this.audit.log(user, 'disconnect', 'WhatsAppBot', undefined, undefined, req.ip);
    return status;
  }
  @Post('messages/:id/retry')
  retry(@CurrentUser() user: SessionUser, @Param('id') id: string) { return this.bot.retry(user.companyId, id); }
}

@Global()
@Module({ controllers: [WhatsAppBotController], providers: [BaileysDriver, WhatsAppBotService], exports: [WhatsAppBotService] })
export class WhatsAppBotModule {}
