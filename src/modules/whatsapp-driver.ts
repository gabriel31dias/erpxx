import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import pino from 'pino';
import { Db, PRISMA, TX } from '../common/prisma.service';

// Preserva o import ESM da biblioteca no backend compilado em CommonJS.
let library: Promise<any> | undefined;
export const loadBaileys = () => library ??= new Function('return import("@whiskeysockets/baileys")')();

function sessionKey() {
  const secret = process.env.WHATSAPP_SESSION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('Configure WHATSAPP_SESSION_KEY para guardar a sessão do WhatsApp.');
  return createHash('sha256').update(`lojaflow-whatsapp:${secret}`).digest();
}
export function encryptWhatsAppAuth(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sessionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}
export function decryptWhatsAppAuth(value: string) {
  const [version, iv, tag, ciphertext] = value.split(':');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Sessão do WhatsApp inválida.');
  const decipher = createDecipheriv('aes-256-gcm', sessionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

/** Auth SQL por empresa; BufferJSON mantém os buffers de criptografia do protocolo. */
export async function databaseWhatsAppAuth(db: Db, companyId: string, lib: any) {
  let active = true;
  let writing: Promise<unknown> = Promise.resolve();
  const read = async (key: string) => {
    await writing;
    const row = await db.whatsAppAuth.findUnique({ where: { companyId_key: { companyId, key } } });
    return row ? JSON.parse(decryptWhatsAppAuth(row.value), lib.BufferJSON.reviver) : null;
  };
  const write = (entries: { key: string; value: string | null }[]) => {
    const operation = writing.then(async () => {
      if (!active) return;
      await db.$transaction(async (tx) => {
        for (const { key, value } of entries) {
          if (value === null) await tx.whatsAppAuth.deleteMany({ where: { companyId, key } });
          else await tx.whatsAppAuth.upsert({
            where: { companyId_key: { companyId, key } },
            create: { companyId, key, value: encryptWhatsAppAuth(value) }, update: { value: encryptWhatsAppAuth(value) },
          });
        }
      }, TX);
    });
    writing = operation.catch(() => undefined);
    return operation;
  };
  const creds = await read('creds') ?? lib.initAuthCreds();
  const auth = {
    creds,
    keys: {
      get: async (type: string, ids: string[]) => {
        const pairs = await Promise.all(ids.map(async (id) => {
          let value = await read(`${type}:${id}`);
          if (type === 'app-state-sync-key' && value) value = lib.proto.Message.AppStateSyncKeyData.fromObject(value);
          return [id, value];
        }));
        return Object.fromEntries(pairs);
      },
      set: (data: Record<string, Record<string, unknown>>) => write(Object.entries(data).flatMap(([type, values]) =>
        Object.entries(values).map(([id, value]) => ({ key: `${type}:${id}`, value: value == null ? null : JSON.stringify(value, lib.BufferJSON.replacer) })))),
    },
  };
  return {
    auth,
    save: () => write([{ key: 'creds', value: JSON.stringify(creds, lib.BufferJSON.replacer) }]),
    stop: async () => { await writing; active = false; await writing; },
  };
}

export interface WhatsAppClient {
  socket: any;
  close: (logout: boolean) => Promise<void>;
}

@Injectable()
export class BaileysDriver {
  constructor(@Inject(PRISMA) private db: Db) {}

  async create(companyId: string, onUpdate: (update: any) => void, onError: () => void): Promise<WhatsAppClient> {
    const lib = await loadBaileys();
    const storage = await databaseWhatsAppAuth(this.db, companyId, lib);
    const logger = pino({ level: 'silent' });
    const socket = lib.default({
      auth: { ...storage.auth, keys: lib.makeCacheableSignalKeyStore(storage.auth.keys, logger) },
      logger, browser: lib.Browsers.ubuntu('LojaFlow'),
      markOnlineOnConnect: false, syncFullHistory: false, shouldSyncHistoryMessage: () => false,
      connectTimeoutMs: 30_000, defaultQueryTimeoutMs: 30_000,
      getMessage: async (key: any) => {
        if (!key.id) return undefined;
        const sent = await this.db.whatsAppMessage.findFirst({ where: { companyId, providerMessageId: key.id } });
        return sent ? { conversation: sent.message } : undefined;
      },
    });
    const save = () => { void storage.save().catch(onError); };
    socket.ev.on('creds.update', save);
    socket.ev.on('connection.update', onUpdate);
    return {
      socket,
      close: async (logout) => {
        socket.ev.off('creds.update', save);
        socket.ev.off('connection.update', onUpdate);
        await storage.stop();
        try { if (logout && socket.user) await socket.logout(); }
        finally { await socket.end(undefined); }
      },
    };
  }
}
