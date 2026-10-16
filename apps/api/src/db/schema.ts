// Tabelas do domínio (Drizzle). Toda tabela de domínio tem company_id e policy de RLS (ADR 0001);
// as policies ficam em migrations SQL manuais.
import { sql } from 'drizzle-orm';
import {
  boolean,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const membershipRole = pgEnum('membership_role', ['admin', 'provider', 'client']);

/** Identidade global (não pertence a uma empresa). Sem RLS: só a autenticação acessa. */
export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

/** Sessões de login. Sem RLS: só a autenticação acessa. */
export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const companies = pgTable('companies', {
  id: id(),
  name: text('name').notNull(),
  /** Código de acesso que a empresa divulga para clientes. */
  joinCode: text('join_code').notNull().unique(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.companyId, t.userId, t.role)],
);

export const invites = pgTable('invites', {
  id: id(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: membershipRole('role').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const categories = pgTable(
  'categories',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  // Nome único por empresa, sem diferenciar maiúsculas.
  (t) => [uniqueIndex('categories_company_name_unique').on(t.companyId, sql`lower(${t.name})`)],
);

/** Categorias que um prestador atende numa empresa (definidas pelo admin). */
export const providerCategories = pgTable(
  'provider_categories',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.categoryId] })],
);
