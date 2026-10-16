import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const DATABASE = Symbol('DATABASE');

/** Quem está agindo e em qual empresa. companyId é null fora do contexto de uma empresa. */
export interface TenantContext {
  userId: string;
  companyId: string | null;
}

/**
 * Abre uma transação com `app.user_id` e `app.company_id` definidos via `set local`,
 * que alimentam as policies de RLS (ADR 0001). Repositórios pegam a transação atual com `current()`.
 */
@Injectable()
export class TenantTransactions {
  private readonly storage = new AsyncLocalStorage<Transaction>();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  run<T>(context: TenantContext, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.user_id', ${context.userId}, true),
                   set_config('app.company_id', ${context.companyId ?? ''}, true)`,
      );
      return this.storage.run(tx, () => fn(tx));
    });
  }

  current(): Transaction {
    const tx = this.storage.getStore();
    if (!tx) throw new Error('Nenhuma transação de empresa ativa; use TenantTransactions.run()');
    return tx;
  }
}
