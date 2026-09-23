import {
  BadRequestException, Body, Controller, Get, Inject, Injectable, Module, NotFoundException, Param, Post, Req, Res,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService } from '../common/core';

/** Arquivo como o multer entrega (memória). */
export interface UploadFile { originalname: string; mimetype: string; size: number; buffer: Buffer }

const MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_UPLOAD = FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } });

// tipo decidido pelo conteúdo, não pelo nome nem pelo mimetype que o cliente mandou
const TYPES: Array<{ mime: string; ext: string; match: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', ext: 'jpg', match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', match: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', match: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { mime: 'application/pdf', ext: 'pdf', match: (b) => b.toString('ascii', 0, 5) === '%PDF-' },
];

export const ATTACHMENT_SELECT = {
  id: true, fileName: true, mimeType: true, size: true, notes: true, createdAt: true,
  seller: { select: { id: true, name: true } },
} as const;

/** Comprovantes de pagamento: grava em disco (data/uploads) e os metadados no banco. */
@Injectable()
export class AttachmentsService {
  private root = process.env.UPLOADS_DIR || join(__dirname, '..', '..', 'data', 'uploads');

  constructor(@Inject(PRISMA) private db: Db, private audit: AuditService) {}

  async save(
    by: { companyId: string; userId?: string | null; sellerId?: string | null },
    saleId: string, file: UploadFile | undefined, notes: string | undefined, ip?: string,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Envie o arquivo no campo "file" (multipart/form-data).');
    const type = TYPES.find((t) => t.match(file.buffer));
    if (!type) throw new BadRequestException('Formato não aceito. Envie JPG, PNG, WEBP ou PDF.');

    const id = randomBytes(12).toString('hex');
    const path = `${by.companyId}/${id}.${type.ext}`;
    await mkdir(join(this.root, by.companyId), { recursive: true });
    await writeFile(join(this.root, path), file.buffer);

    const att = await this.db.saleAttachment.create({
      data: {
        companyId: by.companyId, saleId, sellerId: by.sellerId ?? null, userId: by.userId ?? null,
        fileName: (file.originalname || `comprovante.${type.ext}`).slice(0, 200),
        mimeType: type.mime, size: file.size, path, notes: notes?.trim().slice(0, 500) || null,
      },
      select: ATTACHMENT_SELECT,
    });
    await this.audit.log({ sub: by.userId ?? undefined, companyId: by.companyId }, 'create', 'SaleAttachment', att.id,
      { venda: saleId, arquivo: att.fileName, ...(by.sellerId ? { vendedorExterno: by.sellerId } : {}) }, ip);
    return att;
  }

  list(companyId: string, saleId: string) {
    return this.db.saleAttachment.findMany({
      where: { companyId, saleId }, orderBy: { createdAt: 'asc' }, select: ATTACHMENT_SELECT,
    });
  }

  /** Envia o arquivo; `where` restringe quem pode ver (empresa, e vendedor quando é o app). */
  async send(where: { id: string; companyId: string; sale?: { sellerId: string } }, res: Response) {
    const att = await this.db.saleAttachment.findFirst({ where });
    const file = att && join(this.root, att.path);
    if (!att || !file || !existsSync(file)) throw new NotFoundException('Comprovante não encontrado.');
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.fileName)}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(file);
  }
}

/** Comprovantes vistos e anexados pelo ERP. */
@Controller('api/sales')
@Perms('venda.visualizar')
export class SaleAttachmentsController {
  constructor(@Inject(PRISMA) private db: Db, private attachments: AttachmentsService) {}

  @Get(':id/attachments')
  async list(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    return { rows: await this.attachments.list(u.companyId, id) };
  }

  @Post(':id/attachments')
  @UseInterceptors(RECEIPT_UPLOAD)
  async upload(
    @CurrentUser() u: SessionUser, @Param('id') id: string, @UploadedFile() file: UploadFile,
    @Body('notes') notes: string | undefined, @Req() req: Request,
  ) {
    const sale = await this.db.sale.findFirst({ where: { id, companyId: u.companyId }, select: { id: true } });
    if (!sale) throw new NotFoundException('Venda não encontrada.');
    return this.attachments.save({ companyId: u.companyId, userId: u.sub }, id, file, notes, req.ip);
  }

  @Get('attachments/:attId/file')
  file(@CurrentUser() u: SessionUser, @Param('attId') attId: string, @Res() res: Response) {
    return this.attachments.send({ id: attId, companyId: u.companyId }, res);
  }
}

@Module({
  controllers: [SaleAttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
