import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { MembershipRole } from '@despacho/shared';
import type { TenantRequest } from '../db/tenant-transaction.interceptor.js';
import type { TenantContext } from '../db/tenant-transactions.js';

export const IS_PUBLIC = 'isPublic';
export const COMPANY_ROLES = 'companyRoles';
export const OWN_TRANSACTION = 'ownTransaction';

/** Rota sem autenticação. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Rota que age dentro de uma empresa (cabeçalho `x-company-id`) e exige um destes papéis nela. */
export const CompanyRoles = (...roles: MembershipRole[]) => SetMetadata(COMPANY_ROLES, roles);

/** Usuário e empresa da requisição, definidos pelo AuthGuard. */
export const Tenant = createParamDecorator((_: unknown, context: ExecutionContext): TenantContext => {
  const { tenant } = context.switchToHttp().getRequest<TenantRequest>();
  if (!tenant) throw new Error('Rota sem tenant; use @Public() ou autentique');
  return tenant;
});

/**
 * A rota abre a própria transação (`TenantTransactions.run`) em vez de rodar inteira numa: serve para
 * quem precisa de uma chamada externa lenta antes, sem segurar uma conexão do banco esperando.
 */
export const OwnTransaction = () => SetMetadata(OWN_TRANSACTION, true);
