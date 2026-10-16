import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  advanceServiceRequestSchema,
  sendLocationSchema,
  assignServiceRequestSchema,
  createServiceRequestSchema,
  reasonRequestSchema,
  type AcceptServiceRequestResponse,
  type AdvanceServiceRequest,
  type ProviderLocation,
  type ReasonRequest,
  type RequestEvent,
  type SendLocation,
  type AssignServiceRequest,
  type CategoryOption,
  type EligibleProvider,
  type RequestDecline,
  type ConfirmServiceRequestResponse,
  type OpenServiceRequest,
  type ProviderServiceRequest,
  type ServiceRequest,
} from '@despacho/shared';
import type { z } from 'zod';
import { ReverseGeocoder } from '../geocoding/reverse-geocoder.js';
import { TenantTransactions } from '../db/tenant-transactions.js';
import { CompanyRoles, OwnTransaction, Tenant } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { TenantContext } from '../db/tenant-transactions.js';
import { ServiceRequestsService } from './service-requests.service.js';
import { TrackingService } from './tracking.service.js';

export type CreateServiceRequestInput = z.output<typeof createServiceRequestSchema>;

@Controller()
export class ServiceRequestsController {
  constructor(
    private readonly requests: ServiceRequestsService,
    private readonly tracking: TrackingService,
    private readonly geocoder: ReverseGeocoder,
    private readonly transactions: TenantTransactions,
  ) {}

  @CompanyRoles('admin', 'client', 'provider')
  @Get('company/category-options')
  categoryOptions(): Promise<CategoryOption[]> {
    return this.requests.categoryOptions();
  }

  /** O bairro vem da geocodificação (serviço externo, lento): é buscado antes de abrir a transação. */
  @CompanyRoles('client')
  @OwnTransaction()
  @Post('company/service-requests')
  async create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodPipe(createServiceRequestSchema)) body: CreateServiceRequestInput,
  ): Promise<ServiceRequest> {
    const neighborhood = await this.geocoder.neighborhood(body.location);
    return this.transactions.run(tenant, () => this.requests.create(tenant.userId, body, neighborhood));
  }

  @CompanyRoles('admin')
  @Get('company/service-requests')
  forCompany(): Promise<ServiceRequest[]> {
    return this.requests.forCompany();
  }

  @CompanyRoles('admin')
  @Get('company/service-requests/:id')
  one(@Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string): Promise<ServiceRequest> {
    return this.requests.one(id);
  }

  @CompanyRoles('admin')
  @Post('company/service-requests/:id/assign')
  @HttpCode(200)
  assign(
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body(new ZodPipe(assignServiceRequestSchema)) body: AssignServiceRequest,
  ): Promise<AcceptServiceRequestResponse> {
    return this.requests.assign(id, body.providerMembershipId);
  }

  @CompanyRoles('admin')
  @Get('company/service-requests/:id/eligible-providers')
  eligibleProviders(@Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string): Promise<EligibleProvider[]> {
    return this.requests.eligibleProviders(id);
  }

  @CompanyRoles('admin')
  @Get('company/service-requests/:id/declines')
  declines(@Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string): Promise<RequestDecline[]> {
    return this.requests.declines(id);
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

  @CompanyRoles('provider')
  @Get('company/provider-requests')
  forProvider(@Tenant() tenant: TenantContext): Promise<ProviderServiceRequest[]> {
    return this.requests.forProvider(tenant.userId);
  }

  @CompanyRoles('provider')
  @Post('company/service-requests/:id/status')
  @HttpCode(200)
  advance(
    @Tenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body(new ZodPipe(advanceServiceRequestSchema)) body: AdvanceServiceRequest,
  ): Promise<AcceptServiceRequestResponse> {
    return this.requests.advance(tenant.userId, id, body.status);
  }

  @CompanyRoles('provider')
  @Post('company/service-requests/:id/location')
  @HttpCode(204)
  async sendLocation(
    @Tenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body(new ZodPipe(sendLocationSchema)) body: SendLocation,
  ): Promise<void> {
    await this.tracking.report(tenant.userId, id, body);
  }

  @CompanyRoles('client')
  @Get('company/service-requests/:id/location')
  location(
    @Tenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ): Promise<ProviderLocation | null> {
    return this.tracking.lastFor(tenant.userId, id);
  }

  @CompanyRoles('client')
  @Post('company/service-requests/:id/cancel')
  @HttpCode(204)
  cancel(
    @Tenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body(new ZodPipe(reasonRequestSchema)) body: ReasonRequest,
  ): Promise<void> {
    return this.requests.cancelByClient(tenant.userId, id, body.reason);
  }

  @CompanyRoles('admin')
  @Post('company/service-requests/:id/admin-cancel')
  @HttpCode(204)
  adminCancel(
    @Tenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body(new ZodPipe(reasonRequestSchema)) body: ReasonRequest,
  ): Promise<void> {
    return this.requests.cancelByAdmin(tenant.userId, id, body.reason);
  }

  @CompanyRoles('provider')
  @Post('company/service-requests/:id/withdraw')
  @HttpCode(204)
  withdraw(
    @Tenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body(new ZodPipe(reasonRequestSchema)) body: ReasonRequest,
  ): Promise<void> {
    return this.requests.withdraw(tenant.userId, id, body.reason);
  }

  @CompanyRoles('admin')
  @Get('company/service-requests/:id/events')
  events(@Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string): Promise<RequestEvent[]> {
    return this.requests.events(id);
  }

  @CompanyRoles('client')
  @Post('company/service-requests/:id/confirm')
  @HttpCode(200)
  confirm(
    @Tenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ): Promise<ConfirmServiceRequestResponse> {
    return this.requests.confirm(tenant.userId, id);
  }

  @CompanyRoles('client')
  @Post('company/service-requests/:id/decline-provider')
  @HttpCode(204)
  declineProvider(
    @Tenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ): Promise<void> {
    return this.requests.declineProvider(tenant.userId, id);
  }

  @Get('my/service-requests')
  mine(@Tenant() tenant: TenantContext): Promise<ServiceRequest[]> {
    return this.requests.mine(tenant.userId);
  }
}
