import { z } from 'zod';

/** Prazo para avaliar depois de concluído; passado isso as avaliações existentes ficam visíveis. */
export const REVIEW_WINDOW_DAYS = 7;

export const createReviewSchema = z.object({
  rating: z.number().int().min(1, { error: 'Dê uma nota de 1 a 5' }).max(5, { error: 'Dê uma nota de 1 a 5' }),
  comment: z.string().trim().max(1000, { error: 'Use no máximo 1000 caracteres' }).default(''),
});
export type CreateReview = z.input<typeof createReviewSchema>;

/**
 * Avaliação de um pedido. Às cegas: cada lado só vê a própria até que os dois avaliem ou o prazo acabe;
 * `visible` indica se já foi revelada para o outro lado.
 */
export const reviewSchema = z.object({
  id: z.uuid(),
  reviewerRole: z.enum(['client', 'provider']),
  /** Nome de quem avaliou; null se a conta foi removida. */
  reviewerName: z.string().nullable(),
  rating: z.number().int(),
  comment: z.string(),
  mine: z.boolean(),
  visible: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Review = z.infer<typeof reviewSchema>;

export const requestReviewsSchema = z.object({
  /** As avaliações que a pessoa pode ver agora (a própria; a do outro lado só depois de revelada). */
  reviews: z.array(reviewSchema),
  /** Pode avaliar agora: pedido concluído, dentro do prazo, e ainda não avaliou. */
  canReview: z.boolean(),
  /** Até quando dá para avaliar; null se o pedido não foi concluído. */
  deadline: z.iso.datetime().nullable(),
});
export type RequestReviews = z.infer<typeof requestReviewsSchema>;

/** Nota: média das avaliações visíveis dentro de uma empresa (nunca atravessa empresas) e quantas são. */
export const ratingSchema = z.object({
  average: z.number().nullable(),
  count: z.number().int(),
});
export type Rating = z.infer<typeof ratingSchema>;

/** Texto da nota para a interface: "★ 4,5 (12 avaliações)" ou "Sem avaliações". */
export function ratingLabel(rating: Rating): string {
  if (rating.average === null || rating.count === 0) return 'Sem avaliações';
  const average = rating.average.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `★ ${average} (${rating.count} ${rating.count === 1 ? 'avaliação' : 'avaliações'})`;
}
