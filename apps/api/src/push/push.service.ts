import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { PushData } from '@despacho/shared';
import { Queue, Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DATABASE, type Database } from '../db/tenant-transactions.js';
import { PushSender } from './push-sender.js';

export interface PushJob {
  userId: string;
  title: string;
  body: string;
  data: PushData;
}

const QUEUE = 'push';

/**
 * Transforma cada atualização em push (FCM) por um worker BullMQ: a atualização é gravada na transação da
 * ação, o job entra na fila depois do commit e o worker envia a todos os aparelhos da pessoa.
 */
@Injectable()
export class PushService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Push');
  private readonly connection: Redis;
  private readonly queue: Queue<PushJob>;
  private worker: Worker<PushJob> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    private readonly sender: PushSender,
  ) {
    this.connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<PushJob>(QUEUE, { connection: this.connection });
  }

  onModuleInit(): void {
    if (this.config.WORKERS !== 'on') return;
    this.worker = new Worker<PushJob>(QUEUE, (job) => this.process(job.data), { connection: this.connection.duplicate() });
    this.worker.on('failed', (job, error) => this.logger.error(`Push ${job?.id} falhou: ${error.message}`));
  }

  /** Enfileira o push de uma atualização. Chamado depois do commit da transação que a gravou. */
  async enqueue(job: PushJob): Promise<void> {
    await this.queue.add('push', job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }

  /** Envia o push aos aparelhos da pessoa e remove os tokens que o FCM recusou. */
  async process(job: PushJob): Promise<void> {
    const { rows } = await this.db.execute<{ token: string }>(sql`select token from app.device_tokens_of(${job.userId})`);
    if (rows.length === 0) return;
    const data: Record<string, string> = { type: job.data.type };
    if (job.data.serviceRequestId) data.serviceRequestId = job.data.serviceRequestId;
    if (job.data.companyId) data.companyId = job.data.companyId;
    const { invalidTokens } = await this.sender.send(rows.map((r) => ({ token: r.token, title: job.title, body: job.body, data })));
    // Token que o FCM recusou não volta a ser usado.
    for (const token of invalidTokens) await this.db.execute(sql`select app.remove_device_tokens(array[${token}]::text[])`);
  }

  /** Processa o que está na fila agora. Os testes usam isto no lugar do worker, sem esperar. */
  async drain(): Promise<number> {
    const waiting = await this.queue.getWaiting();
    for (const job of waiting) {
      await this.process(job.data);
      await job.remove();
    }
    return waiting.length;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}
