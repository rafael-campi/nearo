import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Category, CreateCategoryRequest, UpdateCategoryRequest } from '@despacho/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { isUniqueViolation } from '../common/db-errors.js';
import { categories } from '../db/schema.js';
import { TenantTransactions } from '../db/tenant-transactions.js';

const columns = { id: categories.id, name: categories.name, active: categories.active };

/** Categorias da empresa da transação atual; o RLS restringe à empresa. */
@Injectable()
export class CategoriesService {
  constructor(private readonly transactions: TenantTransactions) {}

  list(): Promise<Category[]> {
    return this.transactions.current().select(columns).from(categories).orderBy(asc(sql`lower(${categories.name})`));
  }

  async create(body: CreateCategoryRequest): Promise<Category> {
    const [category] = await this.unique(() =>
      this.transactions
        .current()
        .insert(categories)
        .values({ companyId: sql`app.current_company_id()`, name: body.name })
        .returning(columns),
    );
    return category;
  }

  async update(id: string, body: UpdateCategoryRequest): Promise<Category> {
    const [category] = await this.unique(() =>
      this.transactions
        .current()
        .update(categories)
        .set({ name: body.name, active: body.active })
        .where(eq(categories.id, id))
        .returning(columns),
    );
    if (!category) throw new NotFoundException();
    return category;
  }

  private async unique<T>(query: () => Promise<T>): Promise<T> {
    try {
      return await query();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Já existe uma categoria com esse nome');
      throw error;
    }
  }
}
