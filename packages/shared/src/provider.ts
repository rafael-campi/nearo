import { z } from 'zod';
import { categorySchema } from './category.js';

/** Prestador visto pelo admin: vínculo `provider` e as categorias que atende. */
export const providerSchema = z.object({
  membershipId: z.uuid(),
  name: z.string(),
  email: z.string(),
  active: z.boolean(),
  categoryIds: z.array(z.uuid()),
});
export type Provider = z.infer<typeof providerSchema>;

export const updateProviderRequestSchema = z.object({ active: z.boolean() });
export type UpdateProviderRequest = z.infer<typeof updateProviderRequestSchema>;

export const setProviderCategoriesRequestSchema = z.object({
  categoryIds: z.array(z.uuid()).max(100),
});
export type SetProviderCategoriesRequest = z.infer<typeof setProviderCategoriesRequestSchema>;

/** O que o próprio prestador vê da sua atuação numa empresa. */
export const providerProfileSchema = z.object({
  categories: z.array(categorySchema.pick({ id: true, name: true })),
});
export type ProviderProfile = z.infer<typeof providerProfileSchema>;
