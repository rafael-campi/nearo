import { z } from 'zod';
import { MAX_REQUEST_PHOTOS } from './photo.js';
import { ratingSchema } from './review.js';
import { coordinatesSchema } from './provider.js';

/** Status do Pedido. Ver "Status do pedido" em GLOSSARY.md. */
export const serviceRequestStatusSchema = z.enum([
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
export type ServiceRequestStatus = z.infer<typeof serviceRequestStatusSchema>;

/** Nome de cada status na interface (termos do glossário). */
export const serviceRequestStatusLabel: Record<ServiceRequestStatus, string> = {
  open: 'Aberto',
  assigned: 'Atribuído',
  awaiting_client: 'Aguardando cliente',
  confirmed: 'Confirmado',
  en_route: 'A caminho',
  arrived: 'Chegou',
  in_progress: 'Em execução',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

export const createServiceRequestSchema = z.object({
  categoryId: z.uuid({ error: 'Escolha a categoria' }),
  description: z
    .string()
    .trim()
    .min(10, { error: 'Descreva o problema com pelo menos 10 caracteres' })
    .max(2000, { error: 'Use no máximo 2000 caracteres' }),
  location: coordinatesSchema,
  addressComplement: z.string().trim().max(200, { error: 'Use no máximo 200 caracteres' }).default(''),
  /** Chaves devolvidas por `POST /company/uploads` (propósito `request_photo`). */
  photoKeys: z.array(z.string()).max(MAX_REQUEST_PHOTOS, { error: `Use no máximo ${MAX_REQUEST_PHOTOS} fotos` }).default([]),
});
export type CreateServiceRequest = z.input<typeof createServiceRequestSchema>;

/** Prestador que aceitou o pedido, como o cliente o vê. O telefone só aparece depois de confirmado. */
export const requestProviderSchema = z.object({
  name: z.string(),
  completedCount: z.number().int(),
  rating: ratingSchema,
  phone: z.string().nullable(),
});
export type RequestProvider = z.infer<typeof requestProviderSchema>;

export const serviceRequestSchema = z.object({
  id: z.uuid(),
  companyId: z.uuid(),
  companyName: z.string(),
  categoryId: z.uuid(),
  categoryName: z.string(),
  clientName: z.string(),
  description: z.string(),
  location: coordinatesSchema,
  addressComplement: z.string(),
  neighborhood: z.string().nullable(),
  status: serviceRequestStatusSchema,
  provider: requestProviderSchema.nullable(),
  /** Links de leitura das fotos do pedido (valem por 1 h). */
  photos: z.array(z.string()),
  /** Quando o pedido está `cancelled`: quem cancelou e por quê. */
  cancellation: z
    .object({ byRole: z.enum(['client', 'admin', 'system']), reason: z.string(), at: z.iso.datetime() })
    .nullable(),
  createdAt: z.iso.datetime(),
});
export type ServiceRequest = z.infer<typeof serviceRequestSchema>;

/**
 * Visão reduzida de um pedido aberto, para o prestador decidir se aceita (ADR 0002):
 * sem endereço completo, coordenadas exatas nem telefone.
 */
export const openServiceRequestSchema = z.object({
  id: z.uuid(),
  companyId: z.uuid(),
  categoryName: z.string(),
  description: z.string(),
  neighborhood: z.string().nullable(),
  /** Distância aproximada (km, uma casa decimal) do endereço-base do prestador. */
  distanceKm: z.number(),
  clientFirstName: z.string(),
  /** Nota do cliente nesta empresa e quantos pedidos dele foram concluídos (para o prestador decidir). */
  clientRating: ratingSchema,
  clientCompletedCount: z.number().int(),
  /** Atribuído a este prestador pelo admin (ele aceita ou recusa). */
  assigned: z.boolean(),
  photos: z.array(z.string()),
  createdAt: z.iso.datetime(),
});
export type OpenServiceRequest = z.infer<typeof openServiceRequestSchema>;

export const acceptServiceRequestResponseSchema = z.object({
  id: z.uuid(),
  status: serviceRequestStatusSchema,
});
export type AcceptServiceRequestResponse = z.infer<typeof acceptServiceRequestResponseSchema>;

export const confirmServiceRequestResponseSchema = acceptServiceRequestResponseSchema;
export type ConfirmServiceRequestResponse = AcceptServiceRequestResponse;

/** Status em que endereço completo e telefones já foram liberados (a partir da confirmação). */
export const fullViewStatuses: ServiceRequestStatus[] = ['confirmed', 'en_route', 'arrived', 'in_progress', 'completed'];

/** Pedido do prestador: visão reduzida até o cliente confirmar; depois, endereço completo e telefone do cliente. */
export const providerServiceRequestSchema = z.object({
  id: z.uuid(),
  companyId: z.uuid(),
  categoryName: z.string(),
  description: z.string(),
  neighborhood: z.string().nullable(),
  clientFirstName: z.string(),
  status: serviceRequestStatusSchema,
  photos: z.array(z.string()),
  details: z
    .object({
      clientName: z.string(),
      clientPhone: z.string().nullable(),
      location: coordinatesSchema,
      addressComplement: z.string(),
    })
    .nullable(),
  createdAt: z.iso.datetime(),
});
export type ProviderServiceRequest = z.infer<typeof providerServiceRequestSchema>;

export const assignServiceRequestSchema = z.object({ providerMembershipId: z.uuid() });
export type AssignServiceRequest = z.infer<typeof assignServiceRequestSchema>;

/** Prestador apto para um pedido, como o admin o vê ao atribuir. */
export const eligibleProviderSchema = z.object({
  membershipId: z.uuid(),
  name: z.string(),
  distanceKm: z.number(),
});
export type EligibleProvider = z.infer<typeof eligibleProviderSchema>;

/** Recusa registrada num pedido: quem recusou (prestador) ou foi recusado (pelo cliente), e quando. */
export const requestDeclineSchema = z.object({
  providerName: z.string(),
  by: z.enum(['provider', 'client']),
  createdAt: z.iso.datetime(),
});
export type RequestDecline = z.infer<typeof requestDeclineSchema>;

/** O prestador avança o atendimento um passo por vez: confirmado → a caminho → chegou → em execução → concluído. */
export const serviceStepSchema = z.enum(['en_route', 'arrived', 'in_progress', 'completed']);
export type ServiceStep = z.infer<typeof serviceStepSchema>;

export const advanceServiceRequestSchema = z.object({ status: serviceStepSchema });
export type AdvanceServiceRequest = z.infer<typeof advanceServiceRequestSchema>;

/** Próximo passo a partir de cada status, com o texto do botão do prestador. */
export const nextServiceStep: Partial<Record<ServiceRequestStatus, { to: ServiceStep; label: string }>> = {
  confirmed: { to: 'en_route', label: 'Estou a caminho' },
  en_route: { to: 'arrived', label: 'Cheguei' },
  arrived: { to: 'in_progress', label: 'Iniciar serviço' },
  in_progress: { to: 'completed', label: 'Concluir serviço' },
};

/** Distância (m) em que o cliente é avisado de que o prestador está chegando (glossário: Raio de aviso). */
export const PROXIMITY_RADIUS_M = 500;
/** Intervalo (ms) com que o app do prestador envia a posição enquanto o pedido está a caminho. */
export const GPS_INTERVAL_MS = 10_000;

export const sendLocationSchema = coordinatesSchema;
export type SendLocation = z.infer<typeof sendLocationSchema>;

/** Cancelamento e desistência guardam o motivo (texto livre). */
export const reasonRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, { error: 'Informe o motivo' })
    .max(500, { error: 'Use no máximo 500 caracteres' }),
});
export type ReasonRequest = z.infer<typeof reasonRequestSchema>;

/** Status em que o cliente ainda pode cancelar: de aberto até a caminho. Depois de "chegou", só o admin. */
export const clientCancellableStatuses: ServiceRequestStatus[] = ['open', 'assigned', 'awaiting_client', 'confirmed', 'en_route'];
/** Status em que o prestador pode desistir. */
export const withdrawableStatuses: ServiceRequestStatus[] = ['confirmed', 'en_route'];

export const requestEventSchema = z.object({
  kind: z.enum(['cancellation', 'withdrawal']),
  byRole: z.enum(['client', 'admin', 'provider', 'system']),
  /** Nome de quem agiu; null quando foi o sistema. */
  byName: z.string().nullable(),
  reason: z.string(),
  createdAt: z.iso.datetime(),
});
export type RequestEvent = z.infer<typeof requestEventSchema>;

/** Páginas das listas de pedidos: os mais recentes primeiro; `before` leva aos mais antigos que essa data. */
export const REQUESTS_PAGE_SIZE = 50;
export const requestsPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(REQUESTS_PAGE_SIZE),
  before: z.iso.datetime().optional(),
});
export type RequestsPageQuery = z.output<typeof requestsPageQuerySchema>;
