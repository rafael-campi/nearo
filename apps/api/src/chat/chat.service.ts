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
import { messages, users } from '../db/schema.js';
import { TenantTransactions } from '../db/tenant-transactions.js';
import { PushService } from '../push/push.service.js';
import { RequestAccessService } from '../service-requests/request-access.service.js';
import { PhotosService } from '../photos/photos.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const columns = {
  id: messages.id,
  serviceRequestId: messages.serviceRequestId,
  clientMessageId: messages.clientMessageId,
  senderRole: messages.senderRole,
  senderName: users.name,
  body: messages.body,
  photoKey: messages.photoKey,
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
    private readonly photos: PhotosService,
    private readonly access: RequestAccessService,
    private readonly push: PushService,
  ) {}

  async send(userId: string, serviceRequestId: string, input: SendMessage): Promise<Message> {
    const who = await this.access.participation(userId, serviceRequestId);
    if (who.role === 'admin') throw new NotFoundException();
    if (!(chatWritableStatuses as readonly string[]).includes(who.status)) {
      throw new ConflictException('A conversa está encerrada');
    }

    const tx = this.transactions.current();
    // Uma foto por mensagem. A chave só é consumida se a mensagem for nova (reenvio não gasta de novo).
    const [existing] = await this.select(
      and(eq(messages.serviceRequestId, serviceRequestId), eq(messages.senderId, userId), eq(messages.clientMessageId, input.clientMessageId)),
    );
    if (existing) return this.toMessage(existing);
    if (input.photoKey) {
      try {
        await this.photos.claim(userId, [input.photoKey], 'chat_photo', 'photoKey');
      } catch (error) {
        // Reenvio simultâneo: a primeira cópia já consumiu a chave e gravou a mensagem.
        const [again] = await this.select(
          and(eq(messages.serviceRequestId, serviceRequestId), eq(messages.senderId, userId), eq(messages.clientMessageId, input.clientMessageId)),
        );
        if (again) return this.toMessage(again);
        throw error;
      }
    }
    const [inserted] = await tx
      .insert(messages)
      .values({
        companyId: sql`app.current_company_id()`,
        serviceRequestId,
        senderId: userId,
        senderRole: who.role,
        clientMessageId: input.clientMessageId,
        body: input.body ?? '',
        photoKey: input.photoKey ?? null,
        createdAt: this.clock.now(),
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });

    if (!inserted) {
      // Reenvio simultâneo da mesma mensagem: devolve a que já existe, sem emitir de novo.
      const [duplicate] = await this.select(
        and(eq(messages.serviceRequestId, serviceRequestId), eq(messages.senderId, userId), eq(messages.clientMessageId, input.clientMessageId)),
      );
      return this.toMessage(duplicate);
    }

    const [row] = await this.select(eq(messages.id, inserted.id));
    const message = await this.toMessage(row);
    const rooms = [userRoom(who.clientId), ...(who.providerUserId ? [userRoom(who.providerUserId)] : []), serviceRequestRoom(serviceRequestId)];
    this.transactions.afterCommit(() => this.realtime.toRooms(rooms, socketEvents.messageNew, message));
    // Mensagem nova vira push para o outro lado (não vira "atualização": o chat tem a própria tela).
    const recipient = who.role === 'client' ? who.providerUserId : who.clientId;
    if (recipient) {
      const companyId = await this.companyId();
      this.transactions.afterCommit(() =>
        this.push.enqueue({
          userId: recipient,
          title: message.senderName.split(' ')[0],
          body: message.body || '📷 Foto',
          data: { type: 'new_message', serviceRequestId, companyId, role: who.role === 'client' ? 'provider' : 'client' },
        }),
      );
    }
    return message;
  }

  private async companyId(): Promise<string> {
    const { rows } = await this.transactions.current().execute<{ id: string }>(sql`select app.current_company_id() as id`);
    return rows[0].id;
  }

  /** Mensagens em ordem cronológica, as mais recentes primeiro por página; `cursor` leva às mais antigas. */
  async list(userId: string, serviceRequestId: string, cursor: string | undefined): Promise<MessagePage> {
    await this.access.participation(userId, serviceRequestId);
    const before = cursor === undefined ? undefined : parseCursor(cursor);
    const rows = await this.select(
      and(eq(messages.serviceRequestId, serviceRequestId), before === undefined ? undefined : lt(messages.seq, before)),
      MESSAGES_PAGE_SIZE + 1,
    );
    const page = rows.slice(0, MESSAGES_PAGE_SIZE);
    return {
      messages: (await Promise.all(page.map((row) => this.toMessage(row)))).reverse(),
      nextCursor: rows.length > MESSAGES_PAGE_SIZE ? String(page[page.length - 1].seq) : null,
    };
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

  private async toMessage(row: {
    id: string;
    serviceRequestId: string;
    clientMessageId: string;
    senderRole: 'client' | 'provider';
    senderName: string;
    body: string;
    photoKey: string | null;
    createdAt: Date;
  }): Promise<Message> {
    return {
      id: row.id,
      serviceRequestId: row.serviceRequestId,
      clientMessageId: row.clientMessageId,
      senderRole: row.senderRole,
      senderName: row.senderName,
      body: row.body,
      photoUrl: row.photoKey ? (await this.photos.readUrls([row.photoKey]))[0] : null,
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
