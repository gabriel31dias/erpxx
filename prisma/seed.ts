/**
 * Dados de demonstração: 1 empresa, 4 usuários, 40 produtos, clientes,
 * fornecedores, entradas de mercadoria, 30 dias de vendas com caixa aberto e
 * fechado e lançamentos financeiros. Roda com `npm run seed` (recria a demo).
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { addDays, nowIn, slugify, today } from '../src/common/util';
import { syncPlans } from '../src/modules/billing';
import { DEFAULT_FINANCIAL_CATEGORIES, DEFAULT_PAYMENT_METHODS } from '../src/modules/auth';
import { DEFAULT_SETTINGS } from '../src/common/core';

const db = new PrismaClient();

// gerador previsível: o mesmo seed sempre gera a mesma demo
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));

const CATEGORIES = ['Bebidas', 'Alimentos', 'Limpeza', 'Higiene', 'Padaria', 'Hortifruti'];

// nome, categoria, unidade, custo, preço, estoque, código de barras
const PRODUCTS: [string, string, string, number, number, number][] = [
  ['Refrigerante cola 2L', 'Bebidas', 'UN', 550, 899, 48],
  ['Refrigerante guaraná 2L', 'Bebidas', 'UN', 520, 849, 36],
  ['Cerveja lata 350ml', 'Bebidas', 'UN', 250, 449, 120],
  ['Água mineral 500ml', 'Bebidas', 'UN', 90, 250, 90],
  ['Suco de laranja 1L', 'Bebidas', 'UN', 480, 799, 24],
  ['Energético 250ml', 'Bebidas', 'UN', 550, 999, 30],
  ['Arroz tipo 1 5kg', 'Alimentos', 'UN', 1890, 2790, 40],
  ['Feijão carioca 1kg', 'Alimentos', 'UN', 620, 999, 50],
  ['Açúcar refinado 1kg', 'Alimentos', 'UN', 330, 549, 45],
  ['Café torrado 500g', 'Alimentos', 'UN', 1120, 1799, 35],
  ['Óleo de soja 900ml', 'Alimentos', 'UN', 590, 899, 60],
  ['Macarrão espaguete 500g', 'Alimentos', 'UN', 320, 549, 55],
  ['Molho de tomate 340g', 'Alimentos', 'UN', 210, 399, 42],
  ['Leite integral 1L', 'Alimentos', 'UN', 380, 599, 72],
  ['Farinha de trigo 1kg', 'Alimentos', 'UN', 380, 649, 28],
  ['Sal refinado 1kg', 'Alimentos', 'UN', 150, 299, 30],
  ['Detergente 500ml', 'Limpeza', 'UN', 180, 349, 60],
  ['Sabão em pó 1kg', 'Limpeza', 'UN', 890, 1449, 32],
  ['Água sanitária 1L', 'Limpeza', 'UN', 290, 499, 40],
  ['Desinfetante 2L', 'Limpeza', 'UN', 620, 1099, 25],
  ['Esponja multiuso', 'Limpeza', 'PCT', 190, 399, 48],
  ['Papel higiênico 12un', 'Higiene', 'PCT', 1290, 1990, 36],
  ['Sabonete 90g', 'Higiene', 'UN', 150, 299, 80],
  ['Creme dental 90g', 'Higiene', 'UN', 380, 699, 44],
  ['Shampoo 350ml', 'Higiene', 'UN', 990, 1699, 22],
  ['Desodorante aerosol', 'Higiene', 'UN', 890, 1590, 26],
  ['Pão francês', 'Padaria', 'KG', 990, 1890, 12],
  ['Pão de forma 500g', 'Padaria', 'UN', 620, 1099, 18],
  ['Bolo caseiro fatia', 'Padaria', 'UN', 350, 799, 10],
  ['Queijo mussarela', 'Padaria', 'KG', 3290, 4990, 8],
  ['Presunto cozido', 'Padaria', 'KG', 2890, 4290, 6],
  ['Banana prata', 'Hortifruti', 'KG', 390, 699, 25],
  ['Maçã gala', 'Hortifruti', 'KG', 690, 1190, 18],
  ['Tomate', 'Hortifruti', 'KG', 490, 899, 22],
  ['Batata inglesa', 'Hortifruti', 'KG', 390, 699, 30],
  ['Cebola', 'Hortifruti', 'KG', 350, 649, 20],
  ['Alface crespa', 'Hortifruti', 'UN', 190, 399, 15],
  ['Laranja pera', 'Hortifruti', 'KG', 290, 549, 28],
  ['Cenoura', 'Hortifruti', 'KG', 320, 599, 16],
  ['Ovos brancos 12un', 'Alimentos', 'PCT', 890, 1390, 30],
];

const CUSTOMERS = [
  'Ana Beatriz Souza', 'Carlos Eduardo Lima', 'Mariana Alves', 'Rafael Nogueira', 'Juliana Prado',
  'Fernando Castro', 'Patrícia Mendes', 'Bruno Carvalho', 'Camila Ribeiro', 'Thiago Moreira',
  'Larissa Ferraz', 'Gustavo Pinto', 'Renata Barros', 'Diego Almeida', 'Vanessa Rocha',
];

const SUPPLIERS = [
  ['Distribuidora Central Ltda', 'Central Distribuidora'],
  ['Atacadão do Norte S.A.', 'Atacadão do Norte'],
  ['Hortifruti Vale Verde', 'Vale Verde'],
  ['Bebidas Premium Distribuição', 'Bebidas Premium'],
];

async function main() {
  const plans = await syncPlans(db as any);
  const pro = plans.find((p) => p.code === 'pro') ?? plans[0];

  const slug = slugify('Mercadinho Bom Preço');
  const existing = await db.company.findUnique({ where: { slug } });
  if (existing) {
    await db.company.delete({ where: { id: existing.id } });
    console.log('empresa demo anterior removida');
  }

  const company = await db.company.create({
    data: {
      name: 'Mercadinho Bom Preço Comércio de Alimentos Ltda',
      tradeName: 'Mercadinho Bom Preço',
      slug,
      document: '12.345.678/0001-90',
      phone: '(11) 3222-1010', whatsapp: '(11) 99876-5432',
      email: 'contato@bompreco.com.br',
      zip: '01310-100', address: 'Av. Paulista', number: '1000', district: 'Bela Vista',
      city: 'São Paulo', state: 'SP',
      planId: pro.id, onboarded: true,
      settings: JSON.stringify({ ...DEFAULT_SETTINGS, maxDiscountPct: 10 }),
      subscriptions: {
        create: { planId: pro.id, status: 'active', amountCents: pro.priceCents, nextChargeAt: addDaysDate(20) },
      },
    },
  });

  const branch = await db.branch.create({
    data: {
      companyId: company.id, name: 'Loja Centro', isMain: true,
      document: '12.345.678/0001-90', phone: '(11) 3222-1010',
      address: 'Av. Paulista, 1000', city: 'São Paulo', state: 'SP',
    },
  });
  const branch2 = await db.branch.create({
    data: {
      companyId: company.id, name: 'Loja Vila Mariana',
      address: 'Rua Domingos de Morais, 250', city: 'São Paulo', state: 'SP',
    },
  });

  const registers = await Promise.all([
    db.cashRegister.create({ data: { companyId: company.id, branchId: branch.id, name: 'Caixa 1' } }),
    db.cashRegister.create({ data: { companyId: company.id, branchId: branch.id, name: 'Caixa 2' } }),
    db.cashRegister.create({ data: { companyId: company.id, branchId: branch2.id, name: 'Caixa Vila Mariana' } }),
  ]);

  await db.paymentMethod.createMany({
    data: [
      ...DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m, companyId: company.id })),
      { companyId: company.id, name: 'Vale alimentação', type: 'vale', sortOrder: 5 },
    ],
  });
  const methods = await db.paymentMethod.findMany({ where: { companyId: company.id } });
  const cash = methods.find((m) => m.type === 'dinheiro')!;
  const pix = methods.find((m) => m.type === 'pix')!;
  const debit = methods.find((m) => m.type === 'debito')!;
  const credit = methods.find((m) => m.type === 'credito')!;

  await db.financialCategory.createMany({
    data: DEFAULT_FINANCIAL_CATEGORIES.map((c) => ({ ...c, companyId: company.id })),
  });
  const finCats = await db.financialCategory.findMany({ where: { companyId: company.id } });
  const catVendas = finCats.find((c) => c.name === 'Vendas')!;

  const hash = await bcrypt.hash('senha1234', 12);
  const [owner, manager, cashier] = await Promise.all([
    db.user.create({ data: { companyId: company.id, name: 'Regina Prado', email: 'proprietaria@bompreco.com.br', passwordHash: hash, role: 'proprietario' } }),
    db.user.create({ data: { companyId: company.id, name: 'Marcos Antunes', email: 'gerente@bompreco.com.br', passwordHash: hash, role: 'gerente', branchId: branch.id } }),
    db.user.create({ data: { companyId: company.id, name: 'Paula Ferreira', email: 'caixa@bompreco.com.br', passwordHash: hash, role: 'caixa', branchId: branch.id } }),
  ]);
  await db.user.create({ data: { companyId: company.id, name: 'Jorge Nunes', email: 'estoque@bompreco.com.br', passwordHash: hash, role: 'estoquista', branchId: branch.id } });
  await db.user.create({ data: { companyId: company.id, name: 'Sônia Martins', email: 'financeiro@bompreco.com.br', passwordHash: hash, role: 'financeiro' } });

  const categories = new Map<string, string>();
  for (const name of CATEGORIES) {
    const c = await db.category.create({ data: { companyId: company.id, name } });
    categories.set(name, c.id);
  }

  const suppliers = [];
  for (const [name, tradeName] of SUPPLIERS) {
    suppliers.push(await db.supplier.create({
      data: {
        companyId: company.id, name, tradeName,
        document: `${int(10, 99)}.${int(100, 999)}.${int(100, 999)}/0001-${int(10, 99)}`,
        phone: `(11) 3${int(100, 999)}-${int(1000, 9999)}`,
        email: `contato@${slugify(tradeName)}.com.br`,
      },
    }));
  }

  const products = [];
  for (const [i, [name, category, unit, cost, price, stock]] of PRODUCTS.entries()) {
    const product = await db.product.create({
      data: {
        companyId: company.id, name, categoryId: categories.get(category)!,
        unit, saleType: unit === 'KG' ? 'WEIGHT' : 'UNIT',
        sku: `SKU${String(i + 1).padStart(4, '0')}`,
        barcode: `789${String(1000000 + i * 137).padStart(10, '0')}`,
        costCents: cost, priceCents: price,
        minStock: unit === 'KG' ? 5 : 10, maxStock: 200,
        brand: pick(['Bom Preço', 'Marca Líder', 'Selecionada', '']) || null,
      },
    });
    products.push(product);
    // estoque folgado: a demo tem 30 dias de vendas e não pode terminar zerada
    const inicial = stock * 4;
    await db.stock.create({ data: { companyId: company.id, branchId: branch.id, productId: product.id, quantity: inicial } });
    await db.stockMovement.create({
      data: {
        companyId: company.id, branchId: branch.id, productId: product.id, type: 'ENTRADA',
        quantity: inicial, before: 0, after: inicial, reason: 'Carga inicial de estoque',
        userId: owner.id, createdAtLocal: `${addDays(today(), -35)} 08:00`,
      },
    });
  }
  // dois produtos zerados e dois abaixo do mínimo para a tela de alertas ter conteúdo
  await db.stock.updateMany({ where: { branchId: branch.id, productId: products[28].id }, data: { quantity: 0 } });
  await db.stock.updateMany({ where: { branchId: branch.id, productId: products[30].id }, data: { quantity: 0 } });
  await db.stock.updateMany({ where: { branchId: branch.id, productId: products[24].id }, data: { quantity: 3 } });
  await db.stock.updateMany({ where: { branchId: branch.id, productId: products[19].id }, data: { quantity: 4 } });

  const customers = [];
  for (const name of CUSTOMERS) {
    customers.push(await db.customer.create({
      data: {
        companyId: company.id, name,
        phone: `(11) 9${int(1000, 9999)}-${int(1000, 9999)}`,
        document: `${int(100, 999)}.${int(100, 999)}.${int(100, 999)}-${int(10, 99)}`,
        email: `${slugify(name)}@email.com`,
      },
    }));
  }

  // ---------- entradas de mercadoria ----------
  for (let e = 0; e < 4; e++) {
    const supplier = suppliers[e % suppliers.length];
    const items = Array.from({ length: int(3, 6) }, () => {
      const product = pick(products);
      return { productId: product.id, quantity: int(10, 40), costCents: product.costCents };
    });
    const totalCents = items.reduce((s, i) => s + i.costCents * i.quantity, 0);
    const at = `${addDays(today(), -(e * 6 + 3))} 09:${String(int(10, 59)).padStart(2, '0')}`;
    const entry = await db.stockEntry.create({
      data: {
        companyId: company.id, branchId: branch.id, supplierId: supplier.id, userId: owner.id,
        document: `NF ${int(10000, 99999)}`, totalCents, createdAtLocal: at,
        items: { create: items.map((i) => ({ ...i, companyId: company.id })) },
      },
    });
    for (const item of items) {
      const stock = await db.stock.findUnique({
        where: { branchId_productId: { branchId: branch.id, productId: item.productId } },
      });
      const before = stock?.quantity ?? 0;
      await db.stock.update({
        where: { branchId_productId: { branchId: branch.id, productId: item.productId } },
        data: { quantity: before + item.quantity },
      });
      await db.stockMovement.create({
        data: {
          companyId: company.id, branchId: branch.id, productId: item.productId, type: 'ENTRADA',
          quantity: item.quantity, before, after: before + item.quantity,
          reason: 'Entrada de mercadoria', refType: 'StockEntry', refId: entry.id,
          userId: owner.id, createdAtLocal: at,
        },
      });
    }
    await db.financeEntry.create({
      data: {
        companyId: company.id, branchId: branch.id, type: 'DESPESA',
        description: `Compra de mercadoria · ${supplier.tradeName}`,
        amountCents: totalCents, dueDate: addDays(today(), int(-2, 20)),
        status: e < 2 ? 'paid' : 'pending', paidAt: e < 2 ? addDays(today(), -1) : null,
        categoryId: finCats.find((c) => c.name === 'Fornecedores')!.id,
        supplierId: supplier.id, createdById: owner.id,
      },
    });
  }

  // ---------- vendas dos últimos 30 dias ----------
  let saleNumber = 0;
  for (let d = 30; d >= 0; d--) {
    const day = addDays(today(), -d);
    const session = await db.cashSession.create({
      data: {
        companyId: company.id, branchId: branch.id, registerId: registers[0].id,
        operatorId: cashier.id, openingCents: 20000, openedAt: `${day} 08:00`,
        status: d === 0 ? 'open' : 'closed',
        closedAt: d === 0 ? null : `${day} 19:00`,
        movements: {
          create: {
            companyId: company.id, type: 'abertura', amountCents: 20000,
            description: 'Valor inicial (fundo de troco)', userId: cashier.id,
            createdAtLocal: `${day} 08:00`,
          },
        },
      },
    });

    let cashInSession = 20000;
    const salesToday = int(6, 14);
    for (let s = 0; s < salesToday; s++) {
      const at = `${day} ${String(int(8, 19)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}`;
      const itemCount = int(1, 6);
      const items = [];
      for (let n = 0; n < itemCount; n++) {
        const product = pick(products);
        const quantity = product.saleType === 'WEIGHT' ? Math.round(rnd() * 2000) / 1000 + 0.1 : int(1, 3);
        // demo não vende o que não tem: o estoque final precisa fazer sentido na tela
        const saldo = await db.stock.findUnique({
          where: { branchId_productId: { branchId: branch.id, productId: product.id } },
        });
        if (!saldo || saldo.quantity < quantity) continue;
        await db.stock.update({
          where: { branchId_productId: { branchId: branch.id, productId: product.id } },
          data: { quantity: Math.round((saldo.quantity - quantity) * 1000) / 1000 },
        });
        items.push({
          companyId: company.id, productId: product.id, name: product.name, unit: product.unit,
          quantity, unitPriceCents: product.priceCents, unitCostCents: product.costCents,
          discountCents: 0, totalCents: Math.round(product.priceCents * quantity),
          _before: saldo.quantity,
        });
      }
      if (!items.length) continue;
      const subtotal = items.reduce((sum, i) => sum + i.totalCents, 0);
      const discount = rnd() < 0.15 ? Math.round(subtotal * 0.05) : 0;
      const total = subtotal - discount;
      const method = pick([cash, cash, pix, debit, credit]);
      const received = method.id === cash.id ? Math.ceil(total / 500) * 500 : total;
      saleNumber++;

      const sale = await db.sale.create({
        data: {
          companyId: company.id, branchId: branch.id, cashSessionId: session.id,
          customerId: rnd() < 0.45 ? pick(customers).id : null,
          operatorId: cashier.id, number: saleNumber,
          status: rnd() < 0.03 ? 'CANCELLED' : 'COMPLETED',
          subtotalCents: subtotal, discountCents: discount, totalCents: total,
          costTotalCents: items.reduce((sum, i) => sum + Math.round(i.unitCostCents * i.quantity), 0),
          receivedCents: received, changeCents: received - total, soldAt: at,
          cancelReason: null,
          items: { create: items.map(({ _before, ...i }) => i) },
          payments: {
            create: {
              companyId: company.id, paymentMethodId: method.id, methodName: method.name,
              methodType: method.type, amountCents: total, installments: 1,
            },
          },
        },
      });
      if (sale.status === 'CANCELLED') {
        await db.sale.update({
          where: { id: sale.id },
          data: { cancelReason: 'Cliente desistiu da compra', cancelledById: cashier.id, cancelledAt: new Date() },
        });
        continue;
      }

      await db.cashMovement.create({
        data: {
          companyId: company.id, sessionId: session.id, type: 'venda', amountCents: total,
          paymentMethodId: method.id, description: `Venda #${saleNumber} · ${method.name}`,
          userId: cashier.id, refType: 'Sale', refId: sale.id, createdAtLocal: at,
        },
      });
      if (method.id === cash.id) cashInSession += total;

      await db.financeEntry.create({
        data: {
          companyId: company.id, branchId: branch.id, type: 'RECEITA',
          description: `Venda #${saleNumber}`, amountCents: total,
          dueDate: day, paidAt: day, status: 'paid', categoryId: catVendas.id,
          saleId: sale.id, paymentMethodId: method.id, createdById: cashier.id,
        },
      });

      for (const item of items) {
        const before = item._before;
        const after = Math.round((before - item.quantity) * 1000) / 1000;
        await db.stockMovement.create({
          data: {
            companyId: company.id, branchId: branch.id, productId: item.productId, type: 'VENDA',
            quantity: item.quantity, before, after, reason: `Venda #${saleNumber}`,
            refType: 'Sale', refId: sale.id, userId: cashier.id, createdAtLocal: at,
          },
        });
      }
    }

    // sangria no meio do dia e fechamento com pequena diferença
    if (d > 0) {
      const sangria = Math.min(cashInSession - 10000, 50000);
      if (sangria > 0) {
        await db.cashMovement.create({
          data: {
            companyId: company.id, sessionId: session.id, type: 'sangria', amountCents: -sangria,
            description: 'Retirada para o cofre', userId: manager.id, createdAtLocal: `${day} 15:00`,
          },
        });
        cashInSession -= sangria;
      }
      const counted = cashInSession + (rnd() < 0.3 ? int(-500, 500) : 0);
      await db.cashSession.update({
        where: { id: session.id },
        data: {
          expectedCents: cashInSession, countedCents: counted,
          differenceCents: counted - cashInSession,
          closingData: JSON.stringify({ byMethod: [], totals: { expectedCents: cashInSession } }),
        },
      });
    }
  }

  // despesas fixas do mês
  const fixed: [string, string, number][] = [
    ['Aluguel da loja', 'Aluguel', 480000],
    ['Energia elétrica', 'Água, luz e internet', 128000],
    ['Internet e telefone', 'Água, luz e internet', 29900],
    ['Folha de pagamento', 'Folha de pagamento', 1250000],
    ['Simples Nacional', 'Impostos', 320000],
  ];
  for (const [description, category, amountCents] of fixed) {
    await db.financeEntry.create({
      data: {
        companyId: company.id, branchId: branch.id, type: 'DESPESA', description, amountCents,
        dueDate: `${today().slice(0, 7)}-${String(int(5, 25)).padStart(2, '0')}`,
        status: rnd() < 0.5 ? 'paid' : 'pending',
        paidAt: rnd() < 0.5 ? today() : null,
        categoryId: finCats.find((c) => c.name === category)!.id, createdById: owner.id,
      },
    });
  }

  await db.notification.createMany({
    data: [
      { companyId: company.id, type: 'estoque_baixo', title: 'Estoque baixo', body: 'Shampoo 350ml está abaixo do mínimo.', link: '/estoque.html' },
      { companyId: company.id, type: 'sem_estoque', title: 'Produto sem estoque', body: 'Bolo caseiro fatia ficou zerado.', link: '/estoque.html' },
      { companyId: company.id, type: 'conta_vencendo', title: 'Conta a pagar', body: 'Aluguel da loja vence esta semana.', link: '/financeiro.html' },
    ],
  });

  console.log(`\nDemo criada: ${company.tradeName}`);
  console.log(`  ${products.length} produtos · ${saleNumber} vendas · ${customers.length} clientes`);
  console.log('  login: proprietaria@bompreco.com.br · senha1234');
  console.log(`  agora: ${nowIn()}\n`);
}

function addDaysDate(days: number) {
  return new Date(Date.now() + days * 86400_000);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
