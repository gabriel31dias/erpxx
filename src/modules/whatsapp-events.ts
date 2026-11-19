import { randomBytes } from 'crypto';
import type { MenuOrder, Sale } from '@prisma/client';
import type { Db, Tx } from '../common/prisma.service';
import { fmtBRL } from '../common/util';

export type WhatsAppEvent = 'purchase' | 'received' | 'dispatched';
export const WHATSAPP_TEMPLATES = {
  purchase: 'Olá, {cliente}! Sua compra #{numero} na {loja} foi concluída. Total: {total}. Obrigado pela preferência!',
  received: 'Olá, {cliente}! Recebemos seu pedido #{numero} na {loja}. Total: {total}. Vamos preparar tudo com carinho!',
  dispatched: 'Olá, {cliente}! Seu pedido #{numero} da {loja} saiu para entrega! Endereço: {endereco}.',
};
export const WHATSAPP_VARIABLES = ['cliente', 'loja', 'numero', 'total', 'endereco', 'itens'];

export function whatsAppPhone(value?: string | null) {
  if (!value || !/^[+\d\s().-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  if (value.trim().startsWith('+')) return /^[1-9]\d{9,14}$/.test(digits) ? digits : null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return /^\d{12,15}$/.test(digits) ? digits : null;
}

export function renderWhatsAppTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

async function enqueue(db: Db | Tx, companyId: string, event: WhatsAppEvent, refId: string,
  phone: string | null | undefined, details: { customer: string; number: number; total: number; address?: string; items: string }) {
  const config = await db.whatsAppBot.findUnique({ where: { companyId }, include: { company: true } });
  if (!config?.enabled || !config[`${event}Enabled`] || !config.company.active
    || config.company.deletedAt || config.company.status !== 'aprovada') return;
  const destination = whatsAppPhone(phone);
  if (!destination) return;
  const message = renderWhatsAppTemplate(config[`${event}Template`] || WHATSAPP_TEMPLATES[event], {
    cliente: details.customer, loja: config.company.tradeName || config.company.name,
    numero: String(details.number), total: fmtBRL(details.total), endereco: details.address || 'Endereço informado no pedido', itens: details.items,
  });
  // A chave única é também a proteção contra notificações duplicadas em chamadas concorrentes.
  await db.whatsAppMessage.upsert({
    where: { companyId_event_refId: { companyId, event, refId } }, update: {},
    create: { companyId, event, refId, phone: destination, message, providerMessageId: `3EB0${randomBytes(18).toString('hex').toUpperCase()}` },
  });
}

/** Executado na mesma transação que confirma a compra. */
export async function enqueuePurchase(db: Db | Tx, sale: Sale) {
  if (sale.status !== 'COMPLETED' || sale.paymentStatus !== 'approved' || !sale.customerId) return;
  const customer = await db.customer.findFirst({ where: { id: sale.customerId, companyId: sale.companyId, deletedAt: null } });
  if (!customer) return;
  const items = await db.saleItem.findMany({ where: { companyId: sale.companyId, saleId: sale.id }, select: { name: true, quantity: true } });
  await enqueue(db, sale.companyId, 'purchase', sale.id, customer.whatsapp || customer.phone,
    { customer: customer.name, number: sale.number, total: sale.totalCents, items: items.map((item) => `${item.quantity}x ${item.name}`).join(', ') });
}

/** Pedidos de mesa e retirada não disparam os avisos do delivery. PIX aguarda confirmação. */
export async function enqueueDelivery(db: Db | Tx, order: MenuOrder, event: 'received' | 'dispatched') {
  if (order.deliveryType !== 'delivery' || order.table != null || order.status === 'cancelled'
    || ['pending', 'rejected', 'refund_pending'].includes(order.paymentStatus)) return;
  if (event === 'dispatched' && order.status !== 'delivering') return;
  const items = JSON.parse(order.items) as { quantity: number; name: string }[];
  await enqueue(db, order.companyId, event, order.id, order.customerPhone, {
    customer: order.customerName, number: order.number, total: order.totalCents, address: order.address,
    items: items.map((item) => `${item.quantity}x ${item.name}`).join(', '),
  });
}
