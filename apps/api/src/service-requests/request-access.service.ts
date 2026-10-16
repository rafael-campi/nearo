import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { memberships, serviceRequests } from '../db/schema.js';
import { TenantTransactions } from '../db/tenant-transactions.js';

export interface Participation {
  status: (typeof serviceRequests.$inferSelect)['status'];
  clientId: string;
  providerUserId: string | null;
  completedAt: Date | null;
  role: 'client' | 'provider' | 'admin';
}

/** Quem é cada pessoa num pedido da empresa atual: cliente, prestador do pedido ou admin. */
@Injectable()
export class RequestAccessService {
  constructor(private readonly transactions: TenantTransactions) {}

  /** Quem é a pessoa no pedido: cliente, prestador do pedido ou admin da empresa. Outra pessoa: 404. */
  async participation(userId: string, serviceRequestId: string): Promise<Participation> {
    const tx = this.transactions.current();
    const [request] = await tx
      .select({
        status: serviceRequests.status,
        clientId: serviceRequests.clientId,
        providerMembershipId: serviceRequests.providerMembershipId,
        completedAt: serviceRequests.completedAt,
      })
      .from(serviceRequests)
      .where(and(eq(serviceRequests.id, serviceRequestId), eq(serviceRequests.companyId, sql`app.current_company_id()`)));
    if (!request) throw new NotFoundException();

    let providerUserId: string | null = null;
    if (request.providerMembershipId) {
      const [provider] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, request.providerMembershipId));
      providerUserId = provider?.userId ?? null;
    }
    const common = { status: request.status, clientId: request.clientId, providerUserId, completedAt: request.completedAt };
    if (userId === request.clientId) return { ...common, role: 'client' };
    if (userId === providerUserId) return { ...common, role: 'provider' };

    const [admin] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.companyId, sql`app.current_company_id()`),
          eq(memberships.userId, userId),
          eq(memberships.role, 'admin'),
          eq(memberships.active, true),
        ),
      );
    if (!admin) throw new NotFoundException();
    return { ...common, role: 'admin' };
  }
}
