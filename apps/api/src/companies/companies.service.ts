import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AssignmentMode, Company, Invite, JoinCodeResponse } from '@despacho/shared';
import { eq, sql } from 'drizzle-orm';
import { newJoinCode } from '../auth/crypto.js';
import { companies } from '../db/schema.js';
import { DATABASE, TenantTransactions, type Database } from '../db/tenant-transactions.js';
import { InvitesService } from '../invites/invites.service.js';

@Injectable()
export class CompaniesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly transactions: TenantTransactions,
    private readonly invites: InvitesService,
  ) {}

  /** A empresa da transação atual. */
  async current(): Promise<Company> {
    const [company] = await this.transactions
      .current()
      .select({ id: companies.id, name: companies.name, assignmentMode: companies.assignmentMode })
      .from(companies)
      .where(eq(companies.id, sql`app.current_company_id()`));
    if (!company) throw new NotFoundException();
    return company;
  }

  async setAssignmentMode(assignmentMode: AssignmentMode): Promise<Company> {
    const [company] = await this.transactions
      .current()
      .update(companies)
      .set({ assignmentMode })
      .where(eq(companies.id, sql`app.current_company_id()`))
      .returning({ id: companies.id, name: companies.name, assignmentMode: companies.assignmentMode });
    if (!company) throw new NotFoundException();
    return company;
  }

  async joinCode(): Promise<JoinCodeResponse> {
    const [company] = await this.transactions
      .current()
      .select({ joinCode: companies.joinCode })
      .from(companies)
      .where(eq(companies.id, sql`app.current_company_id()`));
    if (!company) throw new NotFoundException();
    return company;
  }

  /**
   * Operação de plataforma (script `company:create`): roda conectada como dono das tabelas,
   * fora do RLS, porque ainda não existe empresa nem usuário no contexto.
   */
  async createWithAdminInvite(name: string, adminEmail: string): Promise<{ company: Company; invite: Invite }> {
    return this.db.transaction(async (tx) => {
      const [company] = await tx.insert(companies).values({ name, joinCode: newJoinCode() }).returning({ id: companies.id, name: companies.name, assignmentMode: companies.assignmentMode });
      const invite = await this.invites.create(tx, {
        companyId: company.id,
        companyName: company.name,
        email: adminEmail,
        role: 'admin',
        invitedBy: null,
      });
      return { company, invite };
    });
  }
}
