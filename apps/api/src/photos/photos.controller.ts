import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { createUploadRequestSchema, type CreateUploadRequest, type UploadTicket } from '@despacho/shared';
import { CompanyRoles, Tenant } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { TenantContext } from '../db/tenant-transactions.js';
import { PhotosService } from './photos.service.js';

@Controller('company/uploads')
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  /** Autoriza o envio de uma foto (JPEG) direto ao storage. */
  @CompanyRoles('client', 'provider')
  @Post()
  @HttpCode(201)
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodPipe(createUploadRequestSchema)) body: CreateUploadRequest,
  ): Promise<UploadTicket & { key: string }> {
    return this.photos.createUpload(tenant.userId, tenant.companyId!, body);
  }
}
