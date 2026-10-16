import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { Clock } from '../clock.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { Storage } from '../storage/storage.js';
import { DeadlinesService } from '../deadlines/deadlines.service.js';
import { DATABASE, type Database } from '../db/tenant-transactions.js';

const QUEUE = 'maintenance';
const PURGE_POSITIONS = 'purge-positions';
const SWEEP_DEADLINES = 'sweep-deadlines';
const PURGE_STALE = 'purge-stale';
/** Upload sem uso some depois de um dia (o link de envio vale 10 minutos). */
export const UNUSED_UPLOAD_TTL_MS = 24 * 60 * 60_000;
/** Trilha do prestador: retenção de 30 dias. */
export const POSITIONS_RETENTION_MS = 30 * 24 * 60 * 60_000;

/** Tarefas recorrentes (BullMQ): limpeza diária (trilha de GPS, sessões vencidas, uploads sem uso) e varredura dos prazos vencidos. */
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
    private readonly storage: Storage,
  ) {
    this.connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, { connection: this.connection });
  }

  async onModuleInit(): Promise<void> {
    // Todo dia às 03:00 (idempotente: o mesmo id de agendador só é atualizado).
    await this.queue.upsertJobScheduler(PURGE_POSITIONS, { pattern: '0 3 * * *', tz: 'America/Sao_Paulo' }, { name: PURGE_POSITIONS });
    await this.queue.upsertJobScheduler(PURGE_STALE, { pattern: '15 3 * * *', tz: 'America/Sao_Paulo' }, { name: PURGE_STALE });
    // A cada minuto: prazos que o job atrasado não cumpriu (ver DeadlinesService.sweep).
    await this.queue.upsertJobScheduler(SWEEP_DEADLINES, { every: 60_000 }, { name: SWEEP_DEADLINES });
    if (this.config.WORKERS === 'on') {
      this.workerConnection = this.connection.duplicate();
      this.worker = new Worker(
        QUEUE,
        async (job) => {
          if (job.name === PURGE_POSITIONS) this.logger.log(`Trilha de GPS: ${await this.purgePositions()} pontos apagados`);
          if (job.name === PURGE_STALE) {
            const stale = await this.purgeStale();
            this.logger.log(`Limpeza: ${stale.authRows} registros de acesso e ${stale.uploads} uploads sem uso apagados`);
          }
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

  /**
   * Apaga sessões e links de redefinição vencidos e os uploads que ninguém usou (inclusive o arquivo no
   * storage; falha ao apagar o arquivo é só registrada, pois o registro já se foi).
   */
  async purgeStale(): Promise<{ authRows: number; uploads: number }> {
    const now = this.clock.now();
    const { rows: auth } = await this.db.execute<{ removed: number }>(sql`select app.purge_stale_auth(${now.toISOString()}::timestamptz) as removed`);
    const cutoff = new Date(now.getTime() - UNUSED_UPLOAD_TTL_MS);
    const { rows: keys } = await this.db.execute<{ key: string }>(sql`select app.purge_unused_uploads(${cutoff.toISOString()}::timestamptz) as key`);
    for (const { key } of keys) {
      try {
        await this.storage.delete(key);
      } catch (error) {
        this.logger.warn(`Arquivo ${key} não apagado do storage: ${(error as Error).message}`);
      }
    }
    return { authRows: auth[0].removed, uploads: keys.length };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    this.workerConnection?.disconnect();
    this.connection.disconnect();
  }
}
