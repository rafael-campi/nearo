import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom, Observable } from 'rxjs';
import { OWN_TRANSACTION } from '../auth/decorators.js';
import { TenantContext, TenantTransactions } from './tenant-transactions.js';

export interface TenantRequest {
  tenant?: TenantContext;
}

/** Roda cada requisição autenticada (com `request.tenant`, definido pela autenticação) numa transação de empresa. */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly transactions: TenantTransactions,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const { tenant } = context.switchToHttp().getRequest<TenantRequest>();
    if (!tenant || this.reflector.getAllAndOverride<boolean>(OWN_TRANSACTION, [context.getHandler(), context.getClass()])) {
      return next.handle();
    }
    return from(
      this.transactions.run(tenant, () => lastValueFrom(next.handle(), { defaultValue: undefined })),
    );
  }
}
