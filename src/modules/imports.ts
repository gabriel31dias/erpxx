import { BadRequestException, Body, Controller, Inject, Module, Post, Req } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { PRISMA, Db, Tx, TX } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService, BranchService, PlanService, TimeService } from '../common/core';
import { StockService } from './stock';
import { UNITS } from './catalog';

/** Colunas aceitas -> campo do produto. O usuário confirma o mapeamento na tela. */
export const IMPORT_FIELDS = [
  { key: 'name', label: 'Nome', required: true, aliases: ['nome', 'produto', 'descricao', 'descrição'] },
  { key: 'sku', label: 'SKU / código', aliases: ['sku', 'codigo', 'código', 'cod'] },
  { key: 'barcode', label: 'Código de barras', aliases: ['codigo de barras', 'código de barras', 'ean', 'barcode'] },
  { key: 'categoryName', label: 'Categoria', aliases: ['categoria'] },
  { key: 'brand', label: 'Marca', aliases: ['marca'] },
  { key: 'unit', label: 'Unidade', aliases: ['unidade', 'un'] },
  { key: 'cost', label: 'Custo', aliases: ['custo', 'preco de custo', 'preço de custo'] },
  { key: 'price', label: 'Preço', aliases: ['preco', 'preço', 'venda', 'preco de venda', 'preço de venda'] },
  { key: 'stock', label: 'Estoque', aliases: ['estoque', 'quantidade', 'qtd'] },
  { key: 'minStock', label: 'Estoque mínimo', aliases: ['estoque minimo', 'estoque mínimo', 'minimo', 'mínimo'] },
];

class ImportDto {
  @IsString() csv!: string;
  /** { coluna: campo } — quando ausente, o mapeamento é adivinhado pelo cabeçalho. */
  @IsOptional() mapping?: Record<string, string>;
  @IsOptional() @IsString() branchId?: string;
}

/** "1.234,56" ou "1234.56" -> centavos. */
function toCents(value?: string): number {
  if (!value) return 0;
  const clean = value.replace(/[^\d,.-]/g, '');
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  return Math.round((Number(normalized) || 0) * 100);
}

function toNumber(value?: string): number {
  if (!value) return 0;
  const clean = value.replace(/[^\d,.-]/g, '');
  return Number(clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean) || 0;
}

/** ponytail: split simples com suporte a aspas — CSV de planilha de loja não tem mais que isso. */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^\uFEFF/, '').trim();
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';

  const splitLine = (line: string) => {
    const out: string[] = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { current += '"'; i++; } else quoted = !quoted;
      } else if (ch === sep && !quoted) { out.push(current.trim()); current = ''; } else current += ch;
    }
    out.push(current.trim());
    return out;
  };

  const [head, ...rest] = lines;
  return { headers: splitLine(head), rows: rest.map(splitLine) };
}

function guessMapping(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const header of headers) {
    const norm = header.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const field = IMPORT_FIELDS.find((f) => f.aliases?.some((a) => a === norm) || f.key.toLowerCase() === norm);
    if (field) map[header] = field.key;
  }
  return map;
}

@Controller('api/imports')
@Perms('produto.importar')
export class ImportsController {
  constructor(
    @Inject(PRISMA) private db: Db,
    private stock: StockService,
    private branches: BranchService,
    private audit: AuditService,
    private plans: PlanService,
    private clock: TimeService,
  ) {}

  /** Valida antes de gravar: o usuário vê o que entra e o que está errado. */
  @Post('products/preview')
  async preview(@CurrentUser() u: SessionUser, @Body() dto: ImportDto) {
    await this.plans.requireFeature(u.companyId, 'importacao', 'A importação de produtos');
    return this.analyze(u, dto);
  }

