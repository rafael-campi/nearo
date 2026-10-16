import { randomUUID } from 'node:crypto';
import { CanActivate, Controller, ExecutionContext, Get, Injectable, UseGuards } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import request from 'supertest';
import { Public } from '../src/auth/decorators.js';
import { PG_POOL } from '../src/db/database.module.js';
import type { TenantRequest } from '../src/db/tenant-transaction.interceptor.js';
import { TenantTransactions } from '../src/db/tenant-transactions.js';
import { createTestApp, type TestApp } from './support/app.js';
import { ownerPool } from './support/db.js';

// Substitui a autenticação (que ainda não existe): define o tenant a partir de cabeçalhos.
@Injectable()
class HeaderTenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<TenantRequest & { headers: Record<string, string> }>();
    const userId = req.headers['x-test-user'];
    if (userId) req.tenant = { userId, companyId: req.headers['x-test-company'] ?? null };
    return true;
  }
}

@Public()
@Controller('tenant-probe')
@UseGuards(HeaderTenantGuard)
class TenantProbeController {
  constructor(private readonly transactions: TenantTransactions) {}

  @Get()
  async get() {
    const result = await this.transactions
      .current()
      .execute<{ user_id: string; company_id: string }>(
        sql`select app.current_user_id() as user_id, app.current_company_id() as company_id`,
      );
    return result.rows[0];
  }
}

const companyA = randomUUID();
const companyB = randomUUID();
const user = randomUUID();

describe('isolamento por empresa', () => {
  let t: TestApp;
  let transactions: TenantTransactions;

  beforeAll(async () => {
    t = await createTestApp({ controllers: [TenantProbeController] });
    transactions = t.app.get(TenantTransactions);
  });

  afterAll(async () => {
    await t.app.close();
  });

  describe('transação por requisição', () => {
    it('requisição autenticada enxerga seu usuário e sua empresa', async () => {
      const res = await request(t.app.getHttpServer())
        .get('/tenant-probe')
        .set('x-test-user', user)
        .set('x-test-company', companyA)
        .expect(200);
      expect(res.body).toEqual({ user_id: user, company_id: companyA });
    });

    it('requisição sem autenticação não tem transação de empresa', async () => {
      await request(t.app.getHttpServer()).get('/tenant-probe').expect(500);
    });

    it('a empresa não vaza para a próxima consulta na mesma conexão', async () => {
      await request(t.app.getHttpServer())
        .get('/tenant-probe')
        .set('x-test-user', user)
        .set('x-test-company', companyA)
        .expect(200);
      const pool = t.app.get<Pool>(PG_POOL);
      const { rows } = await pool.query('select app.current_company_id() as company_id');
      expect(rows[0].company_id).toBeNull();
    });
  });

  describe('RLS no Postgres', () => {
    beforeAll(async () => {
      // Tabela só de teste, criada pelo dono como uma migration faria.
      await ownerPool.query(`
        create table rls_probe (id serial primary key, company_id uuid not null, label text not null);
        alter table rls_probe enable row level security;
        alter table rls_probe force row level security;
        create policy rls_probe_company on rls_probe
          using (company_id = app.current_company_id())
          with check (company_id = app.current_company_id());
      `);
      await ownerPool.query(`insert into rls_probe (company_id, label) values ($1, 'a'), ($2, 'b')`, [
        companyA,
        companyB,
      ]);
    });

    afterAll(async () => {
      await ownerPool.query('drop table rls_probe');
      await ownerPool.end();
    });

    it('uma empresa só lê as próprias linhas, mesmo sem filtro na consulta', async () => {
      const rows = await transactions.run({ userId: user, companyId: companyA }, async (tx) => {
        const result = await tx.execute<{ label: string }>(sql`select label from rls_probe`);
        return result.rows;
      });
      expect(rows).toEqual([{ label: 'a' }]);
    });

    it('fora de uma empresa não lê nada', async () => {
      const inTransaction = await transactions.run({ userId: user, companyId: null }, async (tx) => {
        const result = await tx.execute(sql`select * from rls_probe`);
        return result.rows;
      });
      expect(inTransaction).toEqual([]);

      const { rows } = await t.app.get<Pool>(PG_POOL).query('select * from rls_probe');
      expect(rows).toEqual([]);
    });

    it('uma empresa não grava linhas de outra', async () => {
      await expect(
        transactions.run({ userId: user, companyId: companyA }, (tx) =>
          tx.execute(sql`insert into rls_probe (company_id, label) values (${companyB}, 'invasão')`),
        ),
      ).rejects.toThrow();
    });
  });
});
