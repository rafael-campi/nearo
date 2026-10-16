import { z } from 'zod';

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
