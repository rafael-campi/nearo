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
