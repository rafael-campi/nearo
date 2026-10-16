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
  /** App → servidor: acompanhar um pedido (entra na sala dele, se tiver acesso). */
  subscribeServiceRequest: 'service_request:subscribe',
} as const;

export const userRoom = (userId: string) => `user:${userId}`;
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
