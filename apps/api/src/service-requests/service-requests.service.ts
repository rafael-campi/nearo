import { BadRequestException, Injectable } from '@nestjs/common';
import type { CategoryOption, ServiceRequest } from '@despacho/shared';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { Clock } from '../clock.js';
import { categories, companies, memberships, serviceRequests, users } from '../db/schema.js';
import { TenantTransactions } from '../db/tenant-transactions.js';
import { ReverseGeocoder } from '../geocoding/reverse-geocoder.js';
import type { CreateServiceRequestInput } from './service-requests.controller.js';

@Injectable()
export class ServiceRequestsService {
  constructor(
    private readonly transactions: TenantTransactions,
    private readonly geocoder: ReverseGeocoder,
    private readonly clock: Clock,
  ) {}

  /** Categorias ativas da empresa, para quem pede ou atende. */
  categoryOptions(): Promise<CategoryOption[]> {
    return this.transactions
      .current()
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.companyId, sql`app.current_company_id()`), eq(categories.active, true)))
      .orderBy(asc(sql`lower(${categories.name})`));
  }

  async create(clientId: string, body: CreateServiceRequestInput): Promise<ServiceRequest> {
    const tx = this.transactions.current();
    const [category] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.id, body.categoryId),
          eq(categories.companyId, sql`app.current_company_id()`),
          eq(categories.active, true),
        ),
      );
    if (!category) {
      throw new BadRequestException({ message: 'Dados inválidos', issues: [{ path: 'categoryId', message: 'Categoria inválida' }] });
    }

    const neighborhood = await this.geocoder.neighborhood(body.location);
    const now = this.clock.now();
    const [created] = await tx
      .insert(serviceRequests)
      .values({
        companyId: sql`app.current_company_id()`,
        clientId,
        categoryId: body.categoryId,
        description: body.description,
        location: { x: body.location.longitude, y: body.location.latitude },
        addressComplement: body.addressComplement,
        neighborhood,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: serviceRequests.id });
    const [request] = await this.find(eq(serviceRequests.id, created.id));
    return request;
  }

  /** Pedidos da empresa atual, mais recentes primeiro. */
  forCompany(): Promise<ServiceRequest[]> {
    return this.find(eq(serviceRequests.companyId, sql`app.current_company_id()`));
  }

  /** "Meus pedidos": os do cliente, em todas as empresas onde ainda tem vínculo ativo. */
  mine(clientId: string): Promise<ServiceRequest[]> {
    return this.find(
      and(
        eq(serviceRequests.clientId, clientId),
        sql`exists (
          select 1 from ${memberships}
          where ${memberships.companyId} = ${serviceRequests.companyId}
            and ${memberships.userId} = ${clientId}
            and ${memberships.role} = 'client'
            and ${memberships.active}
        )`,
        eq(companies.active, true),
      ),
    );
  }

  private async find(where: SQL | undefined): Promise<ServiceRequest[]> {
    const rows = await this.transactions
      .current()
      .select({
        id: serviceRequests.id,
        companyId: serviceRequests.companyId,
        companyName: companies.name,
        categoryId: serviceRequests.categoryId,
        categoryName: categories.name,
        clientName: users.name,
        description: serviceRequests.description,
        location: serviceRequests.location,
        addressComplement: serviceRequests.addressComplement,
        neighborhood: serviceRequests.neighborhood,
        status: serviceRequests.status,
        createdAt: serviceRequests.createdAt,
      })
      .from(serviceRequests)
      .innerJoin(companies, eq(companies.id, serviceRequests.companyId))
      .innerJoin(categories, eq(categories.id, serviceRequests.categoryId))
      .innerJoin(users, eq(users.id, serviceRequests.clientId))
      .where(where)
      .orderBy(desc(serviceRequests.createdAt));
    return rows.map(({ location, createdAt, ...row }) => ({
      ...row,
      location: { latitude: location.y, longitude: location.x },
      createdAt: createdAt.toISOString(),
    }));
  }
}
