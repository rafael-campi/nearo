import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  socketEvents,
  type AcceptServiceRequestResponse,
  type CategoryOption,
  type OpenServiceRequest,
  type ServiceRequest,
} from '@despacho/shared';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { Clock } from '../clock.js';
import { categories, companies, memberships, serviceRequestDeclines, serviceRequests, users } from '../db/schema.js';
import { DATABASE, TenantTransactions, type Database } from '../db/tenant-transactions.js';
import { ReverseGeocoder } from '../geocoding/reverse-geocoder.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { eligiblePairs, type EligiblePair } from './eligibility.js';
import type { CreateServiceRequestInput } from './service-requests.controller.js';

@Injectable()
export class ServiceRequestsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly transactions: TenantTransactions,
    private readonly geocoder: ReverseGeocoder,
    private readonly clock: Clock,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Categorias ativas da empresa, para quem pede ou atende. */
  categoryOptions(): Promise<CategoryOption[]> {
    return this.transactions
      .current()
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.companyId, sql`app.current_company_id()`), eq(categories.active, true)))
      .orderBy(asc(sql`lower(${categories.name})`));
  }

  async create(clientId: string, body: CreateServiceRequestInput): Promise<ServiceRequest> {
    const tx = this.transactions.current();
    const [category] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.id, body.categoryId),
          eq(categories.companyId, sql`app.current_company_id()`),
          eq(categories.active, true),
        ),
      );
    if (!category) {
      throw new BadRequestException({ message: 'Dados inválidos', issues: [{ path: 'categoryId', message: 'Categoria inválida' }] });
    }

    const neighborhood = await this.geocoder.neighborhood(body.location);
    const now = this.clock.now();
    const [created] = await tx
      .insert(serviceRequests)
      .values({
        companyId: sql`app.current_company_id()`,
        clientId,
        categoryId: body.categoryId,
        description: body.description,
        location: { x: body.location.longitude, y: body.location.latitude },
        addressComplement: body.addressComplement,
        neighborhood,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: serviceRequests.id });
    const [request] = await this.find(eq(serviceRequests.id, created.id));
    await this.broadcast(request);
    return request;
  }

  /** Broadcast: avisa os prestadores aptos de um pedido novo (ou que voltou a ficar aberto). */
  private async broadcast(request: ServiceRequest): Promise<void> {
    const eligible = await this.eligible({ serviceRequestId: request.id });
    // Cada prestador recebe a distância a partir do próprio endereço-base.
    for (const provider of eligible) {
      await this.notifications.notify({
        userIds: [provider.user_id],
        type: 'new_request',
        title: `Pedido novo: ${request.categoryName}`,
        body: [request.neighborhood, `a ${formatKm(provider.meters)} de você`].filter(Boolean).join(' · '),
        serviceRequestId: request.id,
      });
    }
    this.announceOpenRequestsChanged(eligible.map((e) => e.user_id), request.companyId);
  }

  /** Pedidos abertos para os quais o prestador (vínculo próprio nesta empresa) é apto: visão reduzida. */
  async openForProvider(userId: string): Promise<OpenServiceRequest[]> {
    const membershipId = await this.ownProviderMembership(userId);
    const pairs = await this.eligible({ membershipId, openOnly: true });
    if (pairs.length === 0) return [];
    const meters = new Map(pairs.map((p) => [p.service_request_id, p.meters]));
    const rows = await this.find(inArray(serviceRequests.id, [...meters.keys()]));
    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      categoryName: r.categoryName,
      description: r.description,
      neighborhood: r.neighborhood,
      distanceKm: Math.round((meters.get(r.id) ?? 0) / 100) / 10,
      clientFirstName: r.clientName.split(' ')[0],
      createdAt: r.createdAt,
    }));
  }

  /**
   * Aceite do prestador: trava o pedido (o segundo aceite espera e encontra o pedido já tomado),
   * move para `awaiting_client` e avisa o cliente.
   */
  async accept(userId: string, serviceRequestId: string): Promise<AcceptServiceRequestResponse> {
    const membershipId = await this.ownProviderMembership(userId);
    const tx = this.transactions.current();
    const [locked] = await tx
      .select({ status: serviceRequests.status, clientId: serviceRequests.clientId })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, serviceRequestId))
      .for('update');
    if (!locked) throw new NotFoundException();
    if (locked.status !== 'open') throw new ConflictException('Pedido não está mais disponível');

    const eligible = await this.eligible({ serviceRequestId });
    if (!eligible.some((e) => e.membership_id === membershipId)) throw new NotFoundException();

    const now = this.clock.now();
    await tx
      .update(serviceRequests)
      .set({ status: 'awaiting_client', providerMembershipId: membershipId, acceptedAt: now, updatedAt: now })
      .where(eq(serviceRequests.id, serviceRequestId));

    const [request] = await this.find(eq(serviceRequests.id, serviceRequestId));
    const [provider] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
    await this.notifications.notify({
      userIds: [locked.clientId],
      type: 'request_accepted',
      title: `${provider.name.split(' ')[0]} aceitou seu pedido`,
      body: `${request.categoryName} · confirme ou recuse o prestador`,
      serviceRequestId,
    });
    const event = { id: serviceRequestId, companyId: request.companyId, status: request.status };
    this.transactions.afterCommit(() => {
      this.realtime.toUser(locked.clientId, socketEvents.serviceRequestUpdated, event);
      this.realtime.toServiceRequest(serviceRequestId, socketEvents.serviceRequestUpdated, event);
    });
    this.announceOpenRequestsChanged(eligible.map((e) => e.user_id), request.companyId);
    return { id: serviceRequestId, status: request.status };
  }

  /** Recusa do prestador: registrada; ele deixa de ver o pedido. */
  async decline(userId: string, serviceRequestId: string): Promise<void> {
    const membershipId = await this.ownProviderMembership(userId);
    const visible = await this.eligible({ serviceRequestId, membershipId, openOnly: true });
    if (visible.length === 0) throw new NotFoundException();
    await this.transactions
      .current()
      .insert(serviceRequestDeclines)
      .values({ companyId: sql`app.current_company_id()`, serviceRequestId, providerMembershipId: membershipId, by: 'provider' })
      .onConflictDoNothing();
    const [request] = await this.find(eq(serviceRequests.id, serviceRequestId));
    this.announceOpenRequestsChanged([userId], request.companyId);
  }

  /** Quem pode acompanhar o pedido pelo socket: o cliente, o prestador do pedido ou um admin da empresa. */
  async canFollow(userId: string, serviceRequestId: string): Promise<boolean> {
    const { rows } = await this.db.execute<{ company_id: string | null }>(
      sql`select app.service_request_company(${serviceRequestId}) as company_id`,
    );
    const companyId = rows[0]?.company_id;
    if (!companyId) return false;
    return this.transactions.run({ userId, companyId }, async (tx) => {
      const { rows: allowed } = await tx.execute(sql`
        select 1
          from service_requests r
          left join memberships pm on pm.id = r.provider_membership_id
         where r.id = ${serviceRequestId}
           and (
             r.client_id = ${userId}
             or pm.user_id = ${userId}
             or exists (
               select 1 from memberships am
                where am.company_id = r.company_id and am.user_id = ${userId} and am.role = 'admin' and am.active
             )
           )`);
      return allowed.length > 0;
    });
  }

  private announceOpenRequestsChanged(userIds: string[], companyId: string): void {
    this.transactions.afterCommit(() =>
      this.realtime.toUsers(userIds, socketEvents.openRequestsChanged, { companyId }),
    );
  }

  private async eligible(filter: Parameters<typeof eligiblePairs>[0]): Promise<EligiblePair[]> {
    const { rows } = await this.transactions.current().execute<EligiblePair>(eligiblePairs(filter));
    return rows.map((r) => ({ ...r, meters: Number(r.meters) }));
  }

  private async ownProviderMembership(userId: string): Promise<string> {
    const [membership] = await this.transactions
      .current()
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.companyId, sql`app.current_company_id()`),
          eq(memberships.userId, userId),
          eq(memberships.role, 'provider'),
        ),
      );
    if (!membership) throw new NotFoundException();
    return membership.id;
  }

  /** Pedidos da empresa atual, mais recentes primeiro. */
  forCompany(): Promise<ServiceRequest[]> {
    return this.find(eq(serviceRequests.companyId, sql`app.current_company_id()`));
  }

  /** "Meus pedidos": os do cliente, em todas as empresas onde ainda tem vínculo ativo. */
  mine(clientId: string): Promise<ServiceRequest[]> {
    return this.find(
      and(
        eq(serviceRequests.clientId, clientId),
        sql`exists (
          select 1 from ${memberships}
          where ${memberships.companyId} = ${serviceRequests.companyId}
            and ${memberships.userId} = ${clientId}
            and ${memberships.role} = 'client'
            and ${memberships.active}
        )`,
        eq(companies.active, true),
      ),
    );
  }

  private async find(where: SQL | undefined): Promise<ServiceRequest[]> {
    const rows = await this.transactions
      .current()
      .select({
        id: serviceRequests.id,
        companyId: serviceRequests.companyId,
        companyName: companies.name,
        categoryId: serviceRequests.categoryId,
        categoryName: categories.name,
        clientName: users.name,
        description: serviceRequests.description,
        location: serviceRequests.location,
        addressComplement: serviceRequests.addressComplement,
        neighborhood: serviceRequests.neighborhood,
        status: serviceRequests.status,
        createdAt: serviceRequests.createdAt,
      })
      .from(serviceRequests)
      .innerJoin(companies, eq(companies.id, serviceRequests.companyId))
      .innerJoin(categories, eq(categories.id, serviceRequests.categoryId))
      .innerJoin(users, eq(users.id, serviceRequests.clientId))
      .where(where)
      .orderBy(desc(serviceRequests.createdAt));
    return rows.map(({ location, createdAt, ...row }) => ({
      ...row,
      location: { latitude: location.y, longitude: location.x },
      createdAt: createdAt.toISOString(),
    }));
  }
}

function formatKm(meters: number): string {
  return `${(Math.round(meters / 100) / 10).toLocaleString('pt-BR')} km`;
}
