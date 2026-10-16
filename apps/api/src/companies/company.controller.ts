import { Controller, Get } from '@nestjs/common';
import type { Company } from '@despacho/shared';
import { CompanyRoles } from '../auth/decorators.js';
import { CompaniesService } from './companies.service.js';

@Controller('company')
export class CompanyController {
  constructor(private readonly companies: CompaniesService) {}

  @CompanyRoles('admin')
  @Get()
  get(): Promise<Company> {
    return this.companies.current();
  }
}
