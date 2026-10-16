import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put } from '@nestjs/common';
import {
  setProviderCategoriesRequestSchema,
  updateProviderSettingsRequestSchema,
  updateProviderRequestSchema,
  type Provider,
  type ProviderProfile,
  type SetProviderCategoriesRequest,
  type UpdateProviderRequest,
  type UpdateProviderSettingsRequest,
} from '@despacho/shared';
import { CompanyRoles, Tenant } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { TenantContext } from '../db/tenant-transactions.js';
import { ProvidersService } from './providers.service.js';

const membershipIdPipe = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Controller('company')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @CompanyRoles('admin')
  @Get('providers')
  list(): Promise<Provider[]> {
    return this.providers.list();
  }

  @CompanyRoles('admin')
  @Patch('providers/:membershipId')
  update(
    @Tenant() tenant: TenantContext,
    @Param('membershipId', membershipIdPipe) membershipId: string,
    @Body(new ZodPipe(updateProviderRequestSchema)) body: UpdateProviderRequest,
  ): Promise<Provider> {
    return this.providers.setActive(membershipId, body.active, tenant.userId);
  }

  @CompanyRoles('admin')
  @Put('providers/:membershipId/categories')
  setCategories(
    @Param('membershipId', membershipIdPipe) membershipId: string,
    @Body(new ZodPipe(setProviderCategoriesRequestSchema)) body: SetProviderCategoriesRequest,
  ): Promise<Provider> {
    return this.providers.setCategories(membershipId, body.categoryIds);
  }

  @CompanyRoles('provider')
  @Get('provider-profile')
  profile(@Tenant() tenant: TenantContext): Promise<ProviderProfile> {
    return this.providers.profile(tenant.userId);
  }

  @CompanyRoles('provider')
  @Patch('provider-profile')
  updateSettings(
    @Tenant() tenant: TenantContext,
    @Body(new ZodPipe(updateProviderSettingsRequestSchema)) body: UpdateProviderSettingsRequest,
  ): Promise<ProviderProfile> {
    return this.providers.updateSettings(tenant.userId, body);
  }
}
