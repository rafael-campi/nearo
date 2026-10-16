import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  createServiceRequestSchema,
  type AcceptServiceRequestResponse,
  type CategoryOption,
  type OpenServiceRequest,
  type ServiceRequest,
} from '@despacho/shared';
import type { z } from 'zod';
import { CompanyRoles, Tenant } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { TenantContext } from '../db/tenant-transactions.js';
import { ServiceRequestsService } from './service-requests.service.js';

export type CreateServiceRequestInput = z.output<typeof createServiceRequestSchema>;

@Controller()
export class ServiceRequestsController {
  constructor(private readonly requests: ServiceRequestsService) {}

  @CompanyRoles('admin', 'client', 'provider')
  @Get('company/category-options')
  categoryOptions(): Promise<CategoryOption[]> {
    return this.requests.categoryOptions();
  }

  @CompanyRoles('client')
  @Post('company/service-requests')
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodPipe(createServiceRequestSchema)) body: CreateServiceRequestInput,
  ): Promise<ServiceRequest> {
    return this.requests.create(tenant.userId, body);
  }

  @CompanyRoles('admin')
  @Get('company/service-requests')
  forCompany(): Promise<ServiceRequest[]> {
    return this.requests.forCompany();
  }

  @CompanyRoles('provider')
  @Get('company/open-requests')
  openForProvider(@Tenant() tenant: TenantContext): Promise<OpenServiceRequest[]> {
    return this.requests.openForProvider(tenant.userId);
  }

  @CompanyRoles('provider')
  @Post('company/service-requests/:id/accept')
  @HttpCode(200)
  accept(
    @Tenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ): Promise<AcceptServiceRequestResponse> {
    return this.requests.accept(tenant.userId, id);
  }

  @CompanyRoles('provider')
  @Post('company/service-requests/:id/decline')
  @HttpCode(204)
  decline(
    @Tenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ): Promise<void> {
    return this.requests.decline(tenant.userId, id);
  }

  @Get('my/service-requests')
  mine(@Tenant() tenant: TenantContext): Promise<ServiceRequest[]> {
    return this.requests.mine(tenant.userId);
  }
}
