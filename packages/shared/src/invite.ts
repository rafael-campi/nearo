import { z } from 'zod';
import { emailSchema, passwordSchema, phoneSchema } from './auth.js';
import { membershipRoleSchema } from './membership.js';

export const invitePreviewSchema = z.object({
  companyName: z.string(),
  email: z.string(),
  role: membershipRoleSchema,
  hasAccount: z.boolean(),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

/** Quem ainda não tem conta informa nome; quem já tem confirma com a senha atual. */
export const acceptInviteRequestSchema = z.object({
  name: z.string().trim().min(1).optional(),
  phone: phoneSchema.optional(),
  password: passwordSchema,
});
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequestSchema>;

export const acceptInviteResponseSchema = z.object({
  token: z.string(),
  companyId: z.uuid(),
});
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>;

/** Admin convida outros admins e prestadores; clientes entram pelo código de acesso. */
export const createInviteRequestSchema = z.object({
  email: emailSchema,
  role: z.enum(['admin', 'provider']),
});
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>;

export const inviteSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: membershipRoleSchema,
  expiresAt: z.iso.datetime(),
});
export type Invite = z.infer<typeof inviteSchema>;
