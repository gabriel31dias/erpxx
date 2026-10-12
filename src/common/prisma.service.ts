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
export function createPrisma() {
  const base = new PrismaClient();
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
 * Folga sobre o padrão do Prisma (2s de espera, 5s de execução): num pico de
 * caixas fechando venda, esperar a vez é melhor que derrubar a venda.
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
      useFactory: () => createPrisma(),
    },
  ],
  exports: [PRISMA],
})
export class PrismaModule {}
