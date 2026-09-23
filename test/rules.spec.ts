/**
 * Verificação das regras que não podem quebrar: isolamento entre empresas,
 * permissões, cálculo da venda, pagamento dividido, troco, estoque, caixa,
 * cancelamento, idempotência e concorrência entre dois caixas.
 * Roda contra um banco descartável (data/test.db): `npm test`.
 */
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.PLAN_BASICO_LIMITS = '3,1,1,500';
process.env.PLAN_PRO_LIMITS = '10,2,3,5000';
process.env.PLAN_PRO_FEATURES = 'relatorios.basico,export,importacao';
// gateway PIX falso (sobe no main) — nunca chama a Blue de verdade
process.env.PIX_API_BASE = 'http://127.0.0.1:47811';
process.env.UPLOADS_DIR = require('path').join(__dirname, '..', 'data', 'test-uploads');

import * as assert from 'assert';
import { execSync } from 'child_process';
import { createServer } from 'http';
import { rmSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser = require('cookie-parser');
import { PrismaClient } from '@prisma/client';
import { itemTotalCents, periodRange, roundQty, toCsv, addMonths } from '../src/common/util';

let failures = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✔ ${name}`))
    .catch((e) => { failures++; console.error(`  ✘ ${name}\n     ${e.message}`); });
}

/** Cliente HTTP mínimo que guarda o cookie de sessão. */
function client(base: string) {
  let cookie = '';
  const call = async (method: string, path: string, body?: any) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'lojaflow',
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* csv/texto puro */ }
    return { status: res.status, data };
  };
  return call;
}

async function main() {
  rmSync(process.env.UPLOADS_DIR!, { recursive: true, force: true });
  for (const f of ['test.db', 'test.db-journal', 'test.db-wal', 'test.db-shm']) {
    rmSync(join(__dirname, '..', 'data', f), { force: true });
  }
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: join(__dirname, '..'), stdio: 'ignore', env: process.env,
  });

  const pixMock = { paid: false, charges: 0 };
  const gateway = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/transactions') {
      pixMock.charges++;
      return res.end(JSON.stringify({ id: 'tx_teste', status: 'waiting_payment',
        pix: { qrcode: '00020126580014br.gov.bcb.pix0136teste', expirationDate: '2026-12-31T23:59:00Z' } }));
    }
    res.end(JSON.stringify({ id: 'tx_teste', status: pixMock.paid ? 'paid' : 'waiting_payment',
      paidAt: pixMock.paid ? '2026-09-23T10:00:00Z' : null, pix: { qrcode: '00020126580014br.gov.bcb.pix0136teste' } }));
  }).listen(47811);

  const db = new PrismaClient();
  const { syncPlans } = await import('../src/modules/billing');
  await syncPlans(db as any);

  const { AppModule } = await import('../src/app.module');
  const app = await NestFactory.create(AppModule, { logger: ['error'], abortOnError: false });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0);
  const base = (await app.getUrl()).replace('[::1]', 'localhost');

  // ---------- funções puras ----------
  console.log('\nCálculos');
  await check('total do item = preço × quantidade − desconto', () => {
    assert.equal(itemTotalCents(1000, 3), 3000);
    assert.equal(itemTotalCents(1000, 3, 500), 2500);
    assert.equal(itemTotalCents(3990, 0.742), 2961); // venda por peso arredonda em centavos
  });
  await check('quantidade por peso tem 3 casas', () => {
    assert.equal(roundQty(0.7425), 0.743);
    assert.equal(roundQty(2), 2);
  });
  await check('desconto nunca deixa o item negativo', () => {
    assert.equal(itemTotalCents(1000, 1, 5000), 0);
  });
  await check('período "mes" começa no dia 1', () => {
    const { from, to } = periodRange('mes');
    assert.ok(from.endsWith('-01'));
    assert.ok(from <= to);
  });
  await check('addMonths respeita fim de mês', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  });
  await check('CSV sai com ; e BOM (Excel pt-BR)', () => {
    const csv = toCsv([{ a: 1, b: 'x;y' }]);
    assert.ok(csv.startsWith('﻿'));
    assert.ok(csv.includes('"x;y"'));
  });

  // ---------- contas ----------
  console.log('\nContas e acesso');
  const api = client(base);
  const loja = await api('POST', '/api/auth/register', {
    companyName: 'Loja Teste', name: 'Dona Ana', email: 'ana@teste.com', password: 'senha1234',
  });
  await check('cadastro cria empresa, filial, PDV e formas de pagamento', async () => {
    assert.equal(loja.status, 201);
    const me = await api('GET', '/api/auth/me');
    assert.equal(me.data.user.role, 'proprietario');
    assert.equal(me.data.branches.length, 1);
    const registers = await api('GET', '/api/cash/registers');
    assert.equal(registers.data.rows.length, 1);
    const methods = await api('GET', '/api/company/payment-methods');
    assert.ok(methods.data.rows.length >= 4);
  });

  await check('assinatura nasce em teste (trial)', async () => {
    const sub = await api('GET', '/api/subscription');
    assert.equal(sub.data.subscription.status, 'trial');
  });

  const outra = client(base);
  await outra('POST', '/api/auth/register', {
    companyName: 'Concorrente', name: 'Beto', email: 'beto@teste.com', password: 'senha1234',
  });

  // ---------- catálogo e estoque ----------
  console.log('\nCatálogo e estoque');
  const cat = await api('POST', '/api/categories', { name: 'Bebidas' });
  const prod = await api('POST', '/api/products', {
    name: 'Refrigerante 2L', priceCents: 1000, costCents: 600, barcode: '7891000100103',
    categoryId: cat.data.id, initialStock: 10, minStock: 2,
  });
  const productId = prod.data.id;

  await check('estoque inicial gera movimentação de entrada', async () => {
    const movs = await api('GET', `/api/stock/movements?productId=${productId}`);
    assert.equal(movs.data.rows.length, 1);
    assert.equal(movs.data.rows[0].type, 'ENTRADA');
    assert.equal(movs.data.rows[0].after, 10);
  });

  await check('código de barras duplicado é recusado', async () => {
    const dup = await api('POST', '/api/products', {
      name: 'Outro', priceCents: 500, barcode: '7891000100103',
    });
    assert.equal(dup.status, 400);
  });

  await check('empresa não enxerga produto de outra empresa', async () => {
    const alheio = await outra('GET', `/api/products/${productId}`);
    assert.equal(alheio.status, 404);
    const lista = await outra('GET', '/api/products');
    assert.equal(lista.data.total, 0);
  });

  await check('leitura por código de barras acha o produto exato', async () => {
    const r = await api('GET', '/api/products/lookup?q=7891000100103');
    assert.equal(r.data.exact, true);
    assert.equal(r.data.rows[0].id, productId);
    assert.equal(r.data.rows[0].stock, 10);
  });

  await check('ajuste de estoque registra saldo anterior e novo', async () => {
    const r = await api('POST', '/api/stock/adjust', {
      productId, quantity: 12, reason: 'Inventário',
    });
    assert.equal(r.data.before, 10);
    assert.equal(r.data.after, 12);
    assert.equal(r.data.type, 'AJUSTE');
  });

  // ---------- caixa ----------
  console.log('\nCaixa');
  const registers = await api('GET', '/api/cash/registers');
  const registerId = registers.data.rows[0].id;

  await check('venda sem caixa aberto é recusada', async () => {
    const r = await api('POST', '/api/sales', {
      items: [{ productId, quantity: 1 }],
      payments: [{ paymentMethodId: 'x', amountCents: 1000 }],
    });
    assert.equal(r.status, 400);
  });

  const abertura = await api('POST', '/api/cash/open', { registerId, openingCents: 10000 });
  const sessionId = abertura.data.id;
  await check('abertura de caixa registra o fundo de troco', async () => {
    assert.equal(abertura.status, 201);
    const atual = await api('GET', '/api/cash/current');
    assert.equal(atual.data.summary.cashOnHandCents, 10000);
  });

  await check('o mesmo PDV não abre duas vezes', async () => {
    const r = await api('POST', '/api/cash/open', { registerId, openingCents: 0 });
    assert.equal(r.status, 400);
  });

  // ---------- venda ----------
  console.log('\nVenda');
  const methods = (await api('GET', '/api/company/payment-methods')).data.rows;
  const dinheiro = methods.find((m: any) => m.type === 'dinheiro');
  const pix = methods.find((m: any) => m.type === 'pix');
  const credito = methods.find((m: any) => m.type === 'credito');

  await check('pagamento diferente do total é recusado', async () => {
    const r = await api('POST', '/api/sales', {
      items: [{ productId, quantity: 2 }],
      payments: [{ paymentMethodId: dinheiro.id, amountCents: 1000 }],
    });
    assert.equal(r.status, 400);
    assert.ok(/Pagamentos/.test(r.data.message));
  });

  const venda = await api('POST', '/api/sales', {
    items: [{ productId, quantity: 2 }],
    payments: [
      { paymentMethodId: dinheiro.id, amountCents: 1000, receivedCents: 2000 },
      { paymentMethodId: pix.id, amountCents: 1000 },
    ],
  });

  await check('pagamento dividido soma exatamente o total', async () => {
    assert.equal(venda.status, 201);
    assert.equal(venda.data.totalCents, 2000);
    assert.equal(venda.data.payments.length, 2);
  });

  await check('troco = recebido em dinheiro − parte paga em dinheiro', () => {
    assert.equal(venda.data.changeCents, 1000);
  });

  await check('venda guarda preço e custo do momento (snapshot)', async () => {
    await api('PATCH', `/api/products/${productId}`, { name: 'Refrigerante 2L', priceCents: 1500, costCents: 900 });
    const detalhe = await api('GET', `/api/sales/${venda.data.id}`);
    assert.equal(detalhe.data.sale.items[0].unitPriceCents, 1000);
    assert.equal(detalhe.data.sale.items[0].unitCostCents, 600);
  });

  await check('venda baixa o estoque com movimentação do tipo VENDA', async () => {
    const p = await api('GET', `/api/products/${productId}`);
    assert.equal(p.data.product.stock, 10); // 12 − 2
    const movs = await api('GET', `/api/stock/movements?productId=${productId}&type=VENDA`);
    assert.equal(movs.data.rows[0].quantity, 2);
  });

  await check('venda entra no caixa e no financeiro', async () => {
    const atual = await api('GET', '/api/cash/current');
    assert.equal(atual.data.summary.totals.salesCents, 2000);
    assert.equal(atual.data.summary.cashOnHandCents, 11000); // 10000 + 1000 em dinheiro
    const fin = await api('GET', '/api/finance/entries?type=RECEITA&pageSize=100');
    assert.ok(fin.data.rows.some((r: any) => r.amountCents === 2000 && r.status === 'paid'));
  });

  await check('estoque insuficiente devolve 409 e não grava a venda', async () => {
    const antes = (await api('GET', '/api/sales')).data.total;
    const r = await api('POST', '/api/sales', {
      items: [{ productId, quantity: 999 }],
      payments: [{ paymentMethodId: pix.id, amountCents: 1498500 }],
    });
    assert.equal(r.status, 409);
    const depois = (await api('GET', '/api/sales')).data.total;
    assert.equal(antes, depois);
  });

  await check('parcelamento acima do limite da forma é recusado', async () => {
    const r = await api('POST', '/api/sales', {
      items: [{ productId, quantity: 1 }],
      payments: [{ paymentMethodId: credito.id, amountCents: 1500, installments: 99 }],
    });
    assert.equal(r.status, 400);
  });

  await check('mesma chave de idempotência não cria duas vendas', async () => {
    const key = 'chave-teste-123';
    const body = {
      items: [{ productId, quantity: 1 }],
      payments: [{ paymentMethodId: pix.id, amountCents: 1500 }],
      idempotencyKey: key,
    };
    const a = await api('POST', '/api/sales', body);
    const b = await api('POST', '/api/sales', body);
    assert.equal(a.data.id, b.data.id);
    const vendas = await api('GET', '/api/sales');
    assert.equal(vendas.data.rows.filter((s: any) => s.id === a.data.id).length, 1);
  });

  await check('duas vendas simultâneas do último item: uma passa, outra falha', async () => {
    const unico = await api('POST', '/api/products', {
      name: 'Item único', priceCents: 500, costCents: 100, initialStock: 1,
    });
    const venda1 = api('POST', '/api/sales', {
      items: [{ productId: unico.data.id, quantity: 1 }],
      payments: [{ paymentMethodId: pix.id, amountCents: 500 }],
    });
    const venda2 = api('POST', '/api/sales', {
      items: [{ productId: unico.data.id, quantity: 1 }],
      payments: [{ paymentMethodId: pix.id, amountCents: 500 }],
    });
    const [r1, r2] = await Promise.all([venda1, venda2]);
    const ok = [r1, r2].filter((r) => r.status === 201);
    const erro = [r1, r2].filter((r) => r.status !== 201);
    assert.equal(ok.length, 1, `esperado 1 venda ok, veio ${ok.length}`);
    assert.equal(erro.length, 1);
    const p = await api('GET', `/api/products/${unico.data.id}`);
    assert.equal(p.data.product.stock, 0);
  });

  // ---------- cancelamento ----------
  console.log('\nCancelamento e auditoria');
  await check('cancelar devolve estoque, estorna caixa e mantém a venda', async () => {
    const antes = await api('GET', `/api/products/${productId}`);
    const r = await api('POST', `/api/sales/${venda.data.id}/cancel`, { reason: 'Cliente desistiu' });
    assert.equal(r.status, 201);
    assert.equal(r.data.status, 'CANCELLED');

    const depois = await api('GET', `/api/products/${productId}`);
    assert.equal(depois.data.product.stock, antes.data.product.stock + 2);

    const detalhe = await api('GET', `/api/sales/${venda.data.id}`);
    assert.equal(detalhe.data.sale.cancelReason, 'Cliente desistiu');

    const fin = await api('GET', '/api/finance/entries?status=cancelled');
    assert.ok(fin.data.rows.some((e: any) => e.saleId === venda.data.id));
  });

  await check('venda cancelada não conta no faturamento', async () => {
    const rel = await api('GET', '/api/reports/sales?groupBy=day');
    const totalVendas = (await api('GET', '/api/sales?status=COMPLETED')).data.summary.totalCents;
    assert.equal(rel.data.totals.totalCents, totalVendas);
  });

  await check('cancelamento e desconto ficam na auditoria', async () => {
    const audit = await api('GET', '/api/audit?action=cancel');
    assert.ok(audit.data.rows.some((r: any) => r.entityId === venda.data.id));
  });

  // ---------- sangria, suprimento e fechamento ----------
  console.log('\nSangria, suprimento e fechamento');
  await check('sangria maior que o dinheiro do caixa é recusada', async () => {
    const r = await api('POST', `/api/cash/sessions/${sessionId}/sangria`, {
      amountCents: 99999999, reason: 'teste',
    });
    assert.equal(r.status, 400);
  });

  await check('sangria e suprimento mudam o esperado em dinheiro', async () => {
    const antes = (await api('GET', '/api/cash/current')).data.summary.cashOnHandCents;
    await api('POST', `/api/cash/sessions/${sessionId}/sangria`, { amountCents: 3000, reason: 'Cofre' });
    await api('POST', `/api/cash/sessions/${sessionId}/suprimento`, { amountCents: 1000, reason: 'Troco' });
    const depois = (await api('GET', '/api/cash/current')).data.summary.cashOnHandCents;
    assert.equal(depois, antes - 3000 + 1000);
  });

  await check('fechamento guarda esperado, contado e diferença', async () => {
    const esperado = (await api('GET', '/api/cash/current')).data.summary.cashOnHandCents;
    const r = await api('POST', `/api/cash/sessions/${sessionId}/close`, {
      countedCents: esperado - 500, notes: 'faltou troco',
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.expectedCents, esperado);
    assert.equal(r.data.differenceCents, -500);
    const sessao = await api('GET', `/api/cash/sessions/${sessionId}`);
    assert.equal(sessao.data.session.status, 'closed');
  });

  await check('caixa fechado não aceita mais sangria', async () => {
    const r = await api('POST', `/api/cash/sessions/${sessionId}/sangria`, { amountCents: 100, reason: 'x' });
    assert.equal(r.status, 400);
  });

  // ---------- permissões ----------
  console.log('\nPermissões e limites');
  await api('POST', '/api/users', {
    name: 'Operadora', email: 'caixa@teste.com', password: 'senha1234', role: 'caixa',
  });
  const caixa = client(base);
  await caixa('POST', '/api/auth/login', { email: 'caixa@teste.com', password: 'senha1234' });

  await check('perfil caixa não gerencia usuários nem empresa', async () => {
    assert.equal((await caixa('GET', '/api/users')).status, 403);
    assert.equal((await caixa('PATCH', '/api/company', { name: 'Hack' })).status, 403);
  });

  await check('perfil caixa não cancela venda', async () => {
    const r = await caixa('POST', `/api/sales/${venda.data.id}/cancel`, { reason: 'tentando' });
    assert.equal(r.status, 403);
  });

  await check('desconto acima do limite exige permissão', async () => {
    const abertura2 = await caixa('POST', '/api/cash/open', { registerId, openingCents: 0 });
    assert.equal(abertura2.status, 201);
    const r = await caixa('POST', '/api/sales', {
      items: [{ productId, quantity: 1 }],
      discountCents: 900, // 60% de desconto sobre 1500
      payments: [{ paymentMethodId: pix.id, amountCents: 600 }],
    });
    assert.equal(r.status, 403);
  });

  await check('preço alterado pelo caixa é bloqueado', async () => {
    const r = await caixa('POST', '/api/sales', {
      items: [{ productId, quantity: 1, unitPriceCents: 1 }],
      payments: [{ paymentMethodId: pix.id, amountCents: 1 }],
    });
    assert.equal(r.status, 403);
  });

  await check('limite de usuários do plano é respeitado', async () => {
    // plano básico do trial permite 3 usuários; já existem 2
    const r1 = await api('POST', '/api/users', {
      name: 'Terceiro', email: 't3@teste.com', password: 'senha1234', role: 'estoquista',
    });
    const r2 = await api('POST', '/api/users', {
      name: 'Quarto', email: 't4@teste.com', password: 'senha1234', role: 'estoquista',
    });
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 403);
    assert.ok(/Limite do plano/.test(r2.data.message));
  });

  await check('CSRF: mutação sem o header próprio é bloqueada', async () => {
    const res = await fetch(`${base}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sem header' }),
    });
    assert.equal(res.status, 403);
  });

  await check('sessão de outra empresa não lê vendas alheias', async () => {
    const r = await outra('GET', `/api/sales/${venda.data.id}`);
    assert.equal(r.status, 404);
  });

  // ---------- financeiro ----------
  console.log('\nFinanceiro');
  await check('conta a pagar em parcelas gera um lançamento por mês', async () => {
    const r = await api('POST', '/api/finance/entries', {
      type: 'DESPESA', description: 'Aluguel', amountCents: 100000,
      dueDate: '2026-01-10', repeat: 3,
    });
    assert.equal(r.data.rows.length, 3);
    assert.deepEqual(r.data.rows.map((x: any) => x.dueDate), ['2026-01-10', '2026-02-10', '2026-03-10']);
  });

  await check('baixa marca a conta como paga na data', async () => {
    const lista = await api('GET', '/api/finance/entries?type=DESPESA&status=pending');
    const alvo = lista.data.rows[0];
    const r = await api('POST', `/api/finance/entries/${alvo.id}/pay`, {});
    assert.equal(r.data.status, 'paid');
    assert.ok(r.data.paidAt);
  });

  await check('lançamento de venda não pode ser editado à mão', async () => {
    const fin = await api('GET', '/api/finance/entries?type=RECEITA&pageSize=100');
    const daVenda = fin.data.rows.find((r: any) => r.saleId);
    const r = await api('PATCH', `/api/finance/entries/${daVenda.id}`, {
      type: 'RECEITA', description: 'x', amountCents: 1, dueDate: '2026-01-01',
    });
    assert.equal(r.status, 400);
  });


  // ---------- vendedor externo ----------
  console.log('\nVendedor externo');
  const bearer = (token?: string) => async (method: string, path: string, body?: any) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const pedido = await api('POST', '/api/products', { name: 'Caderno', priceCents: 2000, costCents: 800, initialStock: 5 });
  const vendedor = await api('POST', '/api/sellers', {
    name: 'Carlos Rua', phone: '11999990000', email: 'carlos@teste.com',
    cpf: '529.982.247-25', username: 'carlos.rua', password: 'senha1234',
  });

  await check('cadastro valida CPF e usuário único', async () => {
    assert.equal(vendedor.status, 201);
    const cpfRuim = await api('POST', '/api/sellers', { name: 'X', cpf: '111.111.111-11', username: 'xx.yy', password: 'senha1234' });
    assert.equal(cpfRuim.status, 400);
    const repetido = await outra('POST', '/api/sellers', { name: 'Yuri', cpf: '11144477735', username: 'carlos.rua', password: 'senha1234' });
    assert.equal(repetido.status, 409);
  });

  const login = await bearer()('POST', '/api/ext/auth/login', { username: 'Carlos.Rua', password: 'senha1234' });
  const ext = bearer(login.data?.token);
  await check('login por usuário e senha devolve token Bearer', async () => {
    assert.equal(login.status, 201);
    assert.equal(login.data.tokenType, 'Bearer');
    const errado = await bearer()('POST', '/api/ext/auth/login', { username: 'carlos.rua', password: 'errada123' });
    assert.equal(errado.status, 401);
    assert.equal((await bearer()('GET', '/api/ext/products')).status, 401);
    const porEmail = await bearer()('POST', '/api/ext/auth/login', { username: 'Carlos@Teste.com', password: 'senha1234' });
    assert.equal(porEmail.status, 201);
  });

  await check('token do vendedor não abre o ERP', async () => {
    const r = await fetch(`${base}/api/auth/me`, { headers: { cookie: `lf_session=${login.data.token}` } });
    assert.equal(r.status, 401);
  });

  await check('produtos e clientes vêm completos, sem paginação', async () => {
    const produtos = await ext('GET', '/api/ext/products');
    assert.equal(produtos.data.total, produtos.data.rows.length);
    assert.equal(produtos.data.rows.find((p: any) => p.id === pedido.data.id).stock, 5);
    assert.ok(!('costCents' in produtos.data.rows[0]));
    const clientes = await ext('GET', '/api/ext/customers');
    assert.equal(clientes.data.total, clientes.data.rows.length);
  });

  const metodos = await ext('GET', '/api/ext/payment-methods');
  const pixExt = metodos.data.rows.find((m: any) => m.type === 'pix');
  const lote = {
    sales: [
      { idempotencyKey: 'aparelho-0001', soldAt: '2026-01-05 10:30', offline: true, paidInApp: true, appPaymentMethod: 'pix', appPaymentRef: 'E123',
        items: [{ productId: pedido.data.id, quantity: 2 }], payments: [{ paymentMethodId: pixExt.id, amountCents: 4000 }] },
      { idempotencyKey: 'aparelho-0002', offline: false, paidInApp: false,
        items: [{ productId: pedido.data.id, quantity: 99 }], payments: [{ paymentMethodId: pixExt.id, amountCents: 198000 }] },
    ],
  };
  const envio = await ext('POST', '/api/ext/sales/batch', lote);

  await check('lote grava cada venda de forma independente', async () => {
    assert.equal(envio.status, 201);
    assert.equal(envio.data.accepted, 1);
    assert.equal(envio.data.rejected, 1);
    assert.equal(envio.data.results[1].ok, false); // sem estoque
    const produtos = await ext('GET', '/api/ext/products');
    assert.equal(produtos.data.rows.find((p: any) => p.id === pedido.data.id).stock, 3);
  });

  await check('reenviar o lote não duplica a venda', async () => {
    const again = await ext('POST', '/api/ext/sales/batch', { sales: [lote.sales[0]] });
    assert.equal(again.data.results[0].saleId, envio.data.results[0].saleId);
    const lista = await ext('GET', '/api/ext/sales?page=1&pageSize=10');
    assert.equal(lista.data.total, 1);
    assert.equal(lista.data.rows[0].soldAt, '2026-01-05 10:30');
    assert.equal(lista.data.rows[0].seller.name, 'Carlos Rua');
  });

  await check('lote guarda se foi offline e se foi pago no app', async () => {
    const lista = await ext('GET', '/api/ext/sales');
    const v = lista.data.rows[0];
    assert.equal(v.offline, true);
    assert.equal(v.paidInApp, true);
    assert.equal(v.appPaymentMethod, 'pix');
    assert.equal(v.appPaymentRef, 'E123');
    // estoque restante do caderno é 3: uma unidade por venda
    const umItem = { items: [{ productId: pedido.data.id, quantity: 1 }], payments: [{ paymentMethodId: pixExt.id, amountCents: 2000 }] };
    const boleto = await ext('POST', '/api/ext/sales/batch', { sales: [{ ...lote.sales[0], idempotencyKey: 'aparelho-0005',
      appPaymentMethod: 'boleto', appPaymentRef: '000123', dueDate: '2026-10-10', ...umItem }] });
    const naoPaga = await ext('POST', '/api/ext/sales/batch', { sales: [{ ...lote.sales[0], idempotencyKey: 'aparelho-0006',
      paidInApp: false, appPaymentMethod: undefined, ...umItem }] });
    const fin = await api('GET', '/api/finance/entries?type=RECEITA&pageSize=100');
    const lanc = (id: string) => fin.data.rows.find((r: any) => r.saleId === id);
    assert.equal(lanc(envio.data.results[0].saleId).status, 'paid'); // PIX pago no app
    const b = lanc(boleto.data.results[0].saleId);
    assert.equal(b.status, 'pending');
    assert.equal(b.dueDate, '2026-10-10');
    assert.equal(b.instrument, 'boleto');
    assert.equal(lanc(naoPaga.data.results[0].saleId).status, 'pending');
    // ERP: lista marca como não paga e filtra
    const naoPagas = await api('GET', '/api/sales?paid=no&pageSize=100');
    assert.ok(naoPagas.data.rows.every((v: any) => v.paymentStatus === 'unpaid'));
    assert.ok(naoPagas.data.rows.some((v: any) => v.id === boleto.data.results[0].saleId));
    assert.equal(naoPagas.data.rows.find((v: any) => v.id === boleto.data.results[0].saleId).dueDate, '2026-10-10');
    assert.equal(naoPagas.data.summary.unpaidCount, naoPagas.data.total);
    const pagas = await api('GET', '/api/sales?paid=yes&pageSize=100');
    assert.ok(!pagas.data.rows.some((v: any) => v.id === boleto.data.results[0].saleId));
    assert.equal((await api('GET', `/api/sales/${envio.data.results[0].saleId}`)).data.sale.paymentStatus, 'paid');
    const semMetodo = await ext('POST', '/api/ext/sales/batch', { sales: [{ ...lote.sales[0], idempotencyKey: 'aparelho-0003', appPaymentMethod: undefined }] });
    assert.equal(semMetodo.status, 400);
    const metodoRuim = await ext('POST', '/api/ext/sales/batch', { sales: [{ ...lote.sales[0], idempotencyKey: 'aparelho-0004', appPaymentMethod: 'cheque' }] });
    assert.equal(metodoRuim.status, 400);
  });

  await check('venda PIX online devolve QR e copia e cola', async () => {
    const semPix = await ext('POST', '/api/ext/sales/pix', { idempotencyKey: 'pix-venda-000', items: [{ productId: pedido.data.id, quantity: 1 }] });
    assert.equal(semPix.status, 400); // PIX da loja desligado
    const empresa = await db.company.findFirstOrThrow({ where: { name: 'Loja Teste' } });
    await db.company.update({ where: { id: empresa.id }, data: { pixEnabled: true, pixSecretKey: 'sk_teste' } });

    assert.equal((await ext('GET', '/api/ext/me')).data.pix, true); // padrão: ligado
    await api('PATCH', '/api/company/settings', { extSellerPix: false });
    const desligado = await ext('POST', '/api/ext/sales/pix', { idempotencyKey: 'pix-venda-002', items: [{ productId: pedido.data.id, quantity: 1 }] });
    assert.equal(desligado.status, 400);
    assert.equal((await ext('GET', '/api/ext/me')).data.pix, false);
    await api('PATCH', '/api/company/settings', { extSellerPix: true });

    const body = { idempotencyKey: 'pix-venda-001', items: [{ productId: pedido.data.id, quantity: 1 }] };
    const r = await ext('POST', '/api/ext/sales/pix', body);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.totalCents, 2000);
    assert.equal(r.data.pix.qrcode, '00020126580014br.gov.bcb.pix0136teste');
    assert.ok(r.data.pix.qrImage.startsWith('data:image/png;base64,'));
    const again = await ext('POST', '/api/ext/sales/pix', body);
    assert.equal(again.data.saleId, r.data.saleId);
    assert.equal(pixMock.charges, 1); // repetir não gera outra cobrança

    const fin = async () => (await api('GET', '/api/finance/entries?type=RECEITA&pageSize=100')).data.rows
      .find((x: any) => x.saleId === r.data.saleId);
    assert.equal((await fin()).status, 'pending');
    const aguardando = await ext('GET', `/api/ext/sales/${r.data.saleId}/pix`);
    assert.equal(aguardando.data.paid, false);

    pixMock.paid = true;
    const pago = await ext('GET', `/api/ext/sales/${r.data.saleId}/pix`);
    assert.equal(pago.data.paid, true);
    assert.equal((await fin()).status, 'paid');
    const venda = await ext('GET', `/api/ext/sales/${r.data.saleId}`);
    assert.equal(venda.data.paidInApp, true);
    assert.equal(venda.data.appPaymentRef, 'tx_teste');
  });

  await check('comprovante de pagamento anexado à venda', async () => {
    const saleId = envio.data.results[0].saleId;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const enviar = (buf: Buffer, nome: string, id = saleId) => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(buf)]), nome);
      form.append('notes', 'PIX do cliente');
      return fetch(`${base}/api/ext/sales/${id}/receipts`, {
        method: 'POST', body: form, headers: { Authorization: `Bearer ${login.data.token}` },
      });
    };
    assert.equal((await enviar(Buffer.from('<script>alert(1)</script>'), 'x.png')).status, 400); // conteúdo não é imagem
    assert.equal((await enviar(png, 'c.png', 'nao-existe')).status, 404);
    const r = await enviar(png, 'comprovante.png');
    assert.equal(r.status, 201);
    const att = await r.json();
    assert.equal(att.mimeType, 'image/png');
    assert.equal(att.notes, 'PIX do cliente');

    const lista = await ext('GET', `/api/ext/sales/${saleId}/receipts`);
    assert.equal(lista.data.rows.length, 1);
    const arq = await fetch(`${base}/api/ext/receipts/${att.id}/file`, { headers: { Authorization: `Bearer ${login.data.token}` } });
    assert.equal(arq.headers.get('content-type'), 'image/png');
    assert.ok(Buffer.from(await arq.arrayBuffer()).equals(png));
    // ERP da loja enxerga; outra empresa não
    assert.equal((await api('GET', `/api/sales/${saleId}/attachments`)).data.rows.length, 1);
    assert.equal((await api('GET', `/api/sales/${saleId}`)).data.sale.attachments.length, 1);
    assert.equal((await outra('GET', `/api/sales/attachments/${att.id}/file`)).status, 404);
  });

  await check('vendedor bloqueado perde o acesso na hora', async () => {
    await api('PATCH', `/api/sellers/${vendedor.data.id}`, {
      name: 'Carlos Rua', cpf: '52998224725', username: 'carlos.rua', active: false,
    });
    assert.equal((await ext('GET', '/api/ext/sales')).status, 401);
  });

  await app.close();
  gateway.close();
  await db.$disconnect();

  console.log(failures ? `\n${failures} verificação(ões) falharam\n` : '\nTudo certo\n');
  process.exit(failures ? 1 : 0);
}

main();
