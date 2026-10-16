import { Body, Controller, Delete, HttpCode, Put } from '@nestjs/common';
import {
  registerDeviceTokenSchema,
  removeDeviceTokenSchema,
  type RegisterDeviceToken,
  type RemoveDeviceToken,
} from '@despacho/shared';
import { and, eq, sql } from 'drizzle-orm';
import { Tenant } from '../auth/decorators.js';
import { Clock } from '../clock.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { deviceTokens } from '../db/schema.js';
import { TenantTransactions, type TenantContext } from '../db/tenant-transactions.js';

/** Token de push do aparelho: o app registra ao entrar e remove ao sair. */
@Controller('my/device-token')
export class DevicesController {
  constructor(
    private readonly transactions: TenantTransactions,
    private readonly clock: Clock,
  ) {}

  @Put()
  @HttpCode(204)
  async register(
    @Tenant() tenant: TenantContext,
    @Body(new ZodPipe(registerDeviceTokenSchema)) body: RegisterDeviceToken,
  ): Promise<void> {
    await this.transactions
      .current()
      .execute(sql`select app.claim_device_token(${body.token}, ${tenant.userId}, ${body.platform}::device_platform, ${this.clock.now().toISOString()}::timestamptz)`);
  }

  @Delete()
  @HttpCode(204)
  async remove(@Tenant() tenant: TenantContext, @Body(new ZodPipe(removeDeviceTokenSchema)) body: RemoveDeviceToken): Promise<void> {
    // O RLS já limita aos tokens da própria pessoa; o filtro deixa a intenção explícita.
    await this.transactions
      .current()
      .delete(deviceTokens)
      .where(and(eq(deviceTokens.token, body.token), eq(deviceTokens.userId, tenant.userId)));
  }
}
