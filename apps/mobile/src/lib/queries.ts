/** Chaves do TanStack Query compartilhadas entre telas. */
export const queryKeys = {
  me: ['me'] as const,
  myRequests: ['my-requests'] as const,
  notifications: ['notifications'] as const,
  openRequests: (companyId: string) => ['open-requests', companyId] as const,
  categoryOptions: (companyId: string) => ['category-options', companyId] as const,
  providerProfile: (companyId: string) => ['provider-profile', companyId] as const,
};
