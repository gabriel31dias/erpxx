/**
 * Praças da cozinha: para onde vai cada item do pedido e como as fichas de cada praça
 * mandam no status do pedido. Funções soltas (db ou tx) para o cardápio e a tela da cozinha.
 *
 * Praça do item = do produto → da categoria → Cozinha padrão; `kitchenSkip` não vai para tela nenhuma.
 * A praça é gravada no item quando o pedido entra: mudar o cadastro no meio do serviço não mexe
 * no que já está sendo preparado.
 */
import type { MenuOrder, Prisma } from '@prisma/client';
import type { Db, Tx } from '../common/prisma.service';
import type { OrderItem } from './menu';

export const DEFAULT_STATION_NAME = 'Cozinha';
const KITCHEN_STATUSES = ['pending', 'preparing', 'ready'];

/** A Cozinha padrão da empresa; nasce na primeira vez que alguém precisa dela. Fora de transação. */
export async function ensureDefaultStation(db: Db, companyId: string) {
  const found = await db.kitchenStation.findFirst({ where: { companyId, isDefault: true } });
  if (found) return found;
  try {
    return await db.kitchenStation.create({
      data: { companyId, name: DEFAULT_STATION_NAME, isDefault: true, defaultFor: companyId },
    });
  } catch {
    // outra requisição criou ao mesmo tempo (defaultFor é único)
    return db.kitchenStation.findFirstOrThrow({ where: { companyId, isDefault: true } });
  }
}

/** Item gravado antes das praças não tem a chave: vai para a Cozinha padrão. */
export const stationOf = (item: OrderItem, defaultId: string) =>
  ('stationId' in item ? item.stationId : defaultId) ?? null;

/** Grava a praça em cada item do pedido. `null` = não vai para a cozinha. */
export async function routeItems(db: Db | Tx, companyId: string, defaultId: string, items: OrderItem[]): Promise<OrderItem[]> {
  const [products, active] = await Promise.all([
    db.product.findMany({
      where: { companyId, id: { in: [...new Set(items.map((i) => i.productId))] } },
      select: { id: true, stationId: true, kitchenSkip: true, category: { select: { stationId: true } } },
    }),
    db.kitchenStation.findMany({ where: { companyId, active: true }, select: { id: true } }),
  ]);
  const ativas = new Set(active.map((s) => s.id));
  return items.map((item) => {
    const p = products.find((x) => x.id === item.productId);
    if (p?.kitchenSkip) return { ...item, stationId: null };
    const escolhida = p?.stationId || p?.category?.stationId;
    // praça desativada não some com o item: cai na Cozinha padrão
    return { ...item, stationId: escolhida && ativas.has(escolhida) ? escolhida : defaultId };
  });
}

/** Uma ficha por praça que tem item no pedido. */
export const ticketsFor = (companyId: string, items: OrderItem[]) =>
  [...new Set(items.map((i) => i.stationId).filter((s): s is string => !!s))]
    .map((stationId) => ({ companyId, stationId }));

/** Status do pedido pelas fichas: pronto só quando todas as praças terminam. */
function statusFromTickets(tickets: { status: string }[]) {
  if (tickets.every((t) => t.status === 'ready')) return 'ready';
  if (tickets.some((t) => t.status !== 'pending')) return 'preparing';
  return 'pending';
}

/**
 * Recalcula o status do pedido depois de mexer nas fichas. Só enquanto ele está na cozinha:
 * servido, entregue ou cancelado não volta.
 */
export async function syncOrder(tx: Tx | Db, orderId: string): Promise<MenuOrder> {
  const order = await tx.menuOrder.findUniqueOrThrow({ where: { id: orderId }, include: { tickets: true } });
  const { tickets, ...o } = order;
  if (!tickets.length || !KITCHEN_STATUSES.includes(o.status)) return o;
  const status = statusFromTickets(tickets);
  if (status === o.status) return o;
  const now = new Date();
  return tx.menuOrder.update({
    where: { id: orderId },
    data: {
      status,
      ...(status !== 'pending' && !o.acceptedAt ? { acceptedAt: now } : {}),
      ...(status === 'ready' ? { readyAt: now } : {}),
    },
  });
}

/** Caixa/gerente mudou o pedido inteiro na tela de pedidos: as fichas acompanham. */
export async function ticketsFollow(tx: Tx | Db, companyId: string, orderId: string, status: string) {
  const now = new Date();
  const of = { companyId, orderId };
  if (status === 'preparing') {
    await tx.kitchenTicket.updateMany({ where: { ...of, status: 'pending' }, data: { status, acceptedAt: now } });
  } else if (status === 'ready') {
    await tx.kitchenTicket.updateMany({ where: { ...of, status: 'pending' }, data: { acceptedAt: now } });
    await tx.kitchenTicket.updateMany({ where: { ...of, status: { not: 'ready' } }, data: { status, readyAt: now } });
  } else if (status === 'pending') {
    await tx.kitchenTicket.updateMany({ where: of, data: { status } });
  }
}

/** Item tirado do pedido: praça que ficou sem nada perde a ficha. */
export async function pruneTickets(db: Db, order: MenuOrder) {
  const defaultId = (await ensureDefaultStation(db, order.companyId)).id;
  const restantes = new Set((JSON.parse(order.items) as OrderItem[]).map((i) => stationOf(i, defaultId)));
  await db.kitchenTicket.deleteMany({ where: { companyId: order.companyId, orderId: order.id, stationId: { notIn: [...restantes].filter((s): s is string => !!s) } } });
  return syncOrder(db, order.id);
}

/**
 * Pedido aberto de antes das praças (itens sem a chave stationId) ganha a ficha na Cozinha
 * padrão, no mesmo ponto em que estava. Roda ao abrir a tela da cozinha.
 */
export async function backfillTickets(db: Db, companyId: string, defaultId: string, orders: (MenuOrder & { tickets: unknown[] })[]) {
  const antigos = orders.filter((o) => !o.tickets.length
    && (JSON.parse(o.items) as OrderItem[]).some((i) => !('stationId' in i)));
  if (!antigos.length) return false;
  const data: Prisma.KitchenTicketCreateManyInput[] = antigos.map((o) => ({
    companyId, orderId: o.id, stationId: defaultId, status: o.status, acceptedAt: o.acceptedAt, readyAt: o.readyAt,
  }));
  await db.kitchenTicket.createMany({ data, skipDuplicates: true });
  return true;
}
