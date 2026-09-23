/**
 * Datas do ERP são strings "YYYY-MM-DD HH:mm" (ou "YYYY-MM-DD") no fuso da empresa.
 * ponytail: sem lib de datas — comparação lexicográfica funciona e ordena no SQL.
 * Se um dia houver empresa multi-fuso, guardar UTC + offset.
 */
const pad = (n: number) => String(n).padStart(2, '0');

export const DT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function nowIn(timezone = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()).replace('T', ' ').slice(0, 16);
}

export const today = (timezone?: string) => nowIn(timezone).slice(0, 10);
export const dateOf = (dt: string) => dt.slice(0, 10);
export const timeOf = (dt: string) => dt.slice(11, 16);

function toEpochMin(dt: string): number {
  const [d, t] = dt.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = (t || '00:00').split(':').map(Number);
  return Date.UTC(y, m - 1, day, hh, mm) / 60000;
}

function fromEpochMin(min: number): string {
  const d = new Date(min * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export const addDays = (dateOrDt: string, days: number) =>
  fromEpochMin(toEpochMin(dateOrDt.length === 10 ? `${dateOrDt} 00:00` : dateOrDt) + days * 1440)
    .slice(0, dateOrDt.length === 10 ? 10 : 16);

export function addMonths(dateOrDt: string, months: number): string {
  const isDate = dateOrDt.length === 10;
  const [d, t] = dateOrDt.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const out = `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(day, lastDay))}`;
  return isDate ? out : `${out} ${t}`;
}

/** Início (inclusivo) e fim (exclusivo) do mês "YYYY-MM", como data simples. */
export function monthRange(ym: string) {
  const start = `${ym}-01`;
  return { start, end: addMonths(start, 1) };
}

export const monthOf = (dateOrDt: string) => dateOrDt.slice(0, 7);
export const prevMonth = (ym: string) => addMonths(`${ym}-01`, -1).slice(0, 7);

/** Período nomeado -> {from,to} em datas simples (inclusivas). */
export function periodRange(period: string, tz?: string): { from: string; to: string } {
  const hoje = today(tz);
  if (period === 'hoje') return { from: hoje, to: hoje };
  if (period === 'ontem') return { from: addDays(hoje, -1), to: addDays(hoje, -1) };
  if (period === 'semana') return { from: addDays(hoje, -6), to: hoje };
  if (period === 'mes') return { from: `${monthOf(hoje)}-01`, to: hoje };
  if (period === 'mes_passado') {
    const ym = prevMonth(monthOf(hoje));
    return { from: `${ym}-01`, to: addDays(`${ym}-01`, -1 + new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()) };
  }
  if (period === 'ano') return { from: `${hoje.slice(0, 4)}-01-01`, to: hoje };
  return { from: addDays(hoje, -29), to: hoje };
}

// ---------- formatação pt-BR ----------
export const fmtBRL = (cents: number) =>
  ((cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtDateBR = (dateOrDt: string) => dateOf(dateOrDt).split('-').reverse().join('/');
export const fmtDateTimeBR = (dt: string) => `${fmtDateBR(dt)} ${timeOf(dt)}`;

// ---------- dinheiro / quantidade ----------
/** Centavos são inteiros; quantidade pode ter 3 casas (venda por peso). */
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const roundQty = (n: number) => Math.round(n * 1000) / 1000;

/** Total de um item: preço × quantidade − desconto, sempre inteiro em centavos. */
export const itemTotalCents = (unitPriceCents: number, quantity: number, discountCents = 0) =>
  Math.max(0, Math.round(unitPriceCents * quantity) - discountCents);

export function onlyDigits(s?: string | null): string {
  return (s || '').replace(/\D+/g, '');
}

export function waPhone(phone?: string | null): string | null {
  const d = onlyDigits(phone);
  if (d.length < 10) return null;
  return d.startsWith('55') ? d : `55${d}`;
}

export function slugify(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'loja';
}

export function toCsv(rows: Record<string, any>[], headers?: string[]): string {
  if (!rows.length) return '';
  const cols = headers ?? Object.keys(rows[0]);
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // ponytail: separador ";" e BOM — é o que o Excel pt-BR abre sem perguntar nada
  return '\uFEFF' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n');
}

/** Paginação vinda da query string, com teto para não varrer a tabela inteira. */
export function paging(page?: string, pageSize?: string, max = 100) {
  const take = Math.min(Math.max(Number(pageSize) || 20, 1), max);
  const current = Math.max(Number(page) || 1, 1);
  return { take, skip: (current - 1) * take, page: current, pageSize: take };
}

/** CPF com dígitos verificadores válidos (aceita com ou sem máscara). */
export function isCpf(value?: string | null): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
