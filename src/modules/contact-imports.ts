import { BadRequestException, Body, Controller, Get, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { IsIn, IsObject, IsOptional, IsString, MaxLength, isEmail } from 'class-validator';
import type { Request, Response } from 'express';
import { Workbook } from 'exceljs';
import { XMLParser, XMLValidator, XMLBuilder } from 'fast-xml-parser';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService, PlanService } from '../common/core';
import { Db, PRISMA, TX } from '../common/prisma.service';
import { addressOf } from './crm';

type Kind = 'customers' | 'suppliers';
const MAX_ROWS = 1000;
const MAX_BYTES = 3 * 1024 * 1024;
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const digits = (s: string) => s.replace(/\D/g, '');
const COMMON_FIELDS = [
  { key: 'name', label: 'Nome / razão social', aliases: ['nome', 'razao social', 'cliente', 'fornecedor'], required: true },
  { key: 'document', label: 'CPF/CNPJ', aliases: ['cpf', 'cnpj', 'cpf/cnpj', 'cnpj/cpf', 'documento'] },
  { key: 'phone', label: 'Telefone', aliases: ['telefone', 'fone'] },
  { key: 'whatsapp', label: 'WhatsApp', aliases: ['whatsapp', 'celular'] },
  { key: 'email', label: 'E-mail', aliases: ['email', 'e-mail'] },
  { key: 'address', label: 'Endereço', aliases: ['endereco'] },
  { key: 'notes', label: 'Observações', aliases: ['observacoes', 'obs'] },
  { key: 'active', label: 'Ativo', aliases: ['ativo', 'situacao', 'status'] },
];
export const contactFields = (kind: Kind) => [...COMMON_FIELDS, ...(kind === 'suppliers'
  ? [{ key: 'tradeName', label: 'Nome fantasia', aliases: ['fantasia', 'nome fantasia'] }]
  : [
    { key: 'zip', label: 'CEP', aliases: ['cep'] },
    { key: 'street', label: 'Rua', aliases: ['rua', 'logradouro'] },
    { key: 'number', label: 'Número', aliases: ['numero'] },
    { key: 'complement', label: 'Complemento', aliases: ['complemento'] },
    { key: 'district', label: 'Bairro', aliases: ['bairro'] },
    { key: 'city', label: 'Cidade', aliases: ['cidade', 'municipio'] },
    { key: 'state', label: 'UF', aliases: ['uf', 'estado'] },
  ])];

export class ContactImportDto {
  @IsIn(['xlsx', 'xml', 'csv']) format!: 'xlsx' | 'xml' | 'csv';
  /** Excel em base64; XML e CSV em texto UTF-8. */
  @IsString() @MaxLength(4 * 1024 * 1024) content!: string;
  @IsOptional() @IsObject() mapping?: Record<string, string>;
}

/** CSV com campos entre aspas, quebras de linha e separador do Excel em português. */
function csvRows(text: string, lineNumbers: number[]): string[][] {
  const first = text.split(/\r?\n/).find((line) => line.trim()) ?? '';
  const separator = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  let line = 1, startLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (ch === separator && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      row.push(cell.trim());
      if (row.some(Boolean)) { rows.push(row); lineNumbers.push(startLine); }
      row = []; cell = ''; if (ch === '\r' && text[i + 1] === '\n') i++;
      line++; startLine = line;
    } else {
      cell += ch;
      if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++;
    }
  }
  if (quoted) throw new BadRequestException('CSV com aspas não fechadas.');
  row.push(cell.trim());
  if (row.some(Boolean)) { rows.push(row); lineNumbers.push(startLine); }
  return rows;
}

