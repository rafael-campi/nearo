import { z } from 'zod';
import { notificationTypeSchema } from './notification.js';

export const devicePlatformSchema = z.enum(['android', 'ios']);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

/** O app registra (e atualiza) o token do aparelho para receber push. */
export const registerDeviceTokenSchema = z.object({
  token: z.string().trim().min(10).max(4096),
  platform: devicePlatformSchema,
});
export type RegisterDeviceToken = z.infer<typeof registerDeviceTokenSchema>;

export const removeDeviceTokenSchema = z.object({ token: z.string().trim().min(10).max(4096) });
export type RemoveDeviceToken = z.infer<typeof removeDeviceTokenSchema>;

/** Dados que acompanham o push, para o app abrir a tela certa ao tocar. */
export const pushDataSchema = z.object({
  type: notificationTypeSchema,
  serviceRequestId: z.string().optional(),
  companyId: z.string().optional(),
  /** De que lado do pedido está quem recebe (mensagens de chat), para o app abrir a conversa. */
  role: z.enum(['client', 'provider']).optional(),
});
export type PushData = z.infer<typeof pushDataSchema>;
