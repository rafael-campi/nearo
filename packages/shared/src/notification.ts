import { z } from 'zod';

export const notificationTypeSchema = z.enum([
  /** Para prestadores aptos: um pedido novo que eles podem aceitar. */
  'new_request',
  /** Para o cliente: um prestador aceitou o pedido. */
  'request_accepted',
  /** Para o prestador: o cliente confirmou; endereço e telefone liberados. */
  'request_confirmed',
  /** Para o prestador: o cliente recusou (ou não deu para confirmar); o pedido voltou a ficar aberto. */
  'request_declined',
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/** Atualização gravada para um usuário (glossário: Atualização). */
export const notificationSchema = z.object({
  id: z.uuid(),
  companyId: z.uuid(),
  companyName: z.string(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  serviceRequestId: z.uuid().nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Notification = z.infer<typeof notificationSchema>;