export async function readContacts(dto: ContactImportDto, kind: Kind) {
  if (!dto.content?.trim()) throw new BadRequestException('Escolha um arquivo para importar.');
  let matrix: string[][];
  const lineNumbers: number[] = [];
  if (dto.format === 'xlsx') {
    const buffer = Buffer.from(dto.content, 'base64');
    if (buffer.length > MAX_BYTES) throw new BadRequestException('O arquivo deve ter até 3 MB.');
    const book = new Workbook();
    try { await book.xlsx.load(buffer as any); }
    catch { throw new BadRequestException('Excel inválido. Envie um arquivo .xlsx.'); }
    const sheet = book.worksheets[0];
    if (!sheet || sheet.rowCount > MAX_ROWS + 1 || sheet.columnCount > 50) {
      throw new BadRequestException('Use a primeira aba, com até 1.000 registros e 50 colunas.');
    }
    matrix = [];
    sheet.eachRow((row, rowNumber) => {
      const cells: string[] = [];
      for (let i = 1; i <= sheet.columnCount; i++) {
        const cell = row.getCell(i);
        if (cell.type === 6) throw new BadRequestException('Remova as fórmulas da planilha e cole os valores.');
        cells.push(cell.text.trim());
      }
      if (cells.some(Boolean)) { matrix.push(cells); lineNumbers.push(rowNumber); }
    });
  } else {
    const text = dto.content.replace(/^\uFEFF/, '');
    if (Buffer.byteLength(text) > MAX_BYTES) throw new BadRequestException('O arquivo deve ter até 3 MB.');
    if (dto.format === 'csv') matrix = csvRows(text, lineNumbers);
    else if (dto.format === 'xml') {
      if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) {
        throw new BadRequestException('XML inválido. Use o modelo disponível para download.');
      }
      const root = kind === 'customers' ? 'clientes' : 'fornecedores';
      const item = kind === 'customers' ? 'cliente' : 'fornecedor';
      const parsed = new XMLParser({ parseTagValue: false, trimValues: true, processEntities: true }).parse(text);
      const records = parsed[root]?.[item];
      if (!records) throw new BadRequestException(`O XML deve conter <${root}><${item}>...</${item}></${root}>.`);
      const rows = Array.isArray(records) ? records : [records];
      if (rows.some((r) => !r || typeof r !== 'object' || Object.values(r).some((v) => typeof v !== 'string'))) {
        throw new BadRequestException('Cada registro XML deve conter campos simples, conforme o modelo.');
      }
      const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      matrix = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ''))];
    } else throw new BadRequestException('Formato aceito: Excel (.xlsx), XML ou CSV.');
  }
  const [headers = [], ...rows] = matrix;
  if (!headers.length || !rows.length) throw new BadRequestException('Arquivo sem registros.');
  if (rows.length > MAX_ROWS || headers.length > 50) throw new BadRequestException('Limite de 1.000 registros e 50 colunas por arquivo.');
  if (headers.some((h) => !h) || new Set(headers).size !== headers.length) {
    throw new BadRequestException('Preencha os cabeçalhos e remova colunas repetidas.');
  }
  return { headers, rows, lines: rows.map((_, i) => lineNumbers[i + 1] ?? i + 2) };
}