  @Post('products')
  async commit(@CurrentUser() u: SessionUser, @Body() dto: ImportDto, @Req() req: Request) {
    await this.plans.requireFeature(u.companyId, 'importacao', 'A importação de produtos');
    const { rows, errors, fields } = await this.analyze(u, dto);
    if (!rows.length) throw new BadRequestException('Nenhuma linha válida para importar.');
    if (!fields.includes('name')) throw new BadRequestException('Mapeie a coluna do nome do produto.');

    const branchId = await this.branches.require(u, dto.branchId);
    const at = await this.clock.now(u.companyId);
    const categories = new Map(
      (await this.db.category.findMany({ where: { companyId: u.companyId, deletedAt: null } }))
        .map((c) => [c.name.toLowerCase(), c.id]),
    );

    let created = 0;
    let updated = 0;
    for (const row of rows) {
      await this.db.$transaction(async (tx) => {
        let categoryId: string | null = null;
        if (row.categoryName) {
          const key = row.categoryName.toLowerCase();
          categoryId = categories.get(key) ?? null;
          if (!categoryId) {
            const category = await tx.category.create({ data: { companyId: u.companyId, name: row.categoryName } });
            categories.set(key, category.id);
            categoryId = category.id;
          }
        }

        const existing = row.sku || row.barcode
          ? await tx.product.findFirst({
              where: {
                companyId: u.companyId, deletedAt: null,
                OR: [
                  ...(row.sku ? [{ sku: row.sku }] : []),
                  ...(row.barcode ? [{ barcode: row.barcode }] : []),
                ],
              },
            })
          : null;

        const data = {
          name: row.name, sku: row.sku || null, barcode: row.barcode || null,
          brand: row.brand || null, unit: row.unit || 'UN', categoryId,
          costCents: row.costCents, priceCents: row.priceCents, minStock: row.minStock,
        };

        const product = existing
          ? await tx.product.update({ where: { id: existing.id }, data })
          : await tx.product.create({ data: { ...data, companyId: u.companyId } });
        existing ? updated++ : created++;

        if (row.stock > 0) {
          await this.stock.setQuantity(tx as Tx, {
            companyId: u.companyId, branchId, productId: product.id, quantity: row.stock,
            reason: 'Importação de planilha', refType: 'Import', userId: u.sub, at,
          });
        }
      }, TX);
    }

    await this.audit.log(u, 'create', 'Import', undefined,
      { criados: created, atualizados: updated, ignorados: errors.length }, req.ip);
    return { ok: true, created, updated, ignored: errors.length, errors };
  }

  private async analyze(u: SessionUser, dto: ImportDto) {
    const { headers, rows } = parseCsv(dto.csv || '');
    if (!headers.length) throw new BadRequestException('Arquivo vazio ou ilegível.');
    const mapping = dto.mapping && Object.keys(dto.mapping).length ? dto.mapping : guessMapping(headers);
    const index = new Map(headers.map((h, i) => [h, i]));
    const fields = [...new Set(Object.values(mapping))];

    const valid: any[] = [];
    const errors: { line: number; message: string }[] = [];
    const seen = new Set<string>();

    rows.forEach((cells, i) => {
      const value = (field: string) => {
        const header = Object.keys(mapping).find((h) => mapping[h] === field);
        return header !== undefined ? (cells[index.get(header)!] ?? '').trim() : '';
      };
      const name = value('name');
      if (!name) return errors.push({ line: i + 2, message: 'Sem nome do produto.' });

      const price = toCents(value('price'));
      if (price <= 0) return errors.push({ line: i + 2, message: `"${name}": preço de venda inválido.` });

      const unit = (value('unit') || 'UN').toUpperCase();
      const sku = value('sku');
      const barcode = value('barcode');
      const key = `${sku}|${barcode}`;
      if ((sku || barcode) && seen.has(key)) {
        return errors.push({ line: i + 2, message: `"${name}": código repetido na planilha.` });
      }
      seen.add(key);

      valid.push({
        line: i + 2, name, sku, barcode,
        categoryName: value('categoryName'), brand: value('brand'),
        unit: UNITS.includes(unit) ? unit : 'UN',
        costCents: toCents(value('cost')), priceCents: price,
        stock: toNumber(value('stock')), minStock: toNumber(value('minStock')),
      });
    });

    return { headers, mapping, fields, rows: valid, errors, available: IMPORT_FIELDS };
  }
}

@Module({ controllers: [ImportsController], providers: [StockService] })
export class ImportsModule {}
