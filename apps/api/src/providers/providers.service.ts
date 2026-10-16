import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Provider, ProviderProfile } from '@despacho/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { categories, memberships, providerCategories, users } from '../db/schema.js';
import { TenantTransactions } from '../db/tenant-transactions.js';

/** Prestadores da empresa da transação atual; o RLS restringe à empresa. */
@Injectable()
export class ProvidersService {
  constructor(private readonly transactions: TenantTransactions) {}

  async list(membershipId?: string): Promise<Provider[]> {
    const tx = this.transactions.current();
    const rows = await tx
      .select({ membershipId: memberships.id, name: users.name, email: users.email, active: memberships.active })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.companyId, sql`app.current_company_id()`),
          eq(memberships.role, 'provider'),
          membershipId ? eq(memberships.id, membershipId) : undefined,
        ),
      )
      .orderBy(asc(sql`lower(${users.name})`));
    if (rows.length === 0) return [];

    const links = await tx
      .select({ membershipId: providerCategories.membershipId, categoryId: providerCategories.categoryId })
      .from(providerCategories)
      .where(inArray(providerCategories.membershipId, rows.map((r) => r.membershipId)));
    return rows.map((row) => ({
      ...row,
      categoryIds: links.filter((l) => l.membershipId === row.membershipId).map((l) => l.categoryId),
    }));
  }

  async setActive(membershipId: string, active: boolean): Promise<Provider> {
    await this.transactions
      .current()
      .update(memberships)
      .set({ active })
      .where(and(eq(memberships.id, membershipId), eq(memberships.role, 'provider')));
    return this.get(membershipId);
  }

  /** Substitui as categorias do prestador. Só aceita categorias da própria empresa. */
  async setCategories(membershipId: string, categoryIds: string[]): Promise<Provider> {
    await this.get(membershipId);
    const tx = this.transactions.current();
    const ids = [...new Set(categoryIds)];
    if (ids.length > 0) {
      const found = await tx.select({ id: categories.id }).from(categories).where(inArray(categories.id, ids));
      if (found.length !== ids.length) {
        throw new BadRequestException({ message: 'Dados inválidos', issues: [{ path: 'categoryIds', message: 'Categoria inválida' }] });
      }
    }
    await tx.delete(providerCategories).where(eq(providerCategories.membershipId, membershipId));
    if (ids.length > 0) {
      await tx.insert(providerCategories).values(
        ids.map((categoryId) => ({ companyId: sql`app.current_company_id()`, membershipId, categoryId })),
      );
    }
    return this.get(membershipId);
  }

  /** O próprio prestador: as categorias ativas que atende nesta empresa. */
  async profile(userId: string): Promise<ProviderProfile> {
    const rows = await this.transactions
      .current()
      .select({ id: categories.id, name: categories.name })
      .from(providerCategories)
      .innerJoin(memberships, eq(memberships.id, providerCategories.membershipId))
      .innerJoin(categories, eq(categories.id, providerCategories.categoryId))
      .where(and(eq(memberships.userId, userId), eq(memberships.role, 'provider'), eq(categories.active, true)))
      .orderBy(asc(sql`lower(${categories.name})`));
    return { categories: rows };
  }

  private async get(membershipId: string): Promise<Provider> {
    const [provider] = await this.list(membershipId);
    if (!provider) throw new NotFoundException();
    return provider;
  }
}
