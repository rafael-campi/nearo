import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_SERVICE_RADIUS_KM,
  type Coordinates,
  type Provider,
  type ProviderProfile,
  type ProviderSettings,
  type UpdateProviderSettingsRequest,
} from '@despacho/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { categories, memberships, providerCategories, providerProfiles, users } from '../db/schema.js';
import { TenantTransactions } from '../db/tenant-transactions.js';

/** Prestadores da empresa da transação atual; o RLS restringe à empresa. */
@Injectable()
export class ProvidersService {
  constructor(private readonly transactions: TenantTransactions) {}

  async list(membershipId?: string): Promise<Provider[]> {
    const tx = this.transactions.current();
    const rows = await tx
      .select({
        membershipId: memberships.id,
        name: users.name,
        email: users.email,
        active: memberships.active,
        ...settingsColumns,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(providerProfiles, eq(providerProfiles.membershipId, memberships.id))
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
    return rows.map(({ baseLocation, serviceRadiusKm, available, ...row }) => ({
      ...row,
      ...toSettings({ baseLocation, serviceRadiusKm, available }),
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

  /** O próprio prestador: atuação e categorias ativas nesta empresa. */
  async profile(userId: string): Promise<ProviderProfile> {
    const membershipId = await this.ownMembershipId(userId);
    const [settings] = await this.transactions
      .current()
      .select(settingsColumns)
      .from(memberships)
      .leftJoin(providerProfiles, eq(providerProfiles.membershipId, memberships.id))
      .where(eq(memberships.id, membershipId));
    const rows = await this.transactions
      .current()
      .select({ id: categories.id, name: categories.name })
      .from(providerCategories)
      .innerJoin(memberships, eq(memberships.id, providerCategories.membershipId))
      .innerJoin(categories, eq(categories.id, providerCategories.categoryId))
      .where(and(eq(memberships.userId, userId), eq(memberships.role, 'provider'), eq(categories.active, true)))
      .orderBy(asc(sql`lower(${categories.name})`));
    return { ...toSettings(settings), categories: rows };
  }

  /** O próprio prestador ajusta endereço-base, raio e disponível. Sem endereço-base, não fica disponível. */
  async updateSettings(userId: string, body: UpdateProviderSettingsRequest): Promise<ProviderProfile> {
    const membershipId = await this.ownMembershipId(userId);
    const current = await this.profile(userId);
    if (body.available && !(body.baseLocation ?? current.baseLocation)) {
      throw new BadRequestException({
        message: 'Dados inválidos',
        issues: [{ path: 'available', message: 'Cadastre seu endereço-base antes de ficar disponível' }],
      });
    }
    const changes = {
      ...(body.baseLocation && { baseLocation: toPoint(body.baseLocation) }),
      ...(body.serviceRadiusKm !== undefined && { serviceRadiusKm: body.serviceRadiusKm }),
      ...(body.available !== undefined && { available: body.available }),
      updatedAt: sql`now()`,
    };
    await this.transactions
      .current()
      .insert(providerProfiles)
      .values({ membershipId, companyId: sql`app.current_company_id()`, ...changes })
      .onConflictDoUpdate({ target: providerProfiles.membershipId, set: changes });
    return this.profile(userId);
  }

  private async ownMembershipId(userId: string): Promise<string> {
    const [membership] = await this.transactions
      .current()
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.companyId, sql`app.current_company_id()`),
          eq(memberships.userId, userId),
          eq(memberships.role, 'provider'),
        ),
      );
    if (!membership) throw new NotFoundException();
    return membership.id;
  }

  private async get(membershipId: string): Promise<Provider> {
    const [provider] = await this.list(membershipId);
    if (!provider) throw new NotFoundException();
    return provider;
  }
}

const settingsColumns = {
  baseLocation: providerProfiles.baseLocation,
  serviceRadiusKm: providerProfiles.serviceRadiusKm,
  available: providerProfiles.available,
};

type SettingsRow = {
  baseLocation: { x: number; y: number } | null;
  serviceRadiusKm: number | null;
  available: boolean | null;
};

/** Sem linha em provider_profiles: sem endereço-base, raio padrão e indisponível. */
function toSettings(row: SettingsRow | undefined): ProviderSettings {
  return {
    baseLocation: row?.baseLocation ? { latitude: row.baseLocation.y, longitude: row.baseLocation.x } : null,
    serviceRadiusKm: row?.serviceRadiusKm ?? DEFAULT_SERVICE_RADIUS_KM,
    available: row?.available ?? false,
  };
}

function toPoint({ latitude, longitude }: Coordinates) {
  return { x: longitude, y: latitude };
}
