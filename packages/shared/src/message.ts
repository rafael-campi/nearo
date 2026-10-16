import { z } from 'zod';

export const MESSAGE_MAX_LENGTH = 2000;
export const MESSAGES_PAGE_SIZE = 30;

/**
 * Envio de mensagem. `clientMessageId` é gerado no app: reenviar a mesma mensagem não a duplica.
 * (ADR 0005 o chama de `client_id`; no código fica `clientMessageId`, porque "cliente" é o solicitante.)
 */
export const sendMessageSchema = z.object({
  clientMessageId: z.uuid(),
  body: z
    .string()
    .trim()
    .min(1, { error: 'Escreva a mensagem' })
    .max(MESSAGE_MAX_LENGTH, { error: `Use no máximo ${MESSAGE_MAX_LENGTH} caracteres` }),
});
export type SendMessage = z.infer<typeof sendMessageSchema>;

export const messageSchema = z.object({
  id: z.uuid(),
  serviceRequestId: z.uuid(),
  clientMessageId: z.uuid(),
  senderRole: z.enum(['client', 'provider']),
  senderName: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export type Message = z.infer<typeof messageSchema>;

/** Página de mensagens em ordem cronológica; `nextCursor` leva às mais antigas (null se não há). */
export const messagePageSchema = z.object({
  messages: z.array(messageSchema),
  nextCursor: z.string().nullable(),
});
export type MessagePage = z.infer<typeof messagePageSchema>;

/** Chat aberto de `confirmed` a `in_progress`; só leitura em `completed` e `cancelled`. */
export const chatWritableStatuses = ['confirmed', 'en_route', 'arrived', 'in_progress'] as const;
