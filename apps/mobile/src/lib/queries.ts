/** Chaves do TanStack Query compartilhadas entre telas. */
export const queryKeys = {
  me: ['me'] as const,
  providerProfile: (companyId: string) => ['provider-profile', companyId] as const,
};
