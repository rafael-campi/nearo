import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { createReviewSchema, type CreateReview, type RequestReviews, type Review } from '@despacho/shared';
import { CompanyRoles, Tenant } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { TenantContext } from '../db/tenant-transactions.js';
import { ReviewsService } from './reviews.service.js';

const idPipe = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Controller('company/service-requests/:id/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @CompanyRoles('client', 'provider')
  @Post()
  @HttpCode(201)
  create(
    @Tenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodPipe(createReviewSchema)) body: CreateReview & { rating: number },
  ): Promise<Review> {
    return this.reviews.create(tenant.userId, id, body);
  }

  @CompanyRoles('client', 'provider', 'admin')
  @Get()
  list(@Tenant() tenant: TenantContext, @Param('id', idPipe) id: string): Promise<RequestReviews> {
    return this.reviews.forRequest(tenant.userId, id);
  }
}
