import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createCategoryRequestSchema,
  updateCategoryRequestSchema,
  type Category,
  type CreateCategoryRequest,
  type UpdateCategoryRequest,
} from '@despacho/shared';
import { CompanyRoles } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CategoriesService } from './categories.service.js';

@CompanyRoles('admin')
@Controller('company/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(): Promise<Category[]> {
    return this.categories.list();
  }

  @Post()
  create(@Body(new ZodPipe(createCategoryRequestSchema)) body: CreateCategoryRequest): Promise<Category> {
    return this.categories.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body(new ZodPipe(updateCategoryRequestSchema)) body: UpdateCategoryRequest,
  ): Promise<Category> {
    return this.categories.update(id, body);
  }
}
