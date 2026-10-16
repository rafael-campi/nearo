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
  /** Para o admin: um pedido precisa ser atribuído (modo manual) ou voltou para aberto. */
  'request_needs_assignment',
  /** Para o prestador: o admin atribuiu um pedido a ele. */
  'request_assigned',
  /** Para o admin: 15 minutos sem prestador aceitar (broadcast). */
  'request_unclaimed',
  /** Para o cliente: lembrete de que um prestador aguarda a confirmação. */
  'request_reminder',
  /** Para o cliente e o prestador: o cliente não respondeu a tempo e o pedido voltou para aberto. */
  'request_expired',
  /** Para o cliente: o prestador avançou o atendimento (a caminho, chegou, em execução, concluído). */
  'request_status',
  /** Para o cliente: o prestador entrou no raio de aviso (500 m). Uma vez por pedido. */
  'provider_nearby',
  /** Para quem estava envolvido: o pedido foi cancelado. */
  'request_cancelled',
  /** Para o cliente: o prestador desistiu (ou foi desativado) e o pedido voltou para aberto. */
  'request_withdrawn',
  /** Para o outro lado da conversa: mensagem nova (uma atualização por conversa até ser lida). */
  'new_message',
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
