import { z } from 'zod';
import { categorySchema } from './category.js';

export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type Coordinates = z.infer<typeof coordinatesSchema>;

export const DEFAULT_SERVICE_RADIUS_KM = 20;
export const serviceRadiusKmSchema = z
  .number()
  .min(1, { error: 'O raio mínimo é 1 km' })
  .max(100, { error: 'O raio máximo é 100 km' });

/** Endereço-base, área de atendimento e disponibilidade do prestador numa empresa. */
export const providerSettingsSchema = z.object({
  baseLocation: coordinatesSchema.nullable(),
  serviceRadiusKm: z.number(),
  available: z.boolean(),
});
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;

/** Prestador visto pelo admin: vínculo `provider`, categorias e atuação. */
export const providerSchema = z
  .object({
    membershipId: z.uuid(),
    name: z.string(),
    email: z.string(),
    active: z.boolean(),
    categoryIds: z.array(z.uuid()),
  })
  .extend(providerSettingsSchema.shape);
export type Provider = z.infer<typeof providerSchema>;

export const updateProviderRequestSchema = z.object({ active: z.boolean() });
export type UpdateProviderRequest = z.infer<typeof updateProviderRequestSchema>;

export const setProviderCategoriesRequestSchema = z.object({
  categoryIds: z.array(z.uuid()).max(100),
});
export type SetProviderCategoriesRequest = z.infer<typeof setProviderCategoriesRequestSchema>;

/** O que o próprio prestador vê da sua atuação numa empresa. */
export const providerProfileSchema = providerSettingsSchema.extend({
  categories: z.array(categorySchema.pick({ id: true, name: true })),
});

export const updateProviderSettingsRequestSchema = z
  .object({
    baseLocation: coordinatesSchema.optional(),
    serviceRadiusKm: serviceRadiusKmSchema.optional(),
    available: z.boolean().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { error: 'Nada para alterar' });
export type UpdateProviderSettingsRequest = z.infer<typeof updateProviderSettingsRequestSchema>;
export type ProviderProfile = z.infer<typeof providerProfileSchema>;
