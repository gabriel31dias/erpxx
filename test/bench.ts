/**
 * Teste de carga honesto: quanto o SQLite aguenta neste desenho.
 * Sobe a API num banco descartável (data/bench.db) e mede venda por venda —
 * a operação mais pesada do sistema (transação com estoque, caixa e financeiro).
 *
 * Rode com: npm run bench
 */
process.env.JWT_SECRET = 'bench';
process.env.NODE_ENV = 'test';
process.env.THROTTLE_LIMIT = '1000000'; // o teto por IP não é o objeto da medição

import { execSync } from 'child_process';
import { rmSync, statSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser = require('cookie-parser');
import { PrismaClient } from '@prisma/client';

const DB = join(__dirname, '..', 'data', 'bench.db');

function client(base: string) {
  let cookie = '';
  return async (method: string, path: string, body?: any) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'lojaflow',
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* texto puro */ }
    return { status: res.status, data };
  };
}

const pct = (valores: number[], p: number) =>
  valores.slice().sort((a, b) => a - b)[Math.min(valores.length - 1, Math.floor((valores.length * p) / 100))];

const linha = (rotulo: string, valor: string) => console.log(`  ${rotulo.padEnd(38, '.')} ${valor}`);

async function main() {
  for (const f of ['bench.db', 'bench.db-journal', 'bench.db-wal', 'bench.db-shm']) {
    rmSync(join(__dirname, '..', 'data', f), { force: true });
  }
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: join(__dirname, '..'), stdio: 'ignore', env: process.env,
  });

  const db = new PrismaClient();
  const { syncPlans } = await import('../src/modules/billing');
  await syncPlans(db as any);
  await db.plan.updateMany({ data: { maxProducts: -1, maxUsers: -1, maxRegisters: -1, maxBranches: -1 } });

  const { AppModule } = await import('../src/app.module');
  const app = await NestFactory.create(AppModule, { logger: ['error'], abortOnError: false });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0);
  const base = (await app.getUrl()).replace('[::1]', 'localhost');

  // ---------- preparo ----------
  const api = client(base);
  await api('POST', '/api/auth/register', {
    companyName: 'Loja Carga', name: 'Operador', email: 'carga@teste.com', password: 'senha1234',
  });
  const metodos = (await api('GET', '/api/company/payment-methods')).data.rows;
  const pix = metodos.find((m: any) => m.type === 'pix');
  const registers = (await api('GET', '/api/cash/registers')).data.rows;
  await api('POST', '/api/cash/open', { registerId: registers[0].id, openingCents: 0 });

  const PRODUTOS = 2000;
  console.log(`\nCatálogo: ${PRODUTOS} produtos…`);
  const empresa = await db.company.findFirstOrThrow();
  const filial = await db.branch.findFirstOrThrow({ where: { companyId: empresa.id } });
  let t0 = Date.now();
  // catálogo entra direto pelo banco: o que se quer medir é a venda
  await db.product.createMany({
    data: Array.from({ length: PRODUTOS }, (_, i) => ({
      companyId: empresa.id, name: `Produto ${i}`, priceCents: 100 + i, costCents: 50 + i,
      barcode: `789${String(i).padStart(10, '0')}`, sku: `SKU${i}`,
    })),
  });
  const produtos = await db.product.findMany({ where: { companyId: empresa.id }, select: { id: true, priceCents: true } });
  await db.stock.createMany({
    data: produtos.map((p) => ({ companyId: empresa.id, branchId: filial.id, productId: p.id, quantity: 1000000 })),
  });
  const ids = produtos.map((p) => p.id);
  const preco = new Map(produtos.map((p) => [p.id, p.priceCents]));
  linha('produtos gravados por segundo', `${Math.round(PRODUTOS / ((Date.now() - t0) / 1000))}`);

  // ---------- venda sequencial (um caixa) ----------
  const VENDAS = 300;
  console.log(`\nVenda a venda (1 caixa), ${VENDAS} vendas com 3 itens cada:`);
  const tempos: number[] = [];
  t0 = Date.now();
  for (let i = 0; i < VENDAS; i++) {
    const itens = [0, 1, 2].map((k) => ({ productId: ids[(i * 3 + k) % ids.length], quantity: 1 }));
    const total = itens.reduce((s, it) => s + preco.get(it.productId)!, 0);
    const t = Date.now();
    const r = await api('POST', '/api/sales', {
      items: itens,
      payments: [{ paymentMethodId: pix.id, amountCents: total }],
    });
    if (r.status !== 201) throw new Error(`venda falhou: ${JSON.stringify(r.data).slice(0, 120)}`);
    tempos.push(Date.now() - t);
  }
  const seg = (Date.now() - t0) / 1000;
  linha('vendas por segundo', `${(VENDAS / seg).toFixed(1)}`);
  linha('tempo mediano da venda', `${pct(tempos, 50)} ms`);
  linha('tempo no percentil 95', `${pct(tempos, 95)} ms`);
  linha('pior caso', `${Math.max(...tempos)} ms`);

  // ---------- caixas simultâneos ----------
  for (const caixas of [4, 8, 16]) {
    const RODADAS = 10;
    const t = Date.now();
    let ok = 0;
    let conflito = 0;
    for (let r = 0; r < RODADAS; r++) {
      const lote = Array.from({ length: caixas }, (_, c) => {
        const id = ids[(r * caixas + c) % ids.length];
        return api('POST', '/api/sales', {
          items: [{ productId: id, quantity: 1 }],
          payments: [{ paymentMethodId: pix.id, amountCents: preco.get(id)! }],
        });
      });
      const res = await Promise.all(lote);
      ok += res.filter((x) => x.status === 201).length;
      conflito += res.filter((x) => x.status === 409).length;
    }
    const total = (Date.now() - t) / 1000;
    linha(`${caixas} caixas simultâneos`,
      `${(ok / total).toFixed(1)} vendas/s · ${ok} ok · ${conflito} conflito(s)`);
  }

  // ---------- leitura com volume ----------
  console.log('\nLeitura com o banco carregado:');
  const medirGet = async (rotulo: string, path: string) => {
    const t = Date.now();
    const r = await api('GET', path);
    linha(rotulo, `${Date.now() - t} ms${r.status !== 200 ? ` (status ${r.status})` : ''}`);
  };
  await medirGet('dashboard do mês', '/api/reports/dashboard?period=mes');
  await medirGet('relatório por produto', '/api/reports/sales?groupBy=product&period=mes');
  await medirGet('lista de vendas (página 1)', '/api/sales?pageSize=20');
  await medirGet('busca de produto por código', '/api/products/lookup?q=7890000001000');
  await medirGet('posição de estoque', '/api/stock?pageSize=20');

  const vendas = await db.sale.count();
  const itens = await db.saleItem.count();
  const movs = await db.stockMovement.count();
  const tamanho = statSync(DB).size / 1024 / 1024;
  console.log('\nVolume gerado:');
  linha('vendas', String(vendas));
  linha('itens de venda', String(itens));
  linha('movimentações de estoque', String(movs));
  linha('tamanho do arquivo .db', `${tamanho.toFixed(1)} MB`);
  linha('bytes por venda (com item/mov/financeiro)', `${Math.round((tamanho * 1024 * 1024) / vendas)} B`);

  await app.close();
  await db.$disconnect();
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
