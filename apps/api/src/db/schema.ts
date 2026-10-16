// Tabelas do domínio (Drizzle). Toda tabela de domínio tem company_id e policy de RLS (ADR 0001);
// as policies ficam em migrations SQL manuais.
import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  geometry,
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
  /** Só dígitos, com DDD. Opcional; é mostrado ao outro lado só depois da confirmação do pedido. */
  phone: text('phone'),
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

export const assignmentMode = pgEnum('assignment_mode', ['manual', 'broadcast']);

export const companies = pgTable('companies', {
  id: id(),
  name: text('name').notNull(),
  /** Código de acesso que a empresa divulga para clientes. */
  joinCode: text('join_code').notNull().unique(),
  active: boolean('active').notNull().default(true),
  assignmentMode: assignmentMode('assignment_mode').notNull().default('broadcast'),
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

/**
 * Atuação do prestador numa empresa: endereço-base, raio da área de atendimento e disponível.
 * Criada no primeiro ajuste do prestador; sem linha = sem endereço-base e indisponível.
 */
export const providerProfiles = pgTable('provider_profiles', {
  membershipId: uuid('membership_id')
    .primaryKey()
    .references(() => memberships.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  baseLocation: geometry('base_location', { type: 'point', mode: 'xy', srid: 4326 }),
  serviceRadiusKm: doublePrecision('service_radius_km').notNull().default(20),
  available: boolean('available').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const serviceRequestStatus = pgEnum('service_request_status', [
  'open',
  'assigned',
  'awaiting_client',
  'confirmed',
  'en_route',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
]);

/** Pedido: solicitação de serviço de um cliente para uma empresa, numa categoria. */
export const serviceRequests = pgTable('service_requests', {
  id: id(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id')
    .notNull()
    .references(() => users.id),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => categories.id),
  description: text('description').notNull(),
  location: geometry('location', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
  addressComplement: text('address_complement').notNull().default(''),
  neighborhood: text('neighborhood'),
  status: serviceRequestStatus('status').notNull().default('open'),
  /** Vínculo do prestador que aceitou (ou foi atribuído). */
  providerMembershipId: uuid('provider_membership_id').references(() => memberships.id),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  /** Os prestadores aptos veem e aceitam o pedido aberto (modo da empresa quando ele foi criado ou reaberto). */
  broadcast: boolean('broadcast').notNull().default(true),
  /** Desde quando o pedido está aberto (criação ou última volta para aberto); marca o prazo de 15 min. */
  openedAt: timestamp('opened_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const declineBy = pgEnum('decline_by', ['provider', 'client']);

/** Recusa: o prestador recusou o pedido, ou o cliente recusou o prestador. Ele deixa de ver o pedido. */
export const serviceRequestDeclines = pgTable(
  'service_request_declines',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    serviceRequestId: uuid('service_request_id')
      .notNull()
      .references(() => serviceRequests.id, { onDelete: 'cascade' }),
    providerMembershipId: uuid('provider_membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    by: declineBy('by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.serviceRequestId, t.providerMembershipId] })],
);

export const notificationType = pgEnum('notification_type', ['new_request', 'request_accepted', 'request_confirmed', 'request_declined', 'request_needs_assignment', 'request_assigned', 'request_unclaimed', 'request_reminder', 'request_expired']);

/** Atualização gravada para um usuário; o socket (e, depois, o push) a entrega. */
export const notifications = pgTable('notifications', {
  id: id(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: notificationType('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  serviceRequestId: uuid('service_request_id').references(() => serviceRequests.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: createdAt(),
});
