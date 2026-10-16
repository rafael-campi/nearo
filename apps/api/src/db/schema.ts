// Tabelas do domínio (Drizzle). Toda tabela de domínio tem company_id e policy de RLS (ADR 0001);
// as policies ficam em migrations SQL manuais.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  geometry,
  integer,
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
  /** Conta excluída: os dados pessoais foram apagados e o histórico passou a mostrar "Usuário removido". */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
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

/** Pedidos de recuperação de senha. Identidade global, sem RLS (como `sessions`): só a autenticação acessa. */
export const passwordResets = pgTable('password_resets', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Hash do token enviado por e-mail; o token em si nunca é gravado. */
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

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

export const eventActor = pgEnum('event_actor', ['client', 'admin', 'provider', 'system']);

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
  enRouteAt: timestamp('en_route_at', { withTimezone: true }),
  arrivedAt: timestamp('arrived_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  /** Quando o cliente foi avisado do raio de aviso; só uma vez por pedido. */
  proximityNotifiedAt: timestamp('proximity_notified_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledByRole: eventActor('cancelled_by_role'),
  cancelReason: text('cancel_reason'),
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

export const notificationType = pgEnum('notification_type', ['new_request', 'request_accepted', 'request_confirmed', 'request_declined', 'request_needs_assignment', 'request_assigned', 'request_unclaimed', 'request_reminder', 'request_expired', 'request_status', 'provider_nearby', 'request_cancelled', 'request_withdrawn', 'new_message', 'review_received']);

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

/** Trilha do prestador a caminho: um ponto a cada ~30 s, mantida por 30 dias. A última posição fica no Redis. */
export const providerPositions = pgTable('provider_positions', {
  id: id(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  serviceRequestId: uuid('service_request_id')
    .notNull()
    .references(() => serviceRequests.id, { onDelete: 'cascade' }),
  location: geometry('location', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
});

export const requestEventKind = pgEnum('request_event_kind', ['cancellation', 'withdrawal']);

/** Cancelamentos e desistências: quem, quando e por quê. O admin vê o histórico do pedido. */
export const serviceRequestEvents = pgTable('service_request_events', {
  id: id(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  serviceRequestId: uuid('service_request_id')
    .notNull()
    .references(() => serviceRequests.id, { onDelete: 'cascade' }),
  kind: requestEventKind('kind').notNull(),
  byRole: eventActor('by_role').notNull(),
  /** Quem agiu; null quando foi o sistema (ex.: empresa desativada). */
  byUserId: uuid('by_user_id').references(() => users.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
});

export const messageSenderRole = pgEnum('message_sender_role', ['client', 'provider']);

/** Chat do pedido: só cliente e prestador escrevem, de confirmado a em execução. */
export const messages = pgTable(
  'messages',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    serviceRequestId: uuid('service_request_id')
      .notNull()
      .references(() => serviceRequests.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    senderRole: messageSenderRole('sender_role').notNull(),
    /** Gerado no app: reenviar a mesma mensagem não a duplica. */
    clientMessageId: uuid('client_message_id').notNull(),
    /** Chave da foto no storage (uma por mensagem). */
    photoKey: text('photo_key'),
    /** Ordem da conversa (mensagens no mesmo milissegundo não se embaralham); também é o cursor da paginação. */
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('messages_idempotency').on(t.serviceRequestId, t.senderId, t.clientMessageId)],
);

export const photoPurpose = pgEnum('photo_purpose', ['request_photo', 'chat_photo']);

/**
 * Envios autorizados pela API (URL assinada). A chave só pode ser usada por quem a pediu, uma vez,
 * e dentro da empresa em que foi emitida.
 */
export const uploads = pgTable('uploads', {
  key: text('key').primaryKey(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  purpose: photoPurpose('purpose').notNull(),
  createdAt: createdAt(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});

/** Fotos do pedido (até 5, anexadas na criação). */
export const serviceRequestPhotos = pgTable('service_request_photos', {
  id: id(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  serviceRequestId: uuid('service_request_id')
    .notNull()
    .references(() => serviceRequests.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  position: integer('position').notNull(),
});

/**
 * Avaliação do outro lado do pedido (nota 1–5 + comentário). Às cegas: `visibleAt` fica nulo até os dois
 * avaliarem ou o prazo de 7 dias acabar; o RLS só deixa o autor ler a própria enquanto isso.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    serviceRequestId: uuid('service_request_id')
      .notNull()
      .references(() => serviceRequests.id, { onDelete: 'cascade' }),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id),
    revieweeId: uuid('reviewee_id')
      .notNull()
      .references(() => users.id),
    reviewerRole: messageSenderRole('reviewer_role').notNull(),
    rating: integer('rating').notNull(),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
    visibleAt: timestamp('visible_at', { withTimezone: true }),
  },
  (t) => [unique('reviews_one_per_side').on(t.serviceRequestId, t.reviewerId)],
);

export const devicePlatform = pgEnum('device_platform', ['android', 'ios']);

/**
 * Token de push do aparelho (FCM). É da pessoa, não de uma empresa (como `sessions`): vale em todas as
 * empresas dela. O RLS deixa cada um mexer só nos próprios; o worker lê por função de plataforma.
 */
export const deviceTokens = pgTable('device_tokens', {
  token: text('token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  platform: devicePlatform('platform').notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
