import { QueryClient } from '@tanstack/react-query'

/**
 * Shared React Query client. Introduced in M4 to give instrument-scoped caching
 * (queryKey: [resource, instrumentId, …]) and a path to WS-driven invalidation,
 * replacing the cache-less useFetch. Existing pages can migrate incrementally.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // aligns with the 30s poll cadence the app already uses
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})
