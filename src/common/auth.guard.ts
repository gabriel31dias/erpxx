import {
  CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator,
  UnauthorizedException, ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { Permission, can } from './rbac';

export const AUTH_COOKIE = 'lf_session';
export const CSRF_HEADER = 'lojaflow';

export interface SessionUser {
  sub: string;
  companyId: string;
  branchId: string | null; // null = enxerga todas as filiais
  role: string;
  name: string;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const SKIP_CSRF = 'skipCsrf';
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

export const PERMS_KEY = 'perms';
export const Perms = (...perms: Permission[]) => SetMetadata(PERMS_KEY, perms);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser =>
    ctx.switchToHttp().getRequest<Request & { user: SessionUser }>().user,
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest<Request & { user?: SessionUser }>();

    // Sessão em cookie httpOnly + SameSite=strict. Mutação exige header próprio:
    // formulário cross-site não consegue enviá-lo, o que fecha o CSRF.
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [ctx.getHandler(), ctx.getClass()]);
    if (!skipCsrf && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      && req.headers['x-requested-with'] !== CSRF_HEADER) {
      throw new ForbiddenException('Requisição bloqueada (CSRF).');
    }
    if (isPublic) return true;

    const token = (req.cookies || {})[AUTH_COOKIE];
    if (!token) throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    try {
      req.user = await this.jwt.verifyAsync<SessionUser>(token);
    } catch {
      throw new UnauthorizedException('Sessão inválida. Entre novamente.');
    }
    // token do app do vendedor externo não abre o ERP
    if ((req.user as any).typ) throw new UnauthorizedException('Sessão inválida. Entre novamente.');

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (required?.length && !required.every((p) => can(req.user!.role, p))) {
      throw new ForbiddenException('Seu perfil não tem permissão para esta ação.');
    }
    return true;
  }
}
