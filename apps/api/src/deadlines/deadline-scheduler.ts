import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config.js';

/** Prazos do pedido. Cada um carrega o "carimbo" do estado que o criou, para o job saber se ainda vale. */
export type DeadlineKind = 'no_acceptance' | 'awaiting_client_reminder' | 'awaiting_client_timeout' | 'reveal_reviews';

export interface DeadlineJob {
  kind: DeadlineKind;
  serviceRequestId: string;
  companyId: string;
  /** Marca do estado que criou o prazo (quando o pedido ficou aberto, ou quando foi aceito). */
  stamp: string;
  /** Quando o prazo vence. O job só age se o relógio da API já passou disso. */
  runAt: string;
}

export type DeadlineHandler = (job: DeadlineJob) => Promise<void>;

/** Agenda jobs atrasados (ADR 0003: BullMQ). Atrás de uma classe abstrata para o resto da API não depender da fila. */
export abstract class DeadlineScheduler {
  abstract schedule(job: DeadlineJob, delayMs: number): Promise<void>;
  /** Quem trata os jobs vencidos. */
  abstract setHandler(handler: DeadlineHandler): void;
  /** Jobs ainda na fila (atrasados), para conferência e para varrer os vencidos. */
  abstract pending(): Promise<DeadlineJob[]>;
  /** Tira da fila um job já tratado. */
  abstract discard(job: DeadlineJob): Promise<void>;
}

const QUEUE = 'deadlines';
const jobId = (job: DeadlineJob) => [job.kind, job.serviceRequestId, Date.parse(job.stamp)].join('-');

@Injectable()
export class BullDeadlineScheduler extends DeadlineScheduler implements OnApplicationShutdown {
  private readonly logger = new Logger('Deadlines');
  private readonly connection: Redis;
  private readonly queue: Queue<DeadlineJob>;
  private worker: Worker<DeadlineJob> | null = null;
  private handler: DeadlineHandler | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
    // BullMQ exige maxRetriesPerRequest nulo nas conexões que bloqueiam.
    this.connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<DeadlineJob>(QUEUE, { connection: this.connection });
  }

  setHandler(handler: DeadlineHandler): void {
    this.handler = handler;
    if (this.config.WORKERS === 'on' && !this.worker) {
      this.worker = new Worker<DeadlineJob>(QUEUE, (job) => this.run(job), { connection: this.connection.duplicate() });
      this.worker.on('failed', (job, error) => this.logger.error(`Prazo ${job?.id} falhou: ${error.message}`));
    }
  }

  async schedule(job: DeadlineJob, delayMs: number): Promise<void> {
    await this.queue.add(job.kind, job, {
      jobId: jobId(job),
      delay: Math.max(0, delayMs),
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }

  async pending(): Promise<DeadlineJob[]> {
    const jobs = await this.queue.getDelayed();
    return jobs.map((job) => job.data);
  }

  async discard(job: DeadlineJob): Promise<void> {
    await this.queue.remove(jobId(job));
  }

  private async run(job: Job<DeadlineJob>): Promise<void> {
    if (!this.handler) throw new Error('Sem tratador de prazos');
    await this.handler(job.data);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}
