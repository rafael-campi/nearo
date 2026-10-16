import { z } from 'zod';

const categoryNameSchema = z
  .string()
  .trim()
  .min(1, { error: 'Informe o nome da categoria' })
  .max(60, { error: 'Use no máximo 60 caracteres' });

export const categorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  active: z.boolean(),
});
export type Category = z.infer<typeof categorySchema>;

export const createCategoryRequestSchema = z.object({
  name: categoryNameSchema,
});
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = z
  .object({
    name: categoryNameSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => body.name !== undefined || body.active !== undefined, {
    error: 'Nada para alterar',
  });
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

/** Categoria como opção para quem pede ou atende (só ativas). */
export const categoryOptionSchema = categorySchema.pick({ id: true, name: true });
export type CategoryOption = z.infer<typeof categoryOptionSchema>;
