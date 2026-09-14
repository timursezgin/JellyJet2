import { QueryClient } from '@tanstack/react-query';

/** The one cache for everything read from Jellyfin. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Library data changes rarely; refresh in the background, never block.
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});
