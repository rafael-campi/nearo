import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  createServiceRequestSchema,
  type CategoryOption,
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

  @Get('my/service-requests')
  mine(@Tenant() tenant: TenantContext): Promise<ServiceRequest[]> {
    return this.requests.mine(tenant.userId);
  }
}
