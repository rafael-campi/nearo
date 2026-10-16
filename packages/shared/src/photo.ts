import { z } from 'zod';

/** O app redimensiona antes de enviar (CLAUDE.md): no máximo 1000 px no lado maior, JPEG ~80%. */
export const PHOTO_MAX_PX = 1000;
export const PHOTO_JPEG_QUALITY = 0.8;
/** Teto do arquivo enviado; um JPEG de 1000 px a ~80% fica bem abaixo disso. */
export const PHOTO_MAX_BYTES = 1_500_000;
export const MAX_REQUEST_PHOTOS = 5;

/** Onde a foto será usada: no pedido (só na criação) ou numa mensagem do chat (uma por mensagem). */
export const photoPurposeSchema = z.enum(['request_photo', 'chat_photo']);
export type PhotoPurpose = z.infer<typeof photoPurposeSchema>;

export const createUploadRequestSchema = z.object({
  purpose: photoPurposeSchema,
  contentLength: z.number().int().min(1).max(PHOTO_MAX_BYTES, { error: 'Foto grande demais' }),
});
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;

/** Autorização de envio direto ao storage: o app faz um PUT em `uploadUrl` e depois usa `key`. */
export const uploadTicketSchema = z.object({
  key: z.string(),
  uploadUrl: z.string(),
  headers: z.record(z.string(), z.string()),
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;
