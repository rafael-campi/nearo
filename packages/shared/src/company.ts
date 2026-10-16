import { z } from 'zod';

/** Cabeçalho que indica em qual empresa a requisição age. */
export const COMPANY_HEADER = 'x-company-id';

/** Define o que acontece quando um pedido é criado (ou volta para aberto); o admin pode atribuir em qualquer modo. */
export const assignmentModeSchema = z.enum(['manual', 'broadcast']);
export type AssignmentMode = z.infer<typeof assignmentModeSchema>;
export const assignmentModeLabel: Record<AssignmentMode, string> = {
  manual: 'Manual',
  broadcast: 'Broadcast',
};

export const companySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  assignmentMode: assignmentModeSchema,
});
export type Company = z.infer<typeof companySchema>;

/** Código de acesso: o que a empresa divulga para clientes entrarem nela. */
export const joinCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,12}$/, { error: 'Código inválido' });

export const joinCodeResponseSchema = z.object({ joinCode: z.string() });
export type JoinCodeResponse = z.infer<typeof joinCodeResponseSchema>;

export const joinCompanyRequestSchema = z.object({ code: joinCodeSchema });
export type JoinCompanyRequest = z.infer<typeof joinCompanyRequestSchema>;

export const joinCompanyResponseSchema = z.object({ companyId: z.uuid(), companyName: z.string() });
export type JoinCompanyResponse = z.infer<typeof joinCompanyResponseSchema>;

export const clientSchema = z.object({
  membershipId: z.uuid(),
  name: z.string(),
  email: z.string(),
  active: z.boolean(),
  joinedAt: z.iso.datetime(),
});
export type Client = z.infer<typeof clientSchema>;

export const updateClientRequestSchema = z.object({ active: z.boolean() });
export type UpdateClientRequest = z.infer<typeof updateClientRequestSchema>;

export const updateCompanySettingsRequestSchema = z.object({ assignmentMode: assignmentModeSchema });
export type UpdateCompanySettingsRequest = z.infer<typeof updateCompanySettingsRequestSchema>;
