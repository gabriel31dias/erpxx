import { Global, Module, InternalServerErrorException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Modelos que pertencem a uma empresa: toda query em massa precisa filtrar por companyId. */
const TENANT_MODELS = new Set([
  'Branch', 'User', 'Seller', 'Invite', 'Category', 'Product', 'Stock', 'StockMovement', 'Supplier',
  'StockEntry', 'StockEntryItem', 'Customer', 'PaymentMethod', 'Sale', 'SaleItem', 'SalePayment', 'SaleAttachment',
  'CashRegister', 'CashSession', 'CashMovement', 'FinancialCategory', 'FinanceEntry',
  'Notification', 'AuditLog', 'Subscription', 'IdempotencyKey',
]);

const GUARDED_OPS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'updateMany', 'deleteMany', 'count',
  'aggregate', 'groupBy',
]);

export function hasCompanyFilter(where: any): boolean {
  if (!where || typeof where !== 'object') return false;
  if (where.companyId !== undefined) return true;
  for (const key of ['AND', 'OR']) {
    const branch = where[key];
    if (Array.isArray(branch) && branch.some(hasCompanyFilter)) return true;
    if (branch && !Array.isArray(branch) && hasCompanyFilter(branch)) return true;
  }
  return false;
}

/**
 * Rede de segurança do multi-tenant: consulta em massa num modelo de empresa sem
 * `companyId` no where explode em vez de vazar dados. Buscas por id (findUnique)
 * continuam exigindo conferência de companyId no service.
 * ponytail: checagem no client; migrar p/ RLS no Postgres se algum dia houver
 * acesso ao banco fora desta API.
 */
/**
 * SQLite aceita um escritor por vez. Abrir várias conexões não paraleliza nada:
 * só troca a espera ordenada por SQLITE_BUSY e "socket timeout" com vários
 * caixas vendendo junto. Uma conexão só = fila no pool, na ordem, sem erro.
 * ponytail: parâmetros na URL; no Postgres a função devolve a URL intacta e o
 * pool volta a ser paralelo de verdade.
 */
export function urlDoBanco(url = process.env.DATABASE_URL ?? ''): string {
  if (!url.startsWith('file:')) return url;
  const [caminho, query] = url.split('?');
  const params = new URLSearchParams(query);
  params.set('connection_limit', '1');
  params.set('socket_timeout', '30');
  params.set('pool_timeout', '30');
  return `${caminho}?${params}`;
}

export function createPrisma() {
  const base = new PrismaClient({ datasourceUrl: urlDoBanco() });
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model && TENANT_MODELS.has(model) && GUARDED_OPS.has(operation)) {
            if (!hasCompanyFilter((args as any)?.where)) {
              throw new InternalServerErrorException(
                `Consulta sem isolamento de empresa: ${model}.${operation}`,
              );
            }
          }
          return query(args);
        },
      },
    },
  });
}

/**
 * SQLite deixa um escritor por vez. Com vários caixas fechando venda no mesmo
 * segundo, a transação espera a vez — e o padrão do Prisma (2s de espera, 5s de
 * execução) derrubava a venda em vez de deixá-la aguardar.
 * ponytail: esperar é melhor que errar; no Postgres, escritas paralelas de
 * verdade tornam esses tetos irrelevantes.
 */
export const TX = { maxWait: 15_000, timeout: 20_000 };

export type Db = ReturnType<typeof createPrisma>;
/** Cliente dentro de uma transação: mesmos modelos, sem $transaction aninhado. */
export type Tx = Omit<Db, '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>;
export const PRISMA = 'PRISMA';

@Global()
@Module({
  providers: [
    {
      provide: PRISMA,
      useFactory: async () => {
        const db = createPrisma();
        // WAL: leitura não trava enquanto um caixa grava a venda
        await db.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
        await db.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
        // dois caixas fechando venda ao mesmo tempo esperam a vez em vez de dar SQLITE_BUSY
        await db.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
        return db;
      },
    },
  ],
  exports: [PRISMA],
})
export class PrismaModule {}
