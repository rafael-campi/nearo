import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  acceptInviteRequestSchema,
  createInviteRequestSchema,
  type AcceptInviteRequest,
  type AcceptInviteResponse,
  type CreateInviteRequest,
  type Invite,
  type InvitePreview,
} from '@despacho/shared';
import { CompanyRoles, Public, Tenant } from '../auth/decorators.js';
import { CompaniesService } from '../companies/companies.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { TenantTransactions, type TenantContext } from '../db/tenant-transactions.js';
import { InvitesService } from './invites.service.js';

@Controller()
export class InvitesController {
  constructor(
    private readonly invites: InvitesService,
    private readonly companies: CompaniesService,
    private readonly transactions: TenantTransactions,
  ) {}

  @Public()
  @Get('invites/:token')
  preview(@Param('token') token: string): Promise<InvitePreview> {
    return this.invites.preview(token);
  }

  @Public()
  @Post('invites/:token/accept')
  @HttpCode(200)
  accept(
    @Param('token') token: string,
    @Body(new ZodPipe(acceptInviteRequestSchema)) body: AcceptInviteRequest,
  ): Promise<AcceptInviteResponse> {
    return this.invites.accept(token, body);
  }

  @CompanyRoles('admin')
  @Post('company/invites')
  async create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodPipe(createInviteRequestSchema)) body: CreateInviteRequest,
  ): Promise<Invite> {
    const company = await this.companies.current();
    return this.invites.create(this.transactions.current(), {
      companyId: company.id,
      companyName: company.name,
      email: body.email,
      role: body.role,
      invitedBy: tenant.userId,
    });
  }
}
