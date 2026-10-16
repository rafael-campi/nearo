import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { Notification } from '@despacho/shared';
import { Tenant } from '../auth/decorators.js';
import { Clock } from '../clock.js';
import type { TenantContext } from '../db/tenant-transactions.js';
import { NotificationsService } from './notifications.service.js';

@Controller('my/notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  @Get()
  mine(@Tenant() tenant: TenantContext): Promise<Notification[]> {
    return this.notifications.mine(tenant.userId);
  }

  @Post('read')
  @HttpCode(204)
  markAllRead(@Tenant() tenant: TenantContext): Promise<void> {
    return this.notifications.markAllRead(tenant.userId, this.clock.now());
  }
}
