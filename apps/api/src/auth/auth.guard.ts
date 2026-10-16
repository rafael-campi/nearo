import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { COMPANY_HEADER, type MembershipRole } from '@despacho/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { companies, memberships } from '../db/schema.js';
import type { TenantRequest } from '../db/tenant-transaction.interceptor.js';
import { TenantTransactions } from '../db/tenant-transactions.js';
import { COMPANY_ROLES, IS_PUBLIC } from './decorators.js';
import { SessionsService } from './sessions.service.js';

export interface AuthenticatedRequest extends TenantRequest {
  headers: Record<string, string | undefined>;
  sessionToken?: string;
}

function bearerToken(header: string | undefined): string | null {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme === 'Bearer' && token ? token : null;
}

/**
 * Autentica pela sessão e, em rotas `@CompanyRoles`, exige vínculo ativo numa empresa ativa.
 * Empresa sem vínculo responde 404, para não revelar que existe (ADR 0001).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
    private readonly transactions: TenantTransactions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(req.headers.authorization);
    const userId = token ? await this.sessions.userIdForToken(token) : null;
    if (!token || !userId) throw new UnauthorizedException();
    req.sessionToken = token;

    const roles = this.reflector.getAllAndOverride<MembershipRole[] | undefined>(COMPANY_ROLES, targets);
    if (!roles) {
      req.tenant = { userId, companyId: null };
      return true;
    }

    const companyId = z.uuid().safeParse(req.headers[COMPANY_HEADER]);
    if (!companyId.success) throw new NotFoundException();
    const tenant = { userId, companyId: companyId.data };
    const allowed = await this.transactions.run(tenant, (tx) =>
      tx
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(companies, eq(companies.id, memberships.companyId))
        .where(
          and(
            eq(memberships.companyId, tenant.companyId),
            eq(memberships.userId, userId),
            inArray(memberships.role, roles),
            eq(memberships.active, true),
            eq(companies.active, true),
          ),
        )
        .limit(1),
    );
    if (allowed.length === 0) throw new NotFoundException();
    req.tenant = tenant;
    return true;
  }
}
