import { Global, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { CategoriesController } from './categories/categories.controller.js';
import { CategoriesService } from './categories/categories.service.js';
import { ClockModule } from './clock.js';
import { CompaniesService } from './companies/companies.service.js';
import { CompanyController } from './companies/company.controller.js';
import { APP_CONFIG, loadConfig } from './config.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthController } from './health/health.controller.js';
import { InvitesController } from './invites/invites.controller.js';
import { InvitesService } from './invites/invites.service.js';
import { MailModule } from './mail/mailer.js';
import { RedisModule } from './redis/redis.module.js';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [APP_CONFIG],
})
class ConfigModule {}

@Module({
  imports: [ConfigModule, ClockModule, DatabaseModule, RedisModule, MailModule, AuthModule],
  controllers: [HealthController, CompanyController, InvitesController, CategoriesController],
  providers: [CompaniesService, InvitesService, CategoriesService],
})
export class AppModule {}
