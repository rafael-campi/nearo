import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Clock } from '../clock.js';
import { DATABASE, TenantTransactions, type Database } from '../db/tenant-transactions.js';
import { ReviewsService } from '../reviews/reviews.service.js';
import { CLIENT_TIMEOUT_MS, REVIEW_REVEAL_MS, ServiceRequestsService } from '../service-requests/service-requests.service.js';
import { DeadlineScheduler, type DeadlineJob } from './deadline-scheduler.js';

/** Usuário de sistema: nenhum `app.user_id`, só a empresa do pedido no contexto. */
const SYSTEM_USER = '';

/**
 * Trata os prazos do pedido. O job não confia no que a fila lembra: ao rodar, relê o pedido e só age
 * se ele ainda está no estado que criou o prazo.
 */
@Injectable()
export class DeadlinesService implements OnModuleInit {
  private readonly logger = new Logger('Deadlines');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly scheduler: DeadlineScheduler,
    private readonly transactions: TenantTransactions,
    private readonly requests: ServiceRequestsService,
    private readonly reviews: ReviewsService,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.scheduler.setHandler((job) => this.handle(job));
  }

  async handle(job: DeadlineJob): Promise<void> {
    // Relógio desta instância atrás do de quem agendou: falhar faz o BullMQ tentar de novo, em vez de dar o prazo por cumprido.
    if (this.clock.now() < new Date(job.runAt)) throw new Error(`Prazo ${job.kind} do pedido ${job.serviceRequestId} ainda não venceu`);
    await this.transactions.run({ userId: SYSTEM_USER, companyId: job.companyId }, async () => {
      const stamp = new Date(job.stamp);
      switch (job.kind) {
        case 'no_acceptance':
          return this.requests.notifyUnclaimed(job.serviceRequestId, stamp);
        case 'awaiting_client_reminder':
          return this.requests.remindClient(job.serviceRequestId, stamp);
        case 'awaiting_client_timeout':
          return this.requests.expireAwaitingClient(job.serviceRequestId, stamp);
        case 'reveal_reviews':
          return this.reviews.revealAtDeadline(job.serviceRequestId, stamp);
      }
    });
  }

  /** Trata os prazos que já venceram pelo relógio da API. Usado nos testes, que avançam o relógio sem esperar. */
  async runDue(): Promise<number> {
    const now = this.clock.now();
    const due = (await this.scheduler.pending()).filter((job) => new Date(job.runAt) <= now);
    for (const job of due) {
      await this.handle(job);
      await this.scheduler.discard(job);
    }
    return due.length;
  }

  /**
   * Rede de segurança: trata os prazos de mudança de estado que venceram sem o job rodar (agendamento
   * perdido, Redis fora do ar). Cada prazo relê o pedido, então tratar um já tratado não faz nada.
   */
  async sweep(): Promise<number> {
    const { rows } = await this.db.execute<{ kind: DeadlineJob['kind']; service_request_id: string; company_id: string; stamp: Date }>(
      sql`select * from app.overdue_deadlines(${this.clock.now().toISOString()}::timestamptz, ${CLIENT_TIMEOUT_MS / 1000}, ${REVIEW_REVEAL_MS / 1000})`,
    );
    for (const row of rows) {
      const stamp = new Date(row.stamp);
      const after = row.kind === 'reveal_reviews' ? REVIEW_REVEAL_MS : CLIENT_TIMEOUT_MS;
      try {
        await this.handle({
          kind: row.kind,
          serviceRequestId: row.service_request_id,
          companyId: row.company_id,
          stamp: stamp.toISOString(),
          runAt: new Date(stamp.getTime() + after).toISOString(),
        });
      } catch (error) {
        this.logger.error(`Varredura: prazo ${row.kind} do pedido ${row.service_request_id} falhou: ${(error as Error).message}`);
      }
    }
    return rows.length;
  }
}
