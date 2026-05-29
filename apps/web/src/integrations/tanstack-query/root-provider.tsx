import { QueryClient } from "@tanstack/react-query";
import { shouldRetryQuery } from "@/lib/query-retry";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: shouldRetryQuery,
    },
  },
});
