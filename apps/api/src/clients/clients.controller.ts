import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  joinCompanyRequestSchema,
  updateClientRequestSchema,
  type Client,
  type JoinCompanyRequest,
  type JoinCompanyResponse,
  type UpdateClientRequest,
} from '@despacho/shared';
import { CompanyRoles, Tenant } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { TenantContext } from '../db/tenant-transactions.js';
import { ClientsService } from './clients.service.js';

@Controller()
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Post('join')
  @HttpCode(200)
  join(
    @Tenant() tenant: TenantContext,
    @Body(new ZodPipe(joinCompanyRequestSchema)) body: JoinCompanyRequest,
  ): Promise<JoinCompanyResponse> {
    return this.clients.join(tenant.userId, body.code);
  }

  @CompanyRoles('admin')
  @Get('company/clients')
  list(): Promise<Client[]> {
    return this.clients.list();
  }

  @CompanyRoles('admin')
  @Patch('company/clients/:membershipId')
  update(
    @Param('membershipId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) membershipId: string,
    @Body(new ZodPipe(updateClientRequestSchema)) body: UpdateClientRequest,
  ): Promise<Client> {
    return this.clients.setActive(membershipId, body.active);
  }
}