export async function analyzeContacts(db: any, companyId: string, kind: Kind, dto: ContactImportDto) {
  const { headers, rows, lines } = await readContacts(dto, kind);
  const available = contactFields(kind);
  const mapping = dto.mapping ?? Object.fromEntries(headers.flatMap((header) => {
    const field = available.find((f) => [f.key, f.label, ...f.aliases].some((a) => normalize(a) === normalize(header)));
    return field ? [[header, field.key]] : [];
  }));
  if (Object.entries(mapping).some(([h, f]) => !headers.includes(h) || !available.some((a) => a.key === f))
    || new Set(Object.values(mapping)).size !== Object.values(mapping).length) {
    throw new BadRequestException('Mapeie cada campo apenas uma vez, usando as colunas do arquivo.');
  }
  const existing = await db[kind === 'customers' ? 'customer' : 'supplier'].findMany({
    where: { companyId, deletedAt: null }, select: { id: true, document: true },
  });
  const byDocument = new Map<string, string[]>();
  for (const record of existing) {
    if (!record.document) continue;
    const key = digits(record.document);
    byDocument.set(key, [...(byDocument.get(key) ?? []), record.id]);
  }
  const valid: { line: number; data: Record<string, any>; action: string; id?: string }[] = [];
  const errors: { line: number; message: string }[] = [];
  const seen = new Set<string>();
  rows.forEach((cells, i) => {
    const data: Record<string, any> = {};
    for (const [header, field] of Object.entries(mapping)) {
      const value = (cells[headers.indexOf(header)] ?? '').trim();
      if (value) data[field] = value;
    }
    const fail = (message: string) => errors.push({ line: lines[i], message });
    if (!data.name || data.name.length < 2) return fail('Nome / razão social deve ter ao menos 2 caracteres.');
    if (cells.length > headers.length) return fail('Quantidade de colunas maior que o cabeçalho.');
    if (Object.values(data).some((v) => v.length > 2000)) return fail('Campo muito longo (máximo de 2.000 caracteres).');
    if (data.document) {
      if (!/^[\d.\-/\s]+$/.test(data.document)) return fail('CPF/CNPJ deve conter apenas números e pontuação.');
      data.document = digits(data.document);
      if (![11, 14].includes(data.document.length)) return fail('CPF/CNPJ deve ter 11 ou 14 dígitos. Use texto no Excel para preservar zeros à esquerda.');
      if (seen.has(data.document)) return fail('CPF/CNPJ repetido no arquivo.');
      seen.add(data.document);
      if ((byDocument.get(data.document)?.length ?? 0) > 1) return fail('Há mais de um cadastro com este CPF/CNPJ. Corrija os cadastros antes de importar.');
    }
    if (data.email) {
      data.email = data.email.toLowerCase();
      if (!isEmail(data.email)) return fail('E-mail inválido.');
    }
    if (data.zip) {
      data.zip = digits(data.zip);
      if (data.zip.length !== 8) return fail('CEP deve ter 8 dígitos.');
    }
    if (data.state) {
      data.state = data.state.toUpperCase();
      if (!/^[A-Z]{2}$/.test(data.state)) return fail('UF deve ter 2 letras.');
    }
    if (data.active !== undefined) {
      const value = normalize(data.active);
      if (!['sim', 'nao', 'true', 'false', '1', '0', 'ativo', 'inativo'].includes(value)) return fail('Ativo deve ser sim/não, ativo/inativo, true/false ou 1/0.');
      data.active = ['sim', 'true', '1', 'ativo'].includes(value);
    }
    const id = data.document ? byDocument.get(data.document)?.[0] : undefined;
    valid.push({ line: lines[i], data, action: id ? 'update' : 'create', ...(id ? { id } : {}) });
  });
  return { headers, mapping, available, rows: valid, errors };
}

@Controller('api/imports')
export class ContactImportsController {
  constructor(@Inject(PRISMA) private db: Db, private audit: AuditService, private plans: PlanService) {}

  @Post('customers/preview') @Perms('cliente.gerenciar')
  previewCustomers(@CurrentUser() u: SessionUser, @Body() dto: ContactImportDto) { return this.preview(u, 'customers', dto); }
  @Post('suppliers/preview') @Perms('fornecedor.gerenciar')
  previewSuppliers(@CurrentUser() u: SessionUser, @Body() dto: ContactImportDto) { return this.preview(u, 'suppliers', dto); }
  @Post('customers') @Perms('cliente.gerenciar')
  importCustomers(@CurrentUser() u: SessionUser, @Body() dto: ContactImportDto, @Req() req: Request) { return this.commit(u, 'customers', dto, req); }
  @Post('suppliers') @Perms('fornecedor.gerenciar')
  importSuppliers(@CurrentUser() u: SessionUser, @Body() dto: ContactImportDto, @Req() req: Request) { return this.commit(u, 'suppliers', dto, req); }

  @Get('customers/example') @Perms('cliente.gerenciar')
  customerExample(@Query('format') format: string, @Res() res: Response) { return this.example('customers', format, res); }
  @Get('suppliers/example') @Perms('fornecedor.gerenciar')
  supplierExample(@Query('format') format: string, @Res() res: Response) { return this.example('suppliers', format, res); }

  private async preview(u: SessionUser, kind: Kind, dto: ContactImportDto) {
    await this.plans.requireFeature(u.companyId, 'importacao', 'A importação de cadastros');
    return analyzeContacts(this.db, u.companyId, kind, dto);
  }

