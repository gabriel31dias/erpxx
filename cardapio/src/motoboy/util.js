import { brl } from '../context/AppContext';

export const money = (cents) => brl(cents / 100);

/** distância em linha reta, "850 m" / "2,4 km" */
export function distance(a, b) {
  if (!a || b?.lat == null) return null;
  const rad = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  const m = 2 * 6_371_000 * Math.asin(Math.sqrt(x));
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export const minutesAgo = (iso) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : null);

/** o que o motoboy faz com o dinheiro: Pix já pago no cardápio ou cobrar na porta */
export const charge = (o) => (o.paymentMethod === 'pix' ? { paid: true, label: 'Pago no Pix' } : { paid: false, label: `Cobrar ${money(o.totalCents)}` });
