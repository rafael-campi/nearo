/** Violação de unicidade do Postgres (23505), direta ou embrulhada pelo Drizzle. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}
