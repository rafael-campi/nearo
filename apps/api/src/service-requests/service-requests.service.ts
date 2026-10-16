import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  clientCancellableStatuses,
  fullViewStatuses,
  withdrawableStatuses,
  type RequestEvent,
  nextServiceStep,
  type ServiceStep,
  socketEvents,
  type AcceptServiceRequestResponse,
  type CategoryOption,
  type EligibleProvider,
  type RequestDecline,
  type ConfirmServiceRequestResponse,
  type OpenServiceRequest,
  type ProviderServiceRequest,
  type RequestProvider,
  type ServiceRequest,
} from '@despacho/shared';
import { and, asc, desc, eq, gt, inArray, or, sql, type SQL } from 'drizzle-orm';
import { Clock } from '../clock.js';
import { DeadlineScheduler } from '../deadlines/deadline-scheduler.js';
import {
  categories,
  companies,
  memberships,
  serviceRequestDeclines,
  serviceRequestEvents,
  serviceRequests,
  users,
} from '../db/schema.js';
import { DATABASE, TenantTransactions, type Database } from '../db/tenant-transactions.js';
import { ReverseGeocoder } from '../geocoding/reverse-geocoder.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { TrackingService } from './tracking.service.js';
import { eligiblePairs, type EligiblePair } from './eligibility.js';
import type { CreateServiceRequestInput } from './service-requests.controller.js';

const MINUTE = 60_000;
/** Prazos do pedido (docs/v1-scope.md, "Regras do pedido"). */
export const NO_ACCEPTANCE_MS = 15 * MINUTE;
export const CLIENT_REMINDER_MS = 5 * MINUTE;
export const CLIENT_TIMEOUT_MS = 10 * MINUTE;

