import { Controller, Get } from '@nestjs/common';
import type { Company, JoinCodeResponse } from '@despacho/shared';
import { CompanyRoles } from '../auth/decorators.js';
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
  @Get('join-code')
  joinCode(): Promise<JoinCodeResponse> {
    return this.companies.joinCode();
  }
}
