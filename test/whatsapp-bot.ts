import * as assert from 'assert';
import { WhatsAppBotService } from '../src/modules/whatsapp-bot';
import { BaileysDriver, databaseWhatsAppAuth, decryptWhatsAppAuth, loadBaileys } from '../src/modules/whatsapp-driver';
import { whatsAppPhone } from '../src/modules/whatsapp-events';
import { PRISMA } from '../src/common/prisma.service';

export async function checkWhatsAppBot({ check, api, outra, caixa, garcom, moto1, app, db, novoPedido, pixMock }: any) {
  console.log('\nBoot Whats');
  const owner = await db.user.findFirstOrThrow({ where: { email: 'ana@teste.com' } });
  const companyId = owner.companyId;
  const other = await db.user.findFirstOrThrow({ where: { email: 'beto@teste.com' } });
  const bot = app.get(WhatsAppBotService) as WhatsAppBotService;
  const driver = app.get(BaileysDriver) as BaileysDriver;
  const guarded = app.get(PRISMA);
  const original = driver.create;
  const sends: any[] = [];
  let update: (event: any) => void = () => undefined;
  let rejectNumber = false;
  let failSend = false;
  const socket = {
    user: { id: '5511988887777:1@s.whatsapp.net', name: 'Loja Teste' },
    authState: { creds: { registered: false } },
    onWhatsApp: async (phone: string) => [{ exists: !rejectNumber, jid: `${phone}@s.whatsapp.net` }],
    sendMessage: async (jid: string, body: any, options: any) => {
      sends.push({ jid, body, id: options.messageId, failed: failSend });
      if (failSend) throw new Error('temporary_failure');
      return { key: { id: options.messageId } };
    },
  };
  driver.create = async (_companyId, onUpdate) => {
    update = onUpdate;
    return { socket, close: async () => undefined };
  };
  const waitState = async (expected: string) => {
    for (let i = 0; i < 80; i++) {
      if (bot.status(companyId).state === expected) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(bot.status(companyId).state, expected);
  };
  const jobsFor = (refId: string, event?: string) => db.whatsAppMessage.findMany({ where: { companyId, refId, ...(event ? { event } : {}) } });
  try {
    await check('bot começa desligado e somente quem gerencia a empresa configura e conecta', async () => {
      const initial = await api('GET', '/api/whatsapp-bot');
      assert.equal(initial.status, 200);
      assert.equal(initial.data.settings.enabled, false);
      assert.equal(initial.data.status.state, 'disconnected');
      for (const restricted of [caixa, garcom]) {
        for (const [method, path] of [['GET', ''], ['GET', '/status'], ['GET', '/messages'], ['PATCH', ''], ['POST', '/connect'], ['POST', '/disconnect']]) {
          assert.equal((await restricted(method, `/api/whatsapp-bot${path}`, method === 'GET' ? undefined : {})).status, 403);
        }
      }
      assert.equal(whatsAppPhone('(55) 99999-1234'), '5555999991234');
      assert.equal(whatsAppPhone('11999991234'), '5511999991234');
      assert.equal(whatsAppPhone('+1 (555) 123-4567'), '15551234567');
      assert.equal(whatsAppPhone('abc11999991234'), null);
      assert.equal(whatsAppPhone('123'), null);
    });

    await check('configuração valida variáveis e fica isolada por empresa', async () => {
      assert.equal((await api('PATCH', '/api/whatsapp-bot', { purchaseTemplate: 'Olá {segredo}' })).status, 400);
      assert.equal((await api('PATCH', '/api/whatsapp-bot', { receivedTemplate: '   ' })).status, 400);
      assert.equal((await api('PATCH', '/api/whatsapp-bot', { enabled: null })).status, 400);
      assert.equal((await api('PATCH', '/api/whatsapp-bot', { purchaseTemplate: null })).status, 400);
      assert.equal((await api('PATCH', '/api/whatsapp-bot', { dispatchedTemplate: 'Olá {cliente' })).status, 400);
      const saved = await api('PATCH', '/api/whatsapp-bot', { enabled: true, purchaseTemplate: 'Olá {cliente}, compra #{numero} na {loja}: {total}. {itens}' });
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.equal(saved.data.enabled, true);
      assert.equal((await outra('GET', '/api/whatsapp-bot')).data.settings.enabled, false);
      assert.equal(saved.data.autoConnect, undefined);
      assert.equal(saved.data.value, undefined);
    });

    await check('sessão SQL preserva buffers cifrados, atualiza chaves e não vaza entre empresas', async () => {
      const lib = await loadBaileys();
      const storage = await databaseWhatsAppAuth(guarded, companyId, lib);
      await storage.save();
      await storage.auth.keys.set({ session: { peer: { key: Buffer.from('private-test-key') } } });
      const stored = await db.whatsAppAuth.findMany({ where: { companyId } });
      assert.ok(stored.length >= 2);
      assert.ok(stored.every((row: any) => row.value.startsWith('v1:') && !row.value.includes('private-test-key')));
      assert.doesNotThrow(() => JSON.parse(decryptWhatsAppAuth(stored.find((row: any) => row.key === 'creds').value), lib.BufferJSON.reviver));
      const restored = await databaseWhatsAppAuth(guarded, companyId, lib);
      assert.deepEqual(restored.auth.creds.signedIdentityKey.public, storage.auth.creds.signedIdentityKey.public);
      assert.deepEqual((await restored.auth.keys.get('session', ['peer'])).peer.key, Buffer.from('private-test-key'));
      const foreign = await databaseWhatsAppAuth(guarded, other.companyId, lib);
      assert.equal((await foreign.auth.keys.get('session', ['peer'])).peer, null);
      await restored.auth.keys.set({ session: { peer: null } });
      assert.equal((await restored.auth.keys.get('session', ['peer'])).peer, null);
      await storage.stop(); await restored.stop(); await foreign.stop();
    });

    await check('conexão mostra QR, confirma telefone e não revela credenciais', async () => {
      assert.equal((await api('POST', '/api/whatsapp-bot/connect')).status, 201);
      update({ qr: 'qr-de-teste-nao-conecta-conta-real' });
      await waitState('qr');
      const qr = await api('GET', '/api/whatsapp-bot/status');
      assert.match(qr.data.qrCode, /^data:image\/png;base64,/);
      assert.equal(qr.data.creds, undefined);
      socket.authState.creds.registered = true;
      update({ connection: 'open' });
      await waitState('connected');
      const online = await api('GET', '/api/whatsapp-bot/status');
      assert.equal(online.data.phone, '5511988887777');
      assert.equal(online.data.qrCode, null);
    });

    let purchaseId: string;
    await check('avisos desativados não geram mensagens novas nem envio retroativo', async () => {
      await api('PATCH', '/api/whatsapp-bot', { receivedEnabled: false });
      const individual = await novoPedido({ lat: -23.5, lng: -46.6 });
      assert.equal(individual.status, 201, JSON.stringify(individual.data));
      assert.equal((await jobsFor(individual.data.id)).length, 0);
      await api('PATCH', '/api/whatsapp-bot', { receivedEnabled: true, enabled: false });
      const disabled = await novoPedido({ lat: -23.5, lng: -46.6 });
      assert.equal(disabled.status, 201, JSON.stringify(disabled.data));
      assert.equal((await jobsFor(disabled.data.id)).length, 0);
      await api('PATCH', '/api/whatsapp-bot', { enabled: true });
      assert.equal((await jobsFor(disabled.data.id)).length, 0);
    });
    await check('compra gera uma notificação, inclusive quando a venda é reenviada', async () => {
      const customer = (await api('POST', '/api/customers', { name: 'Cliente Bot', phone: '11999991234', whatsapp: '11988881234' })).data;
      const product = (await api('POST', '/api/products', { name: 'Produto Bot', priceCents: 1000, initialStock: 100 })).data;
      const methods = (await api('GET', '/api/company/payment-methods')).data.rows;
      const cash = methods.find((method: any) => method.type === 'dinheiro');
      const body = { customerId: customer.id, idempotencyKey: 'boot-whats-purchase', items: [{ productId: product.id, quantity: 1 }], payments: [{ paymentMethodId: cash.id, amountCents: 1000 }] };
      const sale = await api('POST', '/api/sales', body);
      assert.equal(sale.status, 201, JSON.stringify(sale.data));
      purchaseId = sale.data.id;
      assert.equal((await api('POST', '/api/sales', body)).data.id, purchaseId);
      const jobs = await jobsFor(purchaseId, 'purchase');
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].phone, '5511988881234');
      assert.match(jobs[0].message, /Cliente Bot/);
      assert.match(jobs[0].message, /Produto Bot/);
      const card = methods.find((method: any) => method.type === 'credito');
      const pending = await api('POST', '/api/sales', { ...body, idempotencyKey: 'boot-whats-terminal', terminalId: 'BOOT-TEST', payments: [{ paymentMethodId: card.id, amountCents: 1000 }] });
      assert.equal(pending.status, 201, JSON.stringify(pending.data));
      assert.equal((await jobsFor(pending.data.id)).length, 0);
      const approved = await api('POST', `/api/sales/${pending.data.id}/payment-status`, { terminalId: 'BOOT-TEST', status: 'approved' });
      assert.equal(approved.status, 200, JSON.stringify(approved.data));
      await api('POST', `/api/sales/${pending.data.id}/payment-status`, { terminalId: 'BOOT-TEST', status: 'approved' });
      assert.equal((await jobsFor(pending.data.id)).length, 1);
    });

    await check('delivery gera recebimento e despacho pela tela de pedidos sem duplicação', async () => {
      const order = await novoPedido({ lat: -23.5, lng: -46.6 });
      assert.equal(order.status, 201, JSON.stringify(order.data));
      assert.equal((await jobsFor(order.data.id, 'received')).length, 1);
      for (let i = 0; i < 2; i++) {
        const changed = await api('PATCH', `/api/menu/orders/${order.data.id}/status`, { status: 'delivering' });
        assert.equal(changed.status, 200, JSON.stringify(changed.data));
      }
      assert.equal((await jobsFor(order.data.id, 'dispatched')).length, 1);
      const pickup = await novoPedido({ delivery_type: 'pickup' });
      assert.equal(pickup.status, 201, JSON.stringify(pickup.data));
      assert.equal((await jobsFor(pickup.data.id)).length, 0);
    });

    await check('aceite repetido do motoboy dispara o despacho somente uma vez', async () => {
      const order = await novoPedido({ lat: -23.5, lng: -46.6 });
      assert.equal((await api('PATCH', `/api/menu/orders/${order.data.id}/status`, { status: 'ready' })).status, 200);
      const accepted = await moto1('POST', `/api/courier/orders/${order.data.id}/accept`);
      assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
      assert.equal((await moto1('POST', `/api/courier/orders/${order.data.id}/accept`)).status, 200);
      assert.equal((await jobsFor(order.data.id, 'dispatched')).length, 1);
    });

    await check('PIX só gera recebimento após pagamento confirmado', async () => {
      const wasPaid = pixMock.paid;
      try {
        pixMock.paid = false;
        const order = await novoPedido({ payment_method: 'pix', lat: -23.5, lng: -46.6 });
        assert.equal(order.status, 201, JSON.stringify(order.data));
        assert.equal((await jobsFor(order.data.id)).length, 0);
        pixMock.paid = true;
        const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
        // As rotas públicas consultam o gateway e inserem o evento na mesma transação.
        const result = await fetch(`http://localhost:${new URL(await app.getUrl()).port}/api/public/orders?ids=${order.data.id}`);
        assert.equal(result.status, 200);
        assert.equal((await jobsFor(order.data.id, 'received')).length, 1);
        assert.ok(company.slug);
      } finally { pixMock.paid = wasPaid; }
    });

    await check('fila pausa desligada, envia por ordem e não repete envio já confirmado', async () => {
      await api('PATCH', '/api/whatsapp-bot', { enabled: false });
      await bot.processQueue();
      assert.equal(sends.length, 0);
      await api('PATCH', '/api/whatsapp-bot', { enabled: true });
      await Promise.all([bot.processQueue(), bot.processQueue()]);
      const sent = await db.whatsAppMessage.findMany({ where: { companyId, status: 'sent' } });
      assert.ok(sent.length >= 7, JSON.stringify(sent));
      assert.equal(new Set(sends.map((message) => message.id)).size, sends.length);
      const count = sends.length;
      await bot.processQueue();
      assert.equal(sends.length, count);
      assert.equal((await jobsFor(purchaseId))[0].status, 'sent');
      assert.equal((await outra('GET', '/api/whatsapp-bot/messages')).data.rows.length, 0);
    });

    await check('pedido cancelado antes do envio não recebe notificação', async () => {
      const order = await novoPedido({ lat: -23.5, lng: -46.6 });
      await api('POST', `/api/menu/orders/${order.data.id}/cancel`, { reason: 'Cliente desistiu' });
      const before = sends.length;
      await bot.processQueue();
      assert.equal(sends.length, before);
      assert.equal((await jobsFor(order.data.id))[0].status, 'cancelled');
    });

    await check('número ausente no WhatsApp falha e só a própria empresa pode tentar novamente', async () => {
      const order = await novoPedido({ lat: -23.5, lng: -46.6 });
      rejectNumber = true;
      await bot.processQueue();
      const job = (await jobsFor(order.data.id))[0];
      assert.equal(job.status, 'failed');
      assert.equal(job.attempts, 1);
      assert.equal((await outra('POST', `/api/whatsapp-bot/messages/${job.id}/retry`)).status, 400);
      rejectNumber = false;
      assert.equal((await api('POST', `/api/whatsapp-bot/messages/${job.id}/retry`)).status, 201);
      await bot.processQueue();
      assert.equal((await jobsFor(order.data.id))[0].status, 'sent');
    });

    await check('erro transitório guarda tentativa e reaproveita o id da mensagem na nova tentativa', async () => {
      const order = await novoPedido({ lat: -23.5, lng: -46.6 });
      failSend = true;
      await bot.processQueue();
      const job = (await jobsFor(order.data.id))[0];
      assert.equal(job.status, 'pending');
      assert.equal(job.attempts, 1);
      assert.ok(job.nextAttemptAt > new Date());
      failSend = false;
      await db.whatsAppMessage.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(0) } });
      await bot.processQueue();
      const sent = (await jobsFor(order.data.id))[0];
      assert.equal(sent.status, 'sent');
      assert.equal(sent.attempts, 2);
      assert.equal(sends.filter((message) => message.id === job.providerMessageId).length, 2);
    });

    await check('sessão revogada apaga credenciais e exige novo QR; desconexão é explícita', async () => {
      update({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
      await waitState('disconnected');
      // O estado fica visível antes da limpeza SQL terminar; a rota aguarda o lock.
      await api('POST', '/api/whatsapp-bot/disconnect');
      assert.equal(await db.whatsAppAuth.count({ where: { companyId } }), 0);
      assert.equal((await db.whatsAppBot.findUniqueOrThrow({ where: { companyId } })).autoConnect, false);
      assert.equal((await api('GET', '/api/whatsapp-bot/status')).data.qrCode, null);
    });
  } finally {
    rejectNumber = failSend = false;
    await bot.disconnect(companyId);
    driver.create = original;
  }
}
