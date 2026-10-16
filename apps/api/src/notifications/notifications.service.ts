import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { socketEvents, type Notification, type NotificationType } from '@despacho/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Clock } from '../clock.js';
import { companies, notifications } from '../db/schema.js';
import { TenantTransactions } from '../db/tenant-transactions.js';
import { RealtimeService } from '../realtime/realtime.service.js';

export interface NotifyInput {
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  serviceRequestId?: string;
}

const columns = {
  id: notifications.id,
  companyId: notifications.companyId,
  companyName: companies.name,
  type: notifications.type,
  title: notifications.title,
  body: notifications.body,
  serviceRequestId: notifications.serviceRequestId,
  readAt: notifications.readAt,
  createdAt: notifications.createdAt,
};

/** Atualizações: gravadas na transação da ação e entregues pelo socket depois do commit. */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly transactions: TenantTransactions,
    private readonly realtime: RealtimeService,
    private readonly clock: Clock,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    if (input.userIds.length === 0) return;
    const tx = this.transactions.current();
    const [company] = await tx
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.id, sql`app.current_company_id()`));
    // Sem RETURNING: a atualização é de outra pessoa, e o RLS não deixa quem age lê-la de volta.
    const createdAt = this.clock.now();
    const rows = input.userIds.map((userId) => ({ id: randomUUID(), userId, createdAt }));
    await tx.insert(notifications).values(
      rows.map((row) => ({
        ...row,
        companyId: sql`app.current_company_id()`,
        type: input.type,
        title: input.title,
        body: input.body,
        serviceRequestId: input.serviceRequestId ?? null,
      })),
    );
    this.transactions.afterCommit(() => {
      for (const row of rows) {
        const event: Notification = {
          id: row.id,
          companyId: company.id,
          companyName: company.name,
          type: input.type,
          title: input.title,
          body: input.body,
          serviceRequestId: input.serviceRequestId ?? null,
          readAt: null,
          createdAt: row.createdAt.toISOString(),
        };
        this.realtime.toUser(row.userId, socketEvents.notification, event);
      }
    });
  }

  async mine(userId: string): Promise<Notification[]> {
    const rows = await this.transactions
      .current()
      .select(columns)
      .from(notifications)
      .innerJoin(companies, eq(companies.id, notifications.companyId))
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    return rows.map((row) => ({
      ...row,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async markAllRead(userId: string, now: Date): Promise<void> {
    await this.transactions
      .current()
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }
}
