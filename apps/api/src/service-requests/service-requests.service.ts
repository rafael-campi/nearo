import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  fullViewStatuses,
  socketEvents,
  type AcceptServiceRequestResponse,
  type CategoryOption,
  type ConfirmServiceRequestResponse,
  type OpenServiceRequest,
  type ProviderServiceRequest,
  type RequestProvider,
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
  private async broadcast(request: ServiceRequest, alsoRefresh: string[] = []): Promise<void> {
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
    this.announceOpenRequestsChanged([...eligible.map((e) => e.user_id), ...alsoRefresh], request.companyId);
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

  /**
   * Confirmação do cliente: move para `confirmed` e libera endereço completo e telefones.
   * O prestador tem no máximo um pedido ativo: se ele assumiu outro enquanto este esperava,
   * o pedido volta para `open` (sem contar como recusa) e os aptos são avisados de novo.
   */
  async confirm(clientId: string, serviceRequestId: string): Promise<ConfirmServiceRequestResponse> {
    const locked = await this.lockAwaitingClient(clientId, serviceRequestId);
    const tx = this.transactions.current();
    // Serializa as confirmações do mesmo prestador, para dois clientes não o confirmarem ao mesmo tempo.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'active:' + locked.providerUserId}, 0))`);
    const now = this.clock.now();

    const { rows } = await tx.execute<{ busy: boolean }>(
      sql`select app.provider_has_active_request(${locked.providerUserId}) as busy`,
    );
    if (rows[0].busy) {
      await this.reopen(serviceRequestId, now);
      const [request] = await this.find(eq(serviceRequests.id, serviceRequestId));
      await this.notifications.notify({
        userIds: [clientId],
        type: 'request_declined',
        title: 'O prestador não está mais disponível',
        body: `${request.categoryName} · estamos procurando outro prestador`,
        serviceRequestId,
      });
      await this.afterReopen(request, [locked.providerUserId]);
      return { id: serviceRequestId, status: request.status };
    }

    await tx
      .update(serviceRequests)
      .set({ status: 'confirmed', confirmedAt: now, updatedAt: now })
      .where(eq(serviceRequests.id, serviceRequestId));
    const [request] = await this.find(eq(serviceRequests.id, serviceRequestId));
    await this.notifications.notify({
      userIds: [locked.providerUserId],
      type: 'request_confirmed',
      title: `${request.clientName.split(' ')[0]} confirmou você`,
      body: `${request.categoryName} · endereço e telefone liberados`,
      serviceRequestId,
    });
    this.announceStatus(request, [clientId, locked.providerUserId]);
    return { id: serviceRequestId, status: request.status };
  }

  /** Recusa do cliente: registrada, o prestador deixa de ver o pedido e os demais aptos são avisados de novo. */
  async declineProvider(clientId: string, serviceRequestId: string): Promise<void> {
    const locked = await this.lockAwaitingClient(clientId, serviceRequestId);
    await this.transactions
      .current()
      .insert(serviceRequestDeclines)
      .values({
        companyId: sql`app.current_company_id()`,
        serviceRequestId,
        providerMembershipId: locked.providerMembershipId,
        by: 'client',
      })
      .onConflictDoNothing();
    await this.reopen(serviceRequestId, this.clock.now());
    const [request] = await this.find(eq(serviceRequests.id, serviceRequestId));
    await this.notifications.notify({
      userIds: [locked.providerUserId],
      type: 'request_declined',
      title: 'O cliente recusou seu aceite',
      body: `${request.categoryName} · o pedido não é mais seu`,
      serviceRequestId,
    });
    await this.afterReopen(request, [locked.providerUserId]);
  }

  /** Pedidos do prestador nesta empresa: visão reduzida até a confirmação; depois, endereço completo e telefone. */
  async forProvider(userId: string): Promise<ProviderServiceRequest[]> {
    const membershipId = await this.ownProviderMembership(userId);
    const rows = await this.rows(
      and(eq(serviceRequests.providerMembershipId, membershipId), inArray(serviceRequests.status, ['awaiting_client', ...fullViewStatuses])),
    );
    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      categoryName: r.categoryName,
      description: r.description,
      neighborhood: r.neighborhood,
      clientFirstName: r.clientName.split(' ')[0],
      status: r.status,
      details: fullViewStatuses.includes(r.status)
        ? {
            clientName: r.clientName,
            clientPhone: r.clientPhone,
            location: { latitude: r.location.y, longitude: r.location.x },
            addressComplement: r.addressComplement,
          }
        : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Pedido do cliente (dono), esperando a resposta dele, travado para decidir. */
  private async lockAwaitingClient(clientId: string, serviceRequestId: string) {
    const [locked] = await this.transactions
      .current()
      .select({
        status: serviceRequests.status,
        providerMembershipId: serviceRequests.providerMembershipId,
      })
      .from(serviceRequests)
      .where(and(eq(serviceRequests.id, serviceRequestId), eq(serviceRequests.clientId, clientId)))
      .for('update');
    if (!locked) throw new NotFoundException();
    if (locked.status !== 'awaiting_client' || !locked.providerMembershipId) {
      throw new ConflictException('Pedido não está mais aguardando sua resposta');
    }
    const [provider] = await this.transactions
      .current()
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.id, locked.providerMembershipId));
    return { providerMembershipId: locked.providerMembershipId, providerUserId: provider.userId };
  }

  private async reopen(serviceRequestId: string, now: Date): Promise<void> {
    await this.transactions
      .current()
      .update(serviceRequests)
      .set({ status: 'open', providerMembershipId: null, acceptedAt: null, updatedAt: now })
      .where(eq(serviceRequests.id, serviceRequestId));
  }

  /** Pedido voltou para `open`: o cliente vê "procurando prestador" e os aptos são avisados de novo (broadcast). */
  private async afterReopen(request: ServiceRequest, extraUsers: string[]): Promise<void> {
    await this.broadcast(request, extraUsers);
    const clientId = await this.clientOf(request.id);
    this.announceStatus(request, [clientId, ...extraUsers]);
  }

  private async clientOf(serviceRequestId: string): Promise<string> {
    const [row] = await this.transactions
      .current()
      .select({ clientId: serviceRequests.clientId })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, serviceRequestId));
    return row.clientId;
  }

  private announceStatus(request: ServiceRequest, userIds: string[]): void {
    const event = { id: request.id, companyId: request.companyId, status: request.status };
    this.transactions.afterCommit(() => {
      this.realtime.toUsers(userIds, socketEvents.serviceRequestUpdated, event);
      this.realtime.toServiceRequest(request.id, socketEvents.serviceRequestUpdated, event);
    });
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
    const rows = await this.rows(where);
    return rows.map(({ location, createdAt, clientPhone: _clientPhone, ...row }) => ({
      ...row,
      location: { latitude: location.y, longitude: location.x },
      createdAt: createdAt.toISOString(),
    }));
  }

  private async rows(where: SQL | undefined) {
    return this.transactions
      .current()
      .select({
        id: serviceRequests.id,
        companyId: serviceRequests.companyId,
        companyName: companies.name,
        categoryId: serviceRequests.categoryId,
        categoryName: categories.name,
        clientName: users.name,
        clientPhone: users.phone,
        description: serviceRequests.description,
        location: serviceRequests.location,
        addressComplement: serviceRequests.addressComplement,
        neighborhood: serviceRequests.neighborhood,
        status: serviceRequests.status,
        // Nome, telefone (só depois da confirmação) e histórico do prestador; a nota entra com as avaliações.
        provider: sql<RequestProvider | null>`app.request_provider(${serviceRequests.id})`,
        createdAt: serviceRequests.createdAt,
      })
      .from(serviceRequests)
      .innerJoin(companies, eq(companies.id, serviceRequests.companyId))
      .innerJoin(categories, eq(categories.id, serviceRequests.categoryId))
      .innerJoin(users, eq(users.id, serviceRequests.clientId))
      .where(where)
      .orderBy(desc(serviceRequests.createdAt));
  }
}

function formatKm(meters: number): string {
  return `${(Math.round(meters / 100) / 10).toLocaleString('pt-BR')} km`;
}
