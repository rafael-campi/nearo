import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  REVIEW_WINDOW_DAYS,
  type CreateReview,
  type Rating,
  type Review,
  type RequestReviews,
} from '@despacho/shared';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { Clock } from '../clock.js';
import { reviews, serviceRequests, users } from '../db/schema.js';
import { TenantTransactions } from '../db/tenant-transactions.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RequestAccessService } from '../service-requests/request-access.service.js';

const WINDOW_MS = REVIEW_WINDOW_DAYS * 24 * 60 * 60_000;

/**
 * Avaliação às cegas e nota por empresa. A nota é a média das avaliações *visíveis* dentro da empresa
 * da transação atual; nunca atravessa empresas (o RLS e o filtro por empresa garantem).
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly transactions: TenantTransactions,
    private readonly access: RequestAccessService,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  /** Cliente ou prestador do pedido avalia o outro lado: pedido concluído, até 7 dias, uma vez. */
  async create(userId: string, serviceRequestId: string, input: CreateReview & { rating: number }): Promise<Review> {
    const who = await this.access.participation(userId, serviceRequestId);
    if (who.role === 'admin') throw new NotFoundException();
    if (who.status !== 'completed' || !who.completedAt) throw new ConflictException('O pedido ainda não foi concluído');
    const now = this.clock.now();
    if (now.getTime() > who.completedAt.getTime() + WINDOW_MS) throw new ConflictException('O prazo para avaliar acabou');

    const revieweeId = who.role === 'client' ? who.providerUserId : who.clientId;
    if (!revieweeId) throw new NotFoundException();
    const [created] = await this.transactions
      .current()
      .insert(reviews)
      .values({
        companyId: sql`app.current_company_id()`,
        serviceRequestId,
        reviewerId: userId,
        revieweeId,
        reviewerRole: who.role,
        rating: input.rating,
        comment: input.comment ?? '',
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: reviews.id });
    if (!created) throw new ConflictException('Você já avaliou este pedido');
    const id = created.id;

    // Quando os dois já avaliaram, as duas avaliações ficam visíveis.
    await this.reveal(serviceRequestId, now, false);
    const [mine] = await this.select(and(eq(reviews.id, id)), userId);
    return mine;
  }

  /** As avaliações que a pessoa pode ver do pedido e se ainda pode avaliar. */
  async forRequest(userId: string, serviceRequestId: string): Promise<RequestReviews> {
    const who = await this.access.participation(userId, serviceRequestId);
    const rows = await this.select(eq(reviews.serviceRequestId, serviceRequestId), userId);
    const completed = who.status === 'completed' && who.completedAt !== null;
    const deadline = completed ? new Date(who.completedAt!.getTime() + WINDOW_MS) : null;
    return {
      reviews: rows,
      canReview:
        completed && who.role !== 'admin' && !rows.some((r) => r.mine) && this.clock.now().getTime() <= deadline!.getTime(),
      deadline: deadline?.toISOString() ?? null,
    };
  }

  /** Fim do prazo: revela as avaliações que existirem, mesmo sem a do outro lado. */
  async revealAtDeadline(serviceRequestId: string, completedAt: Date): Promise<void> {
    const [request] = await this.transactions
      .current()
      .select({ status: serviceRequests.status, completedAt: serviceRequests.completedAt })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, serviceRequestId))
      .for('update');
    if (!request || request.status !== 'completed' || request.completedAt?.getTime() !== completedAt.getTime()) return;
    await this.reveal(serviceRequestId, this.clock.now(), true);
  }

  /** Nota (média das visíveis) e quantas avaliações, por pessoa, na empresa atual. */
  async ratingsOf(userIds: string[]): Promise<Map<string, Rating>> {
    const result = new Map<string, Rating>();
    if (userIds.length === 0) return result;
    const rows = await this.transactions
      .current()
      .select({
        userId: reviews.revieweeId,
        average: sql<number>`round(avg(${reviews.rating})::numeric, 1)::float8`,
        count: sql<number>`count(*)::int`,
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.companyId, sql`app.current_company_id()`),
          inArray(reviews.revieweeId, userIds),
          isNotNull(reviews.visibleAt),
        ),
      )
      .groupBy(reviews.revieweeId);
    for (const row of rows) result.set(row.userId, { average: row.average, count: row.count });
    return result;
  }

  static noRating(): Rating {
    return { average: null, count: 0 };
  }

  private async reveal(serviceRequestId: string, now: Date, force: boolean): Promise<void> {
    const { rows } = await this.transactions
      .current()
      .execute<{ reveal_reviews: string }>(sql`select * from app.reveal_reviews(${serviceRequestId}, ${now.toISOString()}::timestamptz, ${force})`);
    if (rows.length === 0) return;
    await this.notifications.notify({
      userIds: rows.map((r) => r.reveal_reviews),
      type: 'review_received',
      title: 'Você recebeu uma avaliação',
      body: 'A avaliação do seu atendimento já está visível.',
      serviceRequestId,
    });
  }

  private async select(where: ReturnType<typeof and>, viewerId: string): Promise<Review[]> {
    const rows = await this.transactions
      .current()
      .select({
        id: reviews.id,
        reviewerId: reviews.reviewerId,
        reviewerRole: reviews.reviewerRole,
        reviewerName: users.name,
        rating: reviews.rating,
        comment: reviews.comment,
        visibleAt: reviews.visibleAt,
        createdAt: reviews.createdAt,
      })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.reviewerId))
      .where(where)
      .orderBy(desc(reviews.createdAt));
    return rows.map((r) => ({
      id: r.id,
      reviewerRole: r.reviewerRole,
      reviewerName: r.reviewerName,
      rating: r.rating,
      comment: r.comment,
      mine: r.reviewerId === viewerId,
      visible: r.visibleAt !== null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
