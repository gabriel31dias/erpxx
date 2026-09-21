import {
  BadRequestException, Body, Controller, Delete, Get, Inject, Module, NotFoundException,
  Param, Patch, Post, Req,
} from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, SessionUser } from '../common/auth.guard';
import { AuditService, PlanService } from '../common/core';
import { PERMISSIONS, ROLES, ROLE_LABELS, ROLE_PERMISSIONS, permissionsOf } from '../common/rbac';

class InviteDto {
  @IsEmail() email!: string;
  @IsIn(ROLES as unknown as string[]) role!: string;
  @IsOptional() @IsString() branchId?: string;
}

class UserDto {
  @IsString() @MinLength(2) name!: string;
  @IsIn(ROLES as unknown as string[]) role!: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class CreateUserDto extends UserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
}

@Controller('api/users')
@Perms('usuario.gerenciar')
export class UsersController {
  constructor(@Inject(PRISMA) private db: Db, private audit: AuditService, private plans: PlanService) {}

  @Get()
  async list(@CurrentUser() u: SessionUser) {
    const rows = await this.db.user.findMany({
      where: { companyId: u.companyId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: { branch: { select: { id: true, name: true } } },
    });
    const invites = await this.db.invite.findMany({
      where: { companyId: u.companyId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      rows: rows.map((r) => ({
        id: r.id, name: r.name, email: r.email, role: r.role,
        roleLabel: ROLE_LABELS[r.role as keyof typeof ROLE_LABELS] ?? r.role,
        active: r.active, blockedAt: r.blockedAt, lastLoginAt: r.lastLoginAt,
        branchId: r.branchId, branch: r.branch?.name ?? 'Todas',
      })),
      invites,
    };
  }

  /** Matriz de permissões para a tela de Funções. */
  @Get('roles')
  roles() {
    return {
      roles: ROLES.map((role) => ({
        value: role, label: ROLE_LABELS[role], permissions: ROLE_PERMISSIONS[role],
      })),
      permissions: PERMISSIONS,
    };
  }

  @Post()
  async create(@CurrentUser() u: SessionUser, @Body() dto: CreateUserDto, @Req() req: Request) {
    await this.plans.assertLimit(u.companyId, 'users');
    const email = dto.email.toLowerCase().trim();
    const exists = await this.db.user.findFirst({ where: { companyId: u.companyId, email } });
    if (exists) throw new BadRequestException('Já existe um usuário com este e-mail.');
    if (dto.role === 'proprietario') throw new BadRequestException('Só existe um proprietário por empresa.');

    const user = await this.db.user.create({
      data: {
        companyId: u.companyId, name: dto.name.trim(), email, role: dto.role,
        branchId: dto.branchId || null, passwordHash: await bcrypt.hash(dto.password, 12),
      },
    });
    await this.audit.log(u, 'create', 'User', user.id, { nome: user.name, perfil: user.role }, req.ip);
    return { id: user.id };
  }

  @Post('invite')
  async invite(@CurrentUser() u: SessionUser, @Body() dto: InviteDto, @Req() req: Request) {
    await this.plans.assertLimit(u.companyId, 'users');
    const email = dto.email.toLowerCase().trim();
    const exists = await this.db.user.findFirst({ where: { companyId: u.companyId, email, deletedAt: null } });
    if (exists) throw new BadRequestException('Este e-mail já faz parte da equipe.');

    const token = randomBytes(24).toString('hex');
    await this.db.invite.create({
      data: {
        companyId: u.companyId, email, role: dto.role, branchId: dto.branchId || null, token,
        expiresAt: new Date(Date.now() + 7 * 86400_000),
      },
    });
    await this.audit.log(u, 'create', 'Invite', undefined, { email, perfil: dto.role }, req.ip);
    // ponytail: sem SMTP — o link é copiado da tela e enviado por WhatsApp/e-mail
    return { ok: true, link: `/aceitar-convite.html?token=${token}` };
  }

  @Delete('invite/:id')
  async removeInvite(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    await this.db.invite.deleteMany({ where: { id, companyId: u.companyId } });
    return { ok: true };
  }

  @Patch(':id')
  async update(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() dto: UserDto, @Req() req: Request) {
    const before = await this.db.user.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!before) throw new NotFoundException('Usuário não encontrado.');
    if (before.role === 'proprietario' && dto.role !== 'proprietario') {
      throw new BadRequestException('O proprietário não pode mudar de perfil.');
    }
    const user = await this.db.user.update({
      where: { id },
      data: {
        name: dto.name.trim(), role: dto.role, branchId: dto.branchId || null,
        active: dto.active ?? before.active,
        blockedAt: dto.active === false ? new Date() : null,
      },
    });
    const action = before.role !== user.role ? 'permission' : 'update';
    await this.audit.log(u, action, 'User', id, AuditService.diff(before, user), req.ip);
    return { ok: true, permissions: permissionsOf(user.role) };
  }

  @Post(':id/password')
  async resetPassword(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body() body: { password: string }, @Req() req: Request) {
    if (!body?.password || body.password.length < 8) throw new BadRequestException('Senha muito curta.');
    const user = await this.db.user.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    await this.db.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(body.password, 12) } });
    await this.audit.log(u, 'update', 'User', id, { senha: 'redefinida pelo administrador' }, req.ip);
    return { ok: true };
  }

  @Delete(':id')
  async remove(@CurrentUser() u: SessionUser, @Param('id') id: string, @Req() req: Request) {
    if (id === u.sub) throw new BadRequestException('Você não pode excluir o próprio usuário.');
    const user = await this.db.user.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    if (user.role === 'proprietario') throw new BadRequestException('O proprietário não pode ser excluído.');
    // histórico de vendas aponta para o operador: exclusão é lógica
    await this.db.user.update({
      where: { id }, data: { deletedAt: new Date(), active: false, blockedAt: new Date() },
    });
    await this.audit.log(u, 'delete', 'User', id, { nome: user.name }, req.ip);
    return { ok: true };
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
