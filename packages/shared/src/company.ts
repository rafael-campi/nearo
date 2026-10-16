import { z } from 'zod';

/** Cabeçalho que indica em qual empresa a requisição age. */
export const COMPANY_HEADER = 'x-company-id';

export const companySchema = z.object({
  id: z.uuid(),
  name: z.string(),
});
export type Company = z.infer<typeof companySchema>;
