import { Inject, Logger, OnApplicationShutdown } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { serviceRequestRoom, sessionRoom, socketEvents, subscribeServiceRequestSchema, userRoom } from '@despacho/shared';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { hashToken } from '../auth/crypto.js';
import { SessionsService } from '../auth/sessions.service.js';
import { REDIS } from '../redis/redis.module.js';
import { ServiceRequestsService } from '../service-requests/service-requests.service.js';
import { RealtimeService } from './realtime.service.js';

interface SocketData {
  userId: string;
  tokenHash: string;
}

/**
 * Um socket por app aberto, autenticado pelo token da sessão (`auth: { token }`); token inválido
 * recebe `connect_error` com "Não autenticado".
 * Entra sozinho em `user:{id}`; entra em `service_request:{id}` pedindo, se tiver acesso ao pedido.
 * O token vai no handshake, não em cookie, então qualquer origem pode conectar.
 */
@WebSocketGateway({ cors: { origin: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnApplicationShutdown {
  private readonly logger = new Logger('RealtimeGateway');
  private pub: Redis | null = null;
  private sub: Redis | null = null;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly sessions: SessionsService,
    private readonly requests: ServiceRequestsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  afterInit(server: Server): void {
    // Adapter Redis: eventos chegam aos sockets de qualquer instância da API (ADR 0005).
    this.pub = this.redis.duplicate();
    this.sub = this.redis.duplicate();
    server.adapter(createAdapter(this.pub, this.sub));
    // Autentica antes de aceitar a conexão: nenhuma mensagem chega sem usuário definido.
    server.use((socket, next) => {
      const token = (socket.handshake.auth as { token?: unknown })?.token;
      const lookup = typeof token === 'string' ? this.sessions.userIdForToken(token) : Promise.resolve(null);
      lookup.then(
        (userId) => {
          if (!userId) return next(new Error('Não autenticado'));
          (socket.data as SocketData).userId = userId;
          (socket.data as SocketData).tokenHash = hashToken(token as string);
          next();
        },
        () => next(new Error('Não autenticado')),
      );
    });
    this.realtime.attach(server);
    // Sessão revogada (sair, trocar a senha, excluir a conta): o socket aberto com ela cai.
    this.sessions.onRevoked((revocation) => this.realtime.disconnect(revocation));
  }

  async handleConnection(client: Socket<never, never, never, SocketData>): Promise<void> {
    await client.join([userRoom(client.data.userId), sessionRoom(client.data.tokenHash)]);
  }

  @SubscribeMessage(socketEvents.subscribeServiceRequest)
  async subscribe(
    @ConnectedSocket() client: Socket<never, never, never, SocketData>,
    @MessageBody() body: unknown,
  ): Promise<{ ok: boolean }> {
    const input = subscribeServiceRequestSchema.safeParse(body);
    if (!input.success || !client.data.userId) return { ok: false };
    const allowed = await this.requests.canFollow(client.data.userId, input.data.serviceRequestId);
    if (allowed) await client.join(serviceRequestRoom(input.data.serviceRequestId));
    return { ok: allowed };
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.pub?.quit(), this.sub?.quit()]);
    this.logger.log('Socket.IO encerrado');
  }
}
