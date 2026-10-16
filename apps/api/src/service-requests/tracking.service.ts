import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  PROXIMITY_RADIUS_M,
  socketEvents,
  type Coordinates,
  type ProviderLocation,
  type ServiceRequestLocationEvent,
} from '@despacho/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { Clock } from '../clock.js';
import { memberships, providerPositions, serviceRequests, users } from '../db/schema.js';
import { TenantTransactions } from '../db/tenant-transactions.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { REDIS } from '../redis/redis.module.js';

/** Um ponto a cada ~30 s vai para o Postgres; o app envia a cada ~10 s. */
const STORE_EVERY_MS = 30_000;
/** A última posição some sozinha do Redis se o prestador parar de enviar. */
const LAST_POSITION_TTL_S = 60 * 60;

interface LastPosition extends ProviderLocation {
  /** Quando o último ponto foi gravado no Postgres. */
  storedAt: string;
}

const lastKey = (serviceRequestId: string) => `gps:last:${serviceRequestId}`;

/**
 * GPS do prestador enquanto o pedido está `en_route` (ADR 0005): última posição no Redis, trilha no Postgres,
 * aviso único ao entrar no raio de aviso. Ao chegar, a posição deixa de ser guardada e emitida.
 */
@Injectable()
export class TrackingService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly transactions: TenantTransactions,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly clock: Clock,
  ) {}

  /** O prestador do pedido envia a posição. Só vale com o pedido a caminho. */
  async report(userId: string, serviceRequestId: string, position: Coordinates): Promise<void> {
    const tx = this.transactions.current();
    const [request] = await tx
      .select({ status: serviceRequests.status, clientId: serviceRequests.clientId, providerName: users.name })
      .from(serviceRequests)
      .innerJoin(memberships, eq(memberships.id, serviceRequests.providerMembershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(serviceRequests.id, serviceRequestId), eq(memberships.userId, userId)));
    if (!request) throw new NotFoundException();
    if (request.status !== 'en_route') throw new ConflictException('O pedido não está a caminho');

    const now = this.clock.now();
    const previous = await this.read(serviceRequestId);
    const store = !previous || now.getTime() - new Date(previous.storedAt).getTime() >= STORE_EVERY_MS;
    if (store) {
      await tx.insert(providerPositions).values({
        companyId: sql`app.current_company_id()`,
        serviceRequestId,
        location: { x: position.longitude, y: position.latitude },
        recordedAt: now,
      });
    }

    // Raio de aviso: o `update` condicional garante um único aviso por pedido, mesmo com envios concorrentes.
    const point = sql`st_setsrid(st_makepoint(${position.longitude}, ${position.latitude}), 4326)::geography`;
    const near = await tx
      .update(serviceRequests)
      .set({ proximityNotifiedAt: now })
      .where(
        and(
          eq(serviceRequests.id, serviceRequestId),
          isNull(serviceRequests.proximityNotifiedAt),
          sql`st_dwithin(${serviceRequests.location}::geography, ${point}, ${PROXIMITY_RADIUS_M})`,
        ),
      )
      .returning({ id: serviceRequests.id });
    if (near.length > 0) {
      await this.notifications.notify({
        userIds: [request.clientId],
        type: 'provider_nearby',
        title: `${request.providerName.split(' ')[0]} está chegando`,
        body: `A menos de ${PROXIMITY_RADIUS_M} m do endereço`,
        serviceRequestId,
      });
    }

    const location: ProviderLocation = { ...position, at: now.toISOString() };
    const last: LastPosition = { ...location, storedAt: store ? now.toISOString() : previous!.storedAt };
    const event: ServiceRequestLocationEvent = { id: serviceRequestId, ...location };
    this.transactions.afterCommit(async () => {
      await this.redis.set(lastKey(serviceRequestId), JSON.stringify(last), 'EX', LAST_POSITION_TTL_S);
      this.realtime.toUser(request.clientId, socketEvents.serviceRequestLocation, event);
    });
  }

  /** Última posição, para o cliente do pedido; null fora do `en_route`. */
  async lastFor(clientId: string, serviceRequestId: string): Promise<ProviderLocation | null> {
    const [request] = await this.transactions
      .current()
      .select({ status: serviceRequests.status })
      .from(serviceRequests)
      .where(and(eq(serviceRequests.id, serviceRequestId), eq(serviceRequests.clientId, clientId)));
    if (!request) throw new NotFoundException();
    if (request.status !== 'en_route') return null;
    const last = await this.read(serviceRequestId);
    return last ? { latitude: last.latitude, longitude: last.longitude, at: last.at } : null;
  }

  /** O pedido saiu de `en_route` (chegou, desistência, cancelamento): a posição deixa de ser exposta. */
  async clear(serviceRequestId: string): Promise<void> {
    await this.redis.del(lastKey(serviceRequestId));
  }

  private async read(serviceRequestId: string): Promise<LastPosition | null> {
    const raw = await this.redis.get(lastKey(serviceRequestId));
    return raw ? (JSON.parse(raw) as LastPosition) : null;
  }
}
