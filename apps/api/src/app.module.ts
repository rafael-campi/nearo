import { Global, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { CategoriesController } from './categories/categories.controller.js';
import { CategoriesService } from './categories/categories.service.js';
import { ChatController } from './chat/chat.controller.js';
import { ChatService } from './chat/chat.service.js';
import { ClientsController } from './clients/clients.controller.js';
import { ClientsService } from './clients/clients.service.js';
import { ClockModule } from './clock.js';
import { CompaniesService } from './companies/companies.service.js';
import { CompanyController } from './companies/company.controller.js';
import { APP_CONFIG, loadConfig } from './config.js';
import { BullDeadlineScheduler, DeadlineScheduler } from './deadlines/deadline-scheduler.js';
import { DeadlinesService } from './deadlines/deadlines.service.js';
import { DatabaseModule } from './db/database.module.js';
import { GeocodingModule } from './geocoding/reverse-geocoder.js';
import { HealthController } from './health/health.controller.js';
import { InvitesController } from './invites/invites.controller.js';
import { InvitesService } from './invites/invites.service.js';
import { MaintenanceService } from './maintenance/maintenance.service.js';
import { MailModule } from './mail/mailer.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { PhotosController } from './photos/photos.controller.js';
import { PhotosService } from './photos/photos.service.js';
import { DevicesController } from './push/devices.controller.js';
import { FcmPushSender, PushSender } from './push/push-sender.js';
import { PushService } from './push/push.service.js';
import { RealtimeGateway } from './realtime/realtime.gateway.js';
import { RealtimeService } from './realtime/realtime.service.js';
import { ProvidersController } from './providers/providers.controller.js';
import { ProvidersService } from './providers/providers.service.js';
import { StorageModule } from './storage/storage.js';
import { RedisModule } from './redis/redis.module.js';
import { ReviewsController } from './reviews/reviews.controller.js';
import { ReviewsService } from './reviews/reviews.service.js';
import { RequestAccessService } from './service-requests/request-access.service.js';
import { ServiceRequestsController } from './service-requests/service-requests.controller.js';
import { ServiceRequestsService } from './service-requests/service-requests.service.js';
import { TrackingService } from './service-requests/tracking.service.js';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [APP_CONFIG],
})
class ConfigModule {}

@Module({
  imports: [ConfigModule, ClockModule, DatabaseModule, RedisModule, MailModule, AuthModule, GeocodingModule, StorageModule],
  controllers: [HealthController, CompanyController, InvitesController, CategoriesController, ClientsController, ProvidersController, ServiceRequestsController, NotificationsController, ChatController, PhotosController, ReviewsController, DevicesController],
  providers: [CompaniesService, InvitesService, CategoriesService, ClientsService, ProvidersService, ServiceRequestsService, NotificationsService, RealtimeService, RealtimeGateway, { provide: DeadlineScheduler, useClass: BullDeadlineScheduler }, DeadlinesService, TrackingService, MaintenanceService, ChatService, PhotosService, ReviewsService, RequestAccessService, PushService, { provide: PushSender, useClass: FcmPushSender }],
})
export class AppModule {}
