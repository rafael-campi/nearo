import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { Clock } from '../clock.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DeadlinesService } from '../deadlines/deadlines.service.js';
import { DATABASE, type Database } from '../db/tenant-transactions.js';

const QUEUE = 'maintenance';
const PURGE_POSITIONS = 'purge-positions';
const SWEEP_DEADLINES = 'sweep-deadlines';
/** Trilha do prestador: retenção de 30 dias. */
export const POSITIONS_RETENTION_MS = 30 * 24 * 60 * 60_000;

/** Tarefas recorrentes (BullMQ): limpeza diária da trilha de GPS e varredura dos prazos vencidos. */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Maintenance');
  private readonly connection: Redis;
  private readonly queue: Queue;
  private worker: Worker | null = null;
  private workerConnection: Redis | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    private readonly clock: Clock,
    private readonly deadlines: DeadlinesService,
  ) {
    this.connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, { connection: this.connection });
  }

  async onModuleInit(): Promise<void> {
    // Todo dia às 03:00 (idempotente: o mesmo id de agendador só é atualizado).
    await this.queue.upsertJobScheduler(PURGE_POSITIONS, { pattern: '0 3 * * *', tz: 'America/Sao_Paulo' }, { name: PURGE_POSITIONS });
    // A cada minuto: prazos que o job atrasado não cumpriu (ver DeadlinesService.sweep).
    await this.queue.upsertJobScheduler(SWEEP_DEADLINES, { every: 60_000 }, { name: SWEEP_DEADLINES });
    if (this.config.WORKERS === 'on') {
      this.workerConnection = this.connection.duplicate();
      this.worker = new Worker(
        QUEUE,
        async (job) => {
          if (job.name === PURGE_POSITIONS) this.logger.log(`Trilha de GPS: ${await this.purgePositions()} pontos apagados`);
          if (job.name === SWEEP_DEADLINES) {
            const handled = await this.deadlines.sweep();
            if (handled > 0) this.logger.warn(`Varredura de prazos: ${handled} vencidos que o agendamento não cumpriu`);
          }
        },
        { connection: this.workerConnection },
      );
      this.worker.on('failed', (job, error) => this.logger.error(`${job?.name} falhou: ${error.message}`));
    }
  }

  /** Apaga os pontos de GPS com mais de 30 dias. Devolve quantos. */
  async purgePositions(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - POSITIONS_RETENTION_MS);
    const { rows } = await this.db.execute<{ removed: number }>(sql`select app.purge_provider_positions(${cutoff.toISOString()}::timestamptz) as removed`);
    return rows[0].removed;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    this.workerConnection?.disconnect();
    this.connection.disconnect();
  }
}
