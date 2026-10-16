import { z } from 'zod';
import { membershipRoleSchema } from './membership.js';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'E-mail inválido' }));

export const passwordSchema = z.string().min(8, { error: 'A senha precisa de pelo menos 8 caracteres' });

/** Telefone opcional: só dígitos, com DDD (10 ou 11); aceita máscara na entrada. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ''))
  .pipe(z.string().regex(/^\d{10,11}$/, { error: 'Telefone inválido: use DDD e número' }));

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const signupRequestSchema = z.object({
  name: z.string().trim().min(1, { error: 'Informe seu nome' }),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional(),
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

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

/** Exclusão da própria conta: pede a senha para confirmar. */
export const deleteAccountRequestSchema = z.object({ password: z.string().min(1, { error: 'Informe sua senha' }) });
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

/** Pedido de recuperação de senha: a resposta é a mesma exista ou não a conta (não revela o e-mail). */
export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
