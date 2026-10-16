import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-error';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Erro de regra (4xx) não melhora tentando de novo.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});
