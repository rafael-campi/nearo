import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Client, JoinCompanyResponse } from '@despacho/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { memberships, users } from '../db/schema.js';
import { DATABASE, TenantTransactions, type Database } from '../db/tenant-transactions.js';

type CompanyByCode = { id: string; name: string; active: boolean };

@Injectable()
export class ClientsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly transactions: TenantTransactions,
  ) {}

  /**
   * Entrada de cliente pelo código de acesso. Idempotente para quem já é cliente;
   * quem teve o vínculo desativado pelo admin não volta por conta própria.
   */
  async join(userId: string, code: string): Promise<JoinCompanyResponse> {
    const { rows } = await this.db.execute<CompanyByCode>(sql`select * from app.company_by_join_code(${code})`);
    const company = rows[0];
    if (!company?.active) throw new NotFoundException('Código inválido');

    await this.transactions.run({ userId, companyId: company.id }, async (tx) => {
      await tx
        .insert(memberships)
        .values({ companyId: company.id, userId, role: 'client' })
        .onConflictDoNothing({ target: [memberships.companyId, memberships.userId, memberships.role] });
      const [membership] = await tx
        .select({ active: memberships.active })
        .from(memberships)
        .where(and(eq(memberships.companyId, company.id), eq(memberships.userId, userId), eq(memberships.role, 'client')));
      if (!membership.active) throw new ForbiddenException('Seu acesso a esta empresa foi desativado');
    });
    return { companyId: company.id, companyName: company.name };
  }

  async list(): Promise<Client[]> {
    const rows = await this.transactions
      .current()
      .select({
        membershipId: memberships.id,
        name: users.name,
        email: users.email,
        active: memberships.active,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.companyId, sql`app.current_company_id()`), eq(memberships.role, 'client')))
      .orderBy(asc(sql`lower(${users.name})`));
    return rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() }));
  }

  async setActive(membershipId: string, active: boolean): Promise<Client> {
    const [updated] = await this.transactions
      .current()
      .update(memberships)
      .set({ active })
      .where(and(eq(memberships.id, membershipId), eq(memberships.role, 'client')))
      .returning({ id: memberships.id });
    if (!updated) throw new NotFoundException();
    const client = (await this.list()).find((c) => c.membershipId === updated.id);
    if (!client) throw new NotFoundException();
    return client;
  }
}
