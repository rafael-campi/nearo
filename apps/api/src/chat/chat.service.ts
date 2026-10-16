import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  chatWritableStatuses,
  MESSAGES_PAGE_SIZE,
  serviceRequestRoom,
  socketEvents,
  userRoom,
  type Message,
  type MessagePage,
  type SendMessage,
} from '@despacho/shared';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { Clock } from '../clock.js';
import { memberships, messages, serviceRequests, users } from '../db/schema.js';
import { TenantTransactions } from '../db/tenant-transactions.js';
import { RealtimeService } from '../realtime/realtime.service.js';

interface Participation {
  status: (typeof serviceRequests.$inferSelect)['status'];
  clientId: string;
  providerUserId: string | null;
  role: 'client' | 'provider' | 'admin';
}

const columns = {
  id: messages.id,
  serviceRequestId: messages.serviceRequestId,
  clientMessageId: messages.clientMessageId,
  senderRole: messages.senderRole,
  senderName: users.name,
  body: messages.body,
  createdAt: messages.createdAt,
  seq: messages.seq,
};

/**
 * Chat do pedido (ADR 0005): só cliente e prestador escrevem, de confirmado a em execução; em concluído e
 * cancelado fica só leitura; o admin lê o chat de qualquer pedido da empresa, sem escrever.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly transactions: TenantTransactions,
    private readonly realtime: RealtimeService,
    private readonly clock: Clock,
  ) {}

  async send(userId: string, serviceRequestId: string, input: SendMessage): Promise<Message> {
    const who = await this.participation(userId, serviceRequestId);
    if (who.role === 'admin') throw new NotFoundException();
    if (!(chatWritableStatuses as readonly string[]).includes(who.status)) {
      throw new ConflictException('A conversa está encerrada');
    }

    const tx = this.transactions.current();
    const [inserted] = await tx
      .insert(messages)
      .values({
        companyId: sql`app.current_company_id()`,
        serviceRequestId,
        senderId: userId,
        senderRole: who.role,
        clientMessageId: input.clientMessageId,
        body: input.body,
        createdAt: this.clock.now(),
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });

    if (!inserted) {
      // Reenvio da mesma mensagem: devolve a que já existe, sem gravar nem emitir de novo.
      const [existing] = await this.select(
        and(
          eq(messages.serviceRequestId, serviceRequestId),
          eq(messages.senderId, userId),
          eq(messages.clientMessageId, input.clientMessageId),
        ),
      );
      return this.toMessage(existing);
    }

    const [row] = await this.select(eq(messages.id, inserted.id));
    const message = this.toMessage(row);
    const rooms = [userRoom(who.clientId), ...(who.providerUserId ? [userRoom(who.providerUserId)] : []), serviceRequestRoom(serviceRequestId)];
    this.transactions.afterCommit(() => this.realtime.toRooms(rooms, socketEvents.messageNew, message));
    return message;
  }

  /** Mensagens em ordem cronológica, as mais recentes primeiro por página; `cursor` leva às mais antigas. */
  async list(userId: string, serviceRequestId: string, cursor: string | undefined): Promise<MessagePage> {
    await this.participation(userId, serviceRequestId);
    const before = cursor === undefined ? undefined : parseCursor(cursor);
    const rows = await this.select(
      and(eq(messages.serviceRequestId, serviceRequestId), before === undefined ? undefined : lt(messages.seq, before)),
      MESSAGES_PAGE_SIZE + 1,
    );
    const page = rows.slice(0, MESSAGES_PAGE_SIZE);
    return {
      messages: page.map((row) => this.toMessage(row)).reverse(),
      nextCursor: rows.length > MESSAGES_PAGE_SIZE ? String(page[page.length - 1].seq) : null,
    };
  }

  /** Quem é a pessoa no pedido: cliente, prestador do pedido ou admin da empresa. Outra pessoa: 404. */
  private async participation(userId: string, serviceRequestId: string): Promise<Participation> {
    const tx = this.transactions.current();
    const [request] = await tx
      .select({ status: serviceRequests.status, clientId: serviceRequests.clientId, providerMembershipId: serviceRequests.providerMembershipId })
      .from(serviceRequests)
      .where(and(eq(serviceRequests.id, serviceRequestId), eq(serviceRequests.companyId, sql`app.current_company_id()`)));
    if (!request) throw new NotFoundException();

    let providerUserId: string | null = null;
    if (request.providerMembershipId) {
      const [provider] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, request.providerMembershipId));
      providerUserId = provider?.userId ?? null;
    }
    const common = { status: request.status, clientId: request.clientId, providerUserId };
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

  private select(where: ReturnType<typeof and>, limit?: number) {
    const query = this.transactions
      .current()
      .select(columns)
      .from(messages)
      .innerJoin(users, eq(users.id, messages.senderId))
      .where(where)
      .orderBy(desc(messages.seq));
    return limit === undefined ? query : query.limit(limit);
  }

  private toMessage(row: { id: string; serviceRequestId: string; clientMessageId: string; senderRole: 'client' | 'provider'; senderName: string; body: string; createdAt: Date }): Message {
    return {
      id: row.id,
      serviceRequestId: row.serviceRequestId,
      clientMessageId: row.clientMessageId,
      senderRole: row.senderRole,
      senderName: row.senderName,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function parseCursor(cursor: string): number {
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new BadRequestException({ message: 'Dados inválidos', issues: [{ path: 'cursor', message: 'Cursor inválido' }] });
  }
  return value;
}