  private async commit(u: SessionUser, kind: Kind, dto: ContactImportDto, req: Request) {
    await this.plans.requireFeature(u.companyId, 'importacao', 'A importação de cadastros');
    const result = await this.db.$transaction(async (tx) => {
      const analysis = await analyzeContacts(tx, u.companyId, kind, dto);
      if (!analysis.rows.length) throw new BadRequestException('Nenhum registro válido para importar.');
      let created = 0, updated = 0;
      for (const row of analysis.rows) {
        const data = { ...row.data };
        if (kind === 'customers') {
          const before = row.id ? await tx.customer.findUnique({ where: { id: row.id } }) : null;
          if (['zip', 'street', 'number', 'complement', 'district', 'city', 'state', 'address'].some((k) => k in data)) {
            // Um novo endereço livre substitui a localização anterior; misturá-lo
            // com rua/CEP antigos faria addressOf descartar o texto importado.
            const freeAddress = data.address && data.address !== before?.address
              && !['zip', 'street', 'number', 'complement', 'district', 'city', 'state'].some((k) => k in data);
            const address = addressOf((freeAddress ? data : { ...before, ...data }) as any);
            Object.assign(data, address);
            if (before && Object.entries(address).some(([k, v]) => before[k] !== v)) {
              Object.assign(data, { lat: null, lng: null, geoSource: null });
            }
          }
          if (row.id) await tx.customer.update({ where: { id: row.id }, data });
          else await tx.customer.create({ data: { ...data, name: data.name, companyId: u.companyId, whatsapp: data.whatsapp || data.phone || null } });
        } else {
          if (row.id) await tx.supplier.update({ where: { id: row.id }, data });
          else await tx.supplier.create({ data: { ...data, name: data.name, companyId: u.companyId, whatsapp: data.whatsapp || data.phone || null } });
        }
        row.id ? updated++ : created++;
      }
      return { ok: true, created, updated, ignored: analysis.errors.length, errors: analysis.errors };
    }, TX);
    await this.audit.log(u, 'create', 'Import', undefined, { tipo: kind, criados: result.created, atualizados: result.updated, ignorados: result.ignored }, req.ip);
    return result;
  }

  private async example(kind: Kind, format: string, res: Response) {
    if (!['xlsx', 'xml', 'csv'].includes(format)) throw new BadRequestException('Escolha xlsx, xml ou csv.');
    const fields = contactFields(kind);
    const sample = {
      name: kind === 'customers' ? 'Cliente Exemplo' : 'Fornecedor Exemplo Ltda',
      document: '01234567890', phone: '11999990000', whatsapp: '11999990000',
      email: 'contato@example.com', address: 'Rua Exemplo, 100, Centro, São Paulo - SP',
      notes: 'Cadastro fictício. Substitua pelos seus dados.', active: 'sim', tradeName: 'Fornecedor Exemplo',
      zip: '01305000', street: 'Rua Exemplo', number: '100', complement: 'Sala 2', district: 'Centro', city: 'São Paulo', state: 'SP',
    };
    const name = kind === 'customers' ? 'clientes' : 'fornecedores';
    res.setHeader('Content-Disposition', `attachment; filename="exemplo-${name}.${format}"`);
    if (format === 'xlsx') {
      const book = new Workbook();
      const sheet = book.addWorksheet(name);
      sheet.columns = fields.map((f) => ({ header: f.label, key: f.key, width: 25, style: { numFmt: '@' } }));
      sheet.addRow(sample);
      sheet.getRow(1).font = { bold: true };
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(Buffer.from(await book.xlsx.writeBuffer()));
    } else if (format === 'xml') {
      const record = Object.fromEntries(fields.map((f) => [f.key, sample[f.key]]));
      res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLBuilder({ format: true }).build({ [name]: { [kind === 'customers' ? 'cliente' : 'fornecedor']: record } }));
    } else {
      const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
      res.type('text/csv').send('\uFEFF' + [fields.map((f) => f.label), fields.map((f) => sample[f.key])].map((r) => r.map(quote).join(';')).join('\r\n'));
    }
  }
}
