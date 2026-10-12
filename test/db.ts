import { PrismaClient } from '@prisma/client';

/**
 * Apaga tudo no banco de teste antes de recriar o schema. Só aceita banco com
 * nome terminado em `_test`: um TEST_DATABASE_URL apontado por engano pra
 * produção para aqui, não zera.
 */
export async function zerarBanco() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina TEST_DATABASE_URL (banco descartável: é zerado).');
  const nome = new URL(url).pathname.slice(1);
  if (!nome.endsWith('_test')) throw new Error(`TEST_DATABASE_URL aponta pra "${nome}"; o nome precisa terminar em _test.`);
  const db = new PrismaClient();
  await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await db.$executeRawUnsafe('CREATE SCHEMA public');
  await db.$disconnect();
}
