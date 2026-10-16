import { z } from 'zod';
import { notificationSchema } from './notification.js';
import { serviceRequestStatusSchema } from './service-request.js';

/**
 * Eventos de socket (ADR 0005). Um socket por app aberto, autenticado com o token da sessão
 * (`auth: { token }`). Salas: `user:{id}` (entrada automática) e `service_request:{id}` (por inscrição).
 */
export const socketEvents = {
  /** Servidor → app: atualização nova para o usuário. */
  notification: 'notification',
  /** Servidor → app: o status de um pedido mudou. */
  serviceRequestUpdated: 'service_request:updated',
  /** Servidor → prestador: a lista de pedidos abertos de uma empresa mudou. */
  openRequestsChanged: 'open_requests:changed',
  /** Servidor → participantes (e quem acompanha o pedido): mensagem nova no chat. */
  messageNew: 'message:new',
  /** Servidor → cliente: nova posição do prestador a caminho. */
  serviceRequestLocation: 'service_request:location',
  /** App → servidor: acompanhar um pedido (entra na sala dele, se tiver acesso). */
  subscribeServiceRequest: 'service_request:subscribe',
} as const;

export const userRoom = (userId: string) => `user:${userId}`;
/** Sala dos sockets abertos com uma sessão (identificada pelo hash do token), para derrubá-los ao revogar. */
export const sessionRoom = (tokenHash: string) => `session:${tokenHash}`;
export const serviceRequestRoom = (serviceRequestId: string) => `service_request:${serviceRequestId}`;

export const notificationEventSchema = notificationSchema;

export const serviceRequestUpdatedEventSchema = z.object({
  id: z.uuid(),
  companyId: z.uuid(),
  status: serviceRequestStatusSchema,
});
export type ServiceRequestUpdatedEvent = z.infer<typeof serviceRequestUpdatedEventSchema>;

export const openRequestsChangedEventSchema = z.object({ companyId: z.uuid() });
export type OpenRequestsChangedEvent = z.infer<typeof openRequestsChangedEventSchema>;

export const subscribeServiceRequestSchema = z.object({ serviceRequestId: z.uuid() });
export type SubscribeServiceRequest = z.infer<typeof subscribeServiceRequestSchema>;

export const providerLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** Quando a API recebeu a posição. */
  at: z.iso.datetime(),
});
export type ProviderLocation = z.infer<typeof providerLocationSchema>;

export const serviceRequestLocationEventSchema = providerLocationSchema.extend({ id: z.uuid() });
export type ServiceRequestLocationEvent = z.infer<typeof serviceRequestLocationEventSchema>;
