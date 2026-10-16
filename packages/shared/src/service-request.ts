import { z } from 'zod';
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
});
export type CreateServiceRequest = z.input<typeof createServiceRequestSchema>;

/** Prestador que aceitou o pedido, como o cliente o vê. O telefone só aparece depois de confirmado. */
export const requestProviderSchema = z.object({
  name: z.string(),
  completedCount: z.number().int(),
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
