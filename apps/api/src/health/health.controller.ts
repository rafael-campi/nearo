import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { Clock } from '../clock.js';
import { PG_POOL } from '../db/database.module.js';
import { REDIS } from '../redis/redis.module.js';

type Check = 'ok' | 'error';

async function check(probe: () => Promise<unknown>): Promise<Check> {
  try {
    await probe();
    return 'ok';
  } catch {
    return 'error';
  }
}

@Controller('health')
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly clock: Clock,
  ) {}

  @Get()
  async get() {
    const [database, redis] = await Promise.all([
      check(() => this.pool.query('select 1')),
      check(() => this.redis.ping()),
    ]);
    const ok = database === 'ok' && redis === 'ok';
    const body = { status: ok ? 'ok' : 'error', database, redis, time: this.clock.now().toISOString() };
    if (!ok) throw new ServiceUnavailableException(body);
    return body;
  }
}
