import { Body, Controller, Get, Patch } from '@nestjs/common';
import { updateCompanySettingsRequestSchema, type Company, type JoinCodeResponse, type UpdateCompanySettingsRequest } from '@despacho/shared';
import { CompanyRoles } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CompaniesService } from './companies.service.js';

@Controller('company')
export class CompanyController {
  constructor(private readonly companies: CompaniesService) {}

  @CompanyRoles('admin', 'client')
  @Get()
  get(): Promise<Company> {
    return this.companies.current();
  }

  @CompanyRoles('admin')
  @Patch('settings')
  update(@Body(new ZodPipe(updateCompanySettingsRequestSchema)) body: UpdateCompanySettingsRequest): Promise<Company> {
    return this.companies.setAssignmentMode(body.assignmentMode);
  }

  @CompanyRoles('admin')
  @Get('join-code')
  joinCode(): Promise<JoinCodeResponse> {
    return this.companies.joinCode();
  }
}
