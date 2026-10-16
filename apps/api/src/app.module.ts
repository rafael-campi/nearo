import { Global, Module } from '@nestjs/common';
import { ClockModule } from './clock.js';
import { APP_CONFIG, loadConfig } from './config.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthController } from './health/health.controller.js';
import { RedisModule } from './redis/redis.module.js';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [APP_CONFIG],
})
class ConfigModule {}

@Module({
  imports: [ConfigModule, ClockModule, DatabaseModule, RedisModule],
  controllers: [HealthController],
})
export class AppModule {}
