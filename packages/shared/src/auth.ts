import { z } from 'zod';
import { membershipRoleSchema } from './membership.js';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'E-mail inválido' }));

export const passwordSchema = z.string().min(8, { error: 'A senha precisa de pelo menos 8 caracteres' });

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionResponseSchema = z.object({
  token: z.string(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const meResponseSchema = z.object({
  user: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  memberships: z.array(
    z.object({ companyId: z.uuid(), companyName: z.string(), role: membershipRoleSchema }),
  ),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
