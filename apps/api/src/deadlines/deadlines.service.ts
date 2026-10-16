import { Injectable, OnModuleInit } from '@nestjs/common';
import { Clock } from '../clock.js';
import { TenantTransactions } from '../db/tenant-transactions.js';
import { ReviewsService } from '../reviews/reviews.service.js';
import { ServiceRequestsService } from '../service-requests/service-requests.service.js';
import { DeadlineScheduler, type DeadlineJob } from './deadline-scheduler.js';

/** Usuário de sistema: nenhum `app.user_id`, só a empresa do pedido no contexto. */
const SYSTEM_USER = '';

/**
 * Trata os prazos do pedido. O job não confia no que a fila lembra: ao rodar, relê o pedido e só age
 * se ele ainda está no estado que criou o prazo.
 */
@Injectable()
export class DeadlinesService implements OnModuleInit {
  constructor(
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
    if (this.clock.now() < new Date(job.runAt)) return;
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
}