@Injectable()
export class ServiceRequestsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly transactions: TenantTransactions,
    private readonly geocoder: ReverseGeocoder,
    private readonly clock: Clock,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly scheduler: DeadlineScheduler,
    private readonly tracking: TrackingService,
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
    await this.dispatch(request, 'created');
    return request;
  }

  /**
   * Pedido novo ou que voltou a ficar aberto. Broadcast: avisa os prestadores aptos. Manual: avisa os
   * admins, que atribuem. O modo vale para este momento; o pedido guarda o que foi decidido.
   */
  private async dispatch(request: ServiceRequest, reason: 'created' | 'reopened', alsoRefresh: string[] = []): Promise<void> {
    const [company] = await this.transactions
      .current()
      .select({ mode: companies.assignmentMode })
      .from(companies)
      .where(eq(companies.id, sql`app.current_company_id()`));
    const broadcast = company.mode === 'broadcast';
    const openedAt = this.clock.now();
    await this.transactions
      .current()
      .update(serviceRequests)
      .set({ broadcast, openedAt })
      .where(eq(serviceRequests.id, request.id));
    if (broadcast) {
      this.deadline('no_acceptance', request, openedAt, NO_ACCEPTANCE_MS);
      return this.broadcast(request, alsoRefresh);
    }
    await this.notifyAdmins(request, reason);
    this.announceOpenRequestsChanged(alsoRefresh, request.companyId);
  }

  private async notifyAdmins(request: ServiceRequest, reason: 'created' | 'reopened'): Promise<void> {
    await this.notifications.notify({
      userIds: await this.activeAdmins(),
      type: 'request_needs_assignment',
      title: reason === 'created' ? `Pedido novo para atribuir: ${request.categoryName}` : `Pedido voltou para aberto: ${request.categoryName}`,
      body: [request.neighborhood, request.clientName].filter(Boolean).join(' · '),
      serviceRequestId: request.id,
    });
  }

  /** Broadcast: avisa os prestadores aptos de um pedido novo (ou que voltou a ficar aberto). */
  private async broadcast(request: ServiceRequest, alsoRefresh: string[] = []): Promise<void> {
    const eligible = await this.eligible({ serviceRequestId: request.id, broadcastOnly: true });
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

  /**
   * Pedidos abertos para os quais o prestador (vínculo próprio nesta empresa) é apto, mais os que o admin
   * atribuiu a ele: visão reduzida.
   */
  async openForProvider(userId: string): Promise<OpenServiceRequest[]> {
    const membershipId = await this.ownProviderMembership(userId);
    const pairs = await this.eligible({ membershipId, openOnly: true, broadcastOnly: true });
    const { rows: assignedRows } = await this.transactions.current().execute<{ id: string; meters: number | null }>(sql`
      select r.id,
             st_distance(p.base_location::geography, r.location::geography) as meters
        from service_requests r
        left join provider_profiles p on p.membership_id = r.provider_membership_id
       where r.status = 'assigned' and r.provider_membership_id = ${membershipId}`);
    const assigned = new Set(assignedRows.map((r) => r.id));
    const meters = new Map<string, number>([
      ...pairs.map((p) => [p.service_request_id, p.meters] as const),
      ...assignedRows.map((r) => [r.id, Number(r.meters ?? 0)] as const),
    ]);
    if (meters.size === 0) return [];
    const rows = await this.find(inArray(serviceRequests.id, [...meters.keys()]));
    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      categoryName: r.categoryName,
      description: r.description,
      neighborhood: r.neighborhood,
      distanceKm: Math.round((meters.get(r.id) ?? 0) / 100) / 10,
      clientFirstName: r.clientName.split(' ')[0],
      assigned: assigned.has(r.id),
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
      .select({
        status: serviceRequests.status,
        clientId: serviceRequests.clientId,
        providerMembershipId: serviceRequests.providerMembershipId,
      })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, serviceRequestId))
      .for('update');
    if (!locked) throw new NotFoundException();

    // Atribuído pelo admin: só o prestador escolhido aceita. Aberto: qualquer apto (broadcast).
    let eligible: EligiblePair[] = [];
    if (locked.status === 'assigned') {
      if (locked.providerMembershipId !== membershipId) throw new NotFoundException();
    } else {
      if (locked.status !== 'open') throw new ConflictException('Pedido não está mais disponível');
      eligible = await this.eligible({ serviceRequestId, broadcastOnly: true });
      if (!eligible.some((e) => e.membership_id === membershipId)) throw new NotFoundException();
    }

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
    this.deadline('awaiting_client_reminder', request, now, CLIENT_REMINDER_MS);
    this.deadline('awaiting_client_timeout', request, now, CLIENT_TIMEOUT_MS);
    const event = { id: serviceRequestId, companyId: request.companyId, status: request.status };
    this.transactions.afterCommit(() => {
      this.realtime.toUser(locked.clientId, socketEvents.serviceRequestUpdated, event);
      this.realtime.toServiceRequest(serviceRequestId, socketEvents.serviceRequestUpdated, event);
    });
    this.announceOpenRequestsChanged([userId, ...eligible.map((e) => e.user_id)], request.companyId);
    return { id: serviceRequestId, status: request.status };
  }

  /**
   * Recusa do prestador: registrada; ele deixa de ver o pedido. Se o admin tinha atribuído o pedido a
   * ele, o pedido volta para `open` e segue o modo da empresa (aptos avisados, ou admin avisado).
   */
  async decline(userId: string, serviceRequestId: string): Promise<void> {
    const membershipId = await this.ownProviderMembership(userId);
    const tx = this.transactions.current();
    const [locked] = await tx
      .select({ status: serviceRequests.status, providerMembershipId: serviceRequests.providerMembershipId })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, serviceRequestId))
      .for('update');
    const wasAssigned = locked?.status === 'assigned' && locked.providerMembershipId === membershipId;
    if (!wasAssigned) {
      const visible = await this.eligible({ serviceRequestId, membershipId, openOnly: true, broadcastOnly: true });
      if (visible.length === 0) throw new NotFoundException();
    }
    await tx
      .insert(serviceRequestDeclines)
      .values({ companyId: sql`app.current_company_id()`, serviceRequestId, providerMembershipId: membershipId, by: 'provider' })
      .onConflictDoNothing();
    if (wasAssigned) {
      await this.reopen(serviceRequestId, this.clock.now());
      const [request] = await this.find(eq(serviceRequests.id, serviceRequestId));
      await this.afterReopen(request, [userId]);
      return;
    }
    const [request] = await this.find(eq(serviceRequests.id, serviceRequestId));
    this.announceOpenRequestsChanged([userId], request.companyId);
  }

  /** Admin atribui um pedido aberto a um prestador apto; o prestador aceita ou recusa. */
  async assign(serviceRequestId: string, providerMembershipId: string): Promise<AcceptServiceRequestResponse> {
    const tx = this.transactions.current();
    const [locked] = await tx
      .select({ status: serviceRequests.status, clientId: serviceRequests.clientId })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, serviceRequestId))
      .for('update');
    if (!locked) throw new NotFoundException();
    if (locked.status !== 'open') throw new ConflictException('Pedido não está aberto');

    const eligible = await this.eligible({ serviceRequestId });
    const chosen = eligible.find((e) => e.membership_id === providerMembershipId);
    if (!chosen) {
      throw new BadRequestException({
        message: 'Dados inválidos',
        issues: [{ path: 'providerMembershipId', message: 'Prestador não está apto para este pedido' }],
      });
    }
    const now = this.clock.now();
    await tx
      .update(serviceRequests)
      .set({ status: 'assigned', providerMembershipId, updatedAt: now })
      .where(eq(serviceRequests.id, serviceRequestId));
    const [request] = await this.find(eq(serviceRequests.id, serviceRequestId));
    await this.notifications.notify({
      userIds: [chosen.user_id],
      type: 'request_assigned',
      title: `Pedido atribuído a você: ${request.categoryName}`,
      body: [request.neighborhood, `a ${formatKm(chosen.meters)} de você`].filter(Boolean).join(' · '),
      serviceRequestId,
    });
    this.announceStatus(request, [locked.clientId, chosen.user_id]);
    this.announceOpenRequestsChanged(eligible.map((e) => e.user_id), request.companyId);
    return { id: serviceRequestId, status: request.status };
  }

  /** Prestadores aptos para um pedido aberto, para o admin escolher. */
  async eligibleProviders(serviceRequestId: string): Promise<EligibleProvider[]> {
    const [row] = await this.transactions
      .current()
      .select({ status: serviceRequests.status })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, serviceRequestId));
    if (!row) throw new NotFoundException();
    if (row.status !== 'open') return [];
    const pairs = await this.eligible({ serviceRequestId });
    if (pairs.length === 0) return [];
    const names = await this.transactions
      .current()
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, pairs.map((p) => p.user_id)));
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    return pairs
      .map((p) => ({ membershipId: p.membership_id, name: nameOf.get(p.user_id) ?? '', distanceKm: Math.round(p.meters / 100) / 10 }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  /** Recusas do pedido (do prestador, ou do cliente ao prestador), mais recentes primeiro. */
  async declines(serviceRequestId: string): Promise<RequestDecline[]> {
    const [row] = await this.transactions
      .current()
      .select({ id: serviceRequests.id })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, serviceRequestId));
    if (!row) throw new NotFoundException();
    const rows = await this.transactions
      .current()
      .select({ providerName: users.name, by: serviceRequestDeclines.by, createdAt: serviceRequestDeclines.createdAt })
      .from(serviceRequestDeclines)
      .innerJoin(memberships, eq(memberships.id, serviceRequestDeclines.providerMembershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(serviceRequestDeclines.serviceRequestId, serviceRequestId))
      .orderBy(desc(serviceRequestDeclines.createdAt));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
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

  /**
   * O prestador do pedido avança o atendimento um passo por vez e o cliente é avisado.
   * A checagem de "um pedido ativo por prestador" está na confirmação e na aptidão (app.provider_has_active_request).
   */
  async advance(userId: string, serviceRequestId: string, to: ServiceStep): Promise<AcceptServiceRequestResponse> {
    const membershipId = await this.ownProviderMembership(userId);
    const tx = this.transactions.current();
    const [locked] = await tx
      .select({
        status: serviceRequests.status,
        clientId: serviceRequests.clientId,
        providerMembershipId: serviceRequests.providerMembershipId,
      })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, serviceRequestId))
      .for('update');
    if (!locked || locked.providerMembershipId !== membershipId) throw new NotFoundException();
    if (nextServiceStep[locked.status]?.to !== to) {
      throw new ConflictException('Este passo não vem agora no atendimento');
    }

    const now = this.clock.now();
    const stamp = { en_route: 'enRouteAt', arrived: 'arrivedAt', in_progress: 'startedAt', completed: 'completedAt' } as const;
    await tx
      .update(serviceRequests)
      .set({ status: to, [stamp[to]]: now, updatedAt: now })
      .where(eq(serviceRequests.id, serviceRequestId));

    const [request] = await this.find(eq(serviceRequests.id, serviceRequestId));
    const name = (request.provider?.name ?? 'O prestador').split(' ')[0];
    const messages: Record<ServiceStep, string> = {
      en_route: `${name} está a caminho`,
      arrived: `${name} chegou`,
      in_progress: `${name} iniciou o serviço`,
      completed: 'Serviço concluído',
    };
    await this.notifications.notify({
      userIds: [locked.clientId],
      type: 'request_status',
      title: messages[to],
      body: request.categoryName,
      serviceRequestId,
    });
    // Ao chegar, a posição deixa de ser exposta.
    if (to !== 'en_route') this.transactions.afterCommit(() => this.tracking.clear(serviceRequestId));
    this.announceStatus(request, [locked.clientId, userId]);
    return { id: serviceRequestId, status: request.status };
  }

  /** Pedidos do prestador nesta empresa: visão reduzida até a confirmação; depois, endereço completo e telefone. */
  async forProvider(userId: string): Promise<ProviderServiceRequest[]> {
    const membershipId = await this.ownProviderMembership(userId);
    const rows = await this.rows(
      and(
        eq(serviceRequests.providerMembershipId, membershipId),
        or(
          inArray(serviceRequests.status, ['awaiting_client', 'confirmed', 'en_route', 'arrived', 'in_progress']),
          // Concluídos ficam à vista por 7 dias (prazo da avaliação).
          and(
            eq(serviceRequests.status, 'completed'),
            gt(serviceRequests.completedAt, new Date(this.clock.now().getTime() - 7 * 24 * 60 * 60_000)),
          ),
        ),
      ),
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
    await this.dispatch(request, 'reopened', extraUsers);
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

  /** Agenda um prazo para depois do commit; o job relê o pedido ao rodar e só age se o estado ainda for o mesmo. */
  private deadline(
    kind: 'no_acceptance' | 'awaiting_client_reminder' | 'awaiting_client_timeout',
    request: ServiceRequest,
    stamp: Date,
    afterMs: number,
  ): void {
    const runAt = new Date(stamp.getTime() + afterMs);
    this.transactions.afterCommit(() =>
      this.scheduler.schedule(
        { kind, serviceRequestId: request.id, companyId: request.companyId, stamp: stamp.toISOString(), runAt: runAt.toISOString() },
        runAt.getTime() - this.clock.now().getTime(),
      ),
    );
  }

  /** Pedido travado, para o prazo conferir se ainda está no estado que o criou. */
  private async lockForDeadline(serviceRequestId: string) {
    const [row] = await this.transactions
      .current()
      .select({
        status: serviceRequests.status,
        broadcast: serviceRequests.broadcast,
        openedAt: serviceRequests.openedAt,
        acceptedAt: serviceRequests.acceptedAt,
        clientId: serviceRequests.clientId,
        providerMembershipId: serviceRequests.providerMembershipId,
      })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, serviceRequestId))
      .for('update');
    return row;
  }

  /** 15 min em broadcast sem aceite: o admin é avisado. O pedido continua aberto (sem cancelamento automático). */
  async notifyUnclaimed(serviceRequestId: string, openedAt: Date): Promise<void> {
    const row = await this.lockForDeadline(serviceRequestId);
    if (!row || row.status !== 'open' || !row.broadcast || row.openedAt?.getTime() !== openedAt.getTime()) return;
    const [request] = await this.find(eq(serviceRequests.id, serviceRequestId));
    const admins = await this.activeAdmins();
    await this.notifications.notify({
      userIds: admins,
      type: 'request_unclaimed',
      title: `Pedido sem aceite há 15 minutos: ${request.categoryName}`,
      body: [request.neighborhood, request.clientName].filter(Boolean).join(' · '),
      serviceRequestId,
    });
  }

  /** 5 min esperando o cliente: lembrete de que o prestador aguarda. */
  async remindClient(serviceRequestId: string, acceptedAt: Date): Promise<void> {
    const row = await this.lockForDeadline(serviceRequestId);
    if (!row || row.status !== 'awaiting_client' || row.acceptedAt?.getTime() !== acceptedAt.getTime()) return;
    const [request] = await this.find(eq(serviceRequests.id, serviceRequestId));
    await this.notifications.notify({
      userIds: [row.clientId],
      type: 'request_reminder',
      title: `${request.provider?.name.split(' ')[0] ?? 'O prestador'} está esperando você`,
      body: `${request.categoryName} · confirme ou recuse o prestador`,
      serviceRequestId,
    });
  }

  /**
   * 10 min esperando o cliente: o pedido volta para `open` sem contar como recusa (o prestador pode
   * aceitar de novo) e segue o modo da empresa.
   */
  async expireAwaitingClient(serviceRequestId: string, acceptedAt: Date): Promise<void> {
    const row = await this.lockForDeadline(serviceRequestId);
    if (!row || row.status !== 'awaiting_client' || !row.providerMembershipId || row.acceptedAt?.getTime() !== acceptedAt.getTime()) return;
    const [provider] = await this.transactions
      .current()
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.id, row.providerMembershipId));
    await this.reopen(serviceRequestId, this.clock.now());
    const [request] = await this.find(eq(serviceRequests.id, serviceRequestId));
    await this.notifications.notify({
      userIds: [row.clientId],
      type: 'request_expired',
      title: 'Você não respondeu a tempo',
      body: `${request.categoryName} · o prestador foi liberado e o pedido voltou a ficar aberto`,
      serviceRequestId,
    });
    await this.notifications.notify({
      userIds: [provider.userId],
      type: 'request_expired',
      title: 'O cliente não respondeu a tempo',
      body: `${request.categoryName} · o pedido voltou a ficar aberto`,
      serviceRequestId,
    });
    await this.afterReopen(request, [provider.userId]);
  }

  private async activeAdmins(): Promise<string[]> {
    const admins = await this.transactions
      .current()
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(eq(memberships.companyId, sql`app.current_company_id()`), eq(memberships.role, 'admin'), eq(memberships.active, true)),
      );
    return admins.map((a) => a.userId);
  }

  /** Cliente cancela (de aberto até a caminho; depois de "chegou", só o admin). */
  async cancelByClient(clientId: string, serviceRequestId: string, reason: string): Promise<void> {
    await this.cancel(serviceRequestId, reason, { role: 'client', userId: clientId });
  }

  /** Admin cancela qualquer pedido que não esteja concluído. */
  async cancelByAdmin(adminId: string, serviceRequestId: string, reason: string): Promise<void> {
    await this.cancel(serviceRequestId, reason, { role: 'admin', userId: adminId });
  }

  private async cancel(
    serviceRequestId: string,
    reason: string,
    actor: { role: 'client' | 'admin' | 'system'; userId: string | null },
  ): Promise<void> {
    const tx = this.transactions.current();
    const [locked] = await tx
      .select({
        status: serviceRequests.status,
        broadcast: serviceRequests.broadcast,
        clientId: serviceRequests.clientId,
        providerMembershipId: serviceRequests.providerMembershipId,
      })
      .from(serviceRequests)
      .where(
        and(eq(serviceRequests.id, serviceRequestId), actor.role === 'client' ? eq(serviceRequests.clientId, actor.userId ?? '') : undefined),
      )
      .for('update');
    if (!locked) throw new NotFoundException();
    const allowed = actor.role === 'client' ? clientCancellableStatuses.includes(locked.status) : !['completed', 'cancelled'].includes(locked.status);
    if (!allowed) {
      throw new ConflictException(
        actor.role === 'client' && locked.status !== 'completed' && locked.status !== 'cancelled'
          ? 'O prestador já chegou: só a empresa pode cancelar'
          : 'Este pedido não pode mais ser cancelado',
      );
    }

    // Quem estava envolvido e as listas que mudam, antes de o pedido sair do estado atual.
    const providerUserId = locked.providerMembershipId ? await this.userOfMembership(locked.providerMembershipId) : null;
    const eligible = locked.status === 'open' && locked.broadcast ? await this.eligible({ serviceRequestId, broadcastOnly: true }) : [];

    const now = this.clock.now();
    await tx
      .update(serviceRequests)
      .set({ status: 'cancelled', cancelledAt: now, cancelledByRole: actor.role, cancelReason: reason, updatedAt: now })
      .where(eq(serviceRequests.id, serviceRequestId));
    await tx.insert(serviceRequestEvents).values({
      companyId: sql`app.current_company_id()`,
      serviceRequestId,
      kind: 'cancellation',
      byRole: actor.role,
      byUserId: actor.userId,
      reason,
      createdAt: now,
    });

    const [request] = await this.find(eq(serviceRequests.id, serviceRequestId));
    const byWhom = { client: 'O cliente', admin: 'A empresa', system: 'A empresa' }[actor.role];
    const notified = [
      ...(providerUserId ? [providerUserId] : []),
      ...(actor.role === 'client' ? [] : [locked.clientId]),
    ];
    await this.notifications.notify({
      userIds: notified,
      type: 'request_cancelled',
      title: `Pedido cancelado: ${request.categoryName}`,
      body: `${byWhom} cancelou · ${reason}`,
      serviceRequestId,
    });
    this.transactions.afterCommit(() => this.tracking.clear(serviceRequestId));
    this.announceStatus(request, [locked.clientId, ...(providerUserId ? [providerUserId] : [])]);
    this.announceOpenRequestsChanged([...eligible.map((e) => e.user_id), ...(providerUserId ? [providerUserId] : [])], request.companyId);
  }

  /** O prestador do pedido desiste (confirmado ou a caminho): volta para aberto e conta como recusa dele. */
  async withdraw(userId: string, serviceRequestId: string, reason: string): Promise<void> {
    const membershipId = await this.ownProviderMembership(userId);
    const [locked] = await this.transactions
      .current()
      .select({ status: serviceRequests.status, providerMembershipId: serviceRequests.providerMembershipId })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, serviceRequestId))
      .for('update');
    if (!locked || locked.providerMembershipId !== membershipId) throw new NotFoundException();
    if (!withdrawableStatuses.includes(locked.status)) throw new ConflictException('Não dá mais para desistir deste pedido');
    await this.release(serviceRequestId, { membershipId, userId, reason, byRole: 'provider', byUserId: userId });
  }

  /** O admin desativou o prestador: os pedidos dele voltam para aberto como desistência "desativado pelo admin". */
  async releaseProvider(membershipId: string, adminId: string): Promise<void> {
    const rows = await this.transactions
      .current()
      .select({ id: serviceRequests.id })
      .from(serviceRequests)
      .where(
        and(
          eq(serviceRequests.providerMembershipId, membershipId),
          inArray(serviceRequests.status, ['assigned', 'awaiting_client', 'confirmed', 'en_route', 'arrived', 'in_progress']),
        ),
      )
      .for('update');
    if (rows.length === 0) return;
    const userId = await this.userOfMembership(membershipId);
    for (const { id } of rows) {
      await this.release(id, { membershipId, userId, reason: 'desativado pelo admin', byRole: 'admin', byUserId: adminId });
    }
  }

  /** Desistência: registra a recusa e o histórico, reabre o pedido e avisa o cliente. */
  private async release(
    serviceRequestId: string,
    who: { membershipId: string; userId: string; reason: string; byRole: 'provider' | 'admin'; byUserId: string },
  ): Promise<void> {
    const tx = this.transactions.current();
    const now = this.clock.now();
    await tx
      .insert(serviceRequestDeclines)
      .values({ companyId: sql`app.current_company_id()`, serviceRequestId, providerMembershipId: who.membershipId, by: 'provider', createdAt: now })
      .onConflictDoNothing();
    await tx.insert(serviceRequestEvents).values({
      companyId: sql`app.current_company_id()`,
      serviceRequestId,
      kind: 'withdrawal',
      byRole: who.byRole,
      byUserId: who.byUserId,
      reason: who.reason,
      createdAt: now,
    });
    await this.reopen(serviceRequestId, now);
    const [request] = await this.find(eq(serviceRequests.id, serviceRequestId));
    await this.notifications.notify({
      userIds: [await this.clientOf(serviceRequestId)],
      type: 'request_withdrawn',
      title: 'O prestador não vai mais atender',
      body: `${request.categoryName} · o pedido voltou a ficar aberto`,
      serviceRequestId,
    });
    this.transactions.afterCommit(() => this.tracking.clear(serviceRequestId));
    await this.afterReopen(request, [who.userId]);
  }

  /** Empresa desativada: todo pedido não concluído vira `cancelled` com o motivo "empresa desativada". */
  async cancelAllOfCompany(reason: string): Promise<number> {
    const rows = await this.transactions
      .current()
      .select({ id: serviceRequests.id })
      .from(serviceRequests)
      .where(
        and(
          eq(serviceRequests.companyId, sql`app.current_company_id()`),
          inArray(serviceRequests.status, ['open', 'assigned', 'awaiting_client', 'confirmed', 'en_route', 'arrived', 'in_progress']),
        ),
      );
    for (const { id } of rows) await this.cancel(id, reason, { role: 'system', userId: null });
    return rows.length;
  }

  /** Histórico de cancelamentos e desistências do pedido, para o admin. */
  async events(serviceRequestId: string): Promise<RequestEvent[]> {
    await this.one(serviceRequestId);
    const rows = await this.transactions
      .current()
      .select({
        kind: serviceRequestEvents.kind,
        byRole: serviceRequestEvents.byRole,
        byName: users.name,
        reason: serviceRequestEvents.reason,
        createdAt: serviceRequestEvents.createdAt,
      })
      .from(serviceRequestEvents)
      .leftJoin(users, eq(users.id, serviceRequestEvents.byUserId))
      .where(eq(serviceRequestEvents.serviceRequestId, serviceRequestId))
      .orderBy(desc(serviceRequestEvents.createdAt));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  private async userOfMembership(membershipId: string): Promise<string> {
    const [row] = await this.transactions
      .current()
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.id, membershipId));
    return row.userId;
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

  async one(serviceRequestId: string): Promise<ServiceRequest> {
    const [request] = await this.find(eq(serviceRequests.id, serviceRequestId));
    if (!request) throw new NotFoundException();
    return request;
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
    return rows.map(({ location, createdAt, clientPhone: _clientPhone, cancelledAt, cancelledByRole, cancelReason, ...row }) => ({
      ...row,
      location: { latitude: location.y, longitude: location.x },
      cancellation:
        row.status === 'cancelled' && cancelledAt && cancelledByRole && cancelledByRole !== 'provider'
          ? { byRole: cancelledByRole, reason: cancelReason ?? '', at: cancelledAt.toISOString() }
          : null,
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
        cancelledAt: serviceRequests.cancelledAt,
        cancelledByRole: serviceRequests.cancelledByRole,
        cancelReason: serviceRequests.cancelReason,
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
