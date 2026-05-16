import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { client, rpc } from "@/lib/api";

interface TelemetryTokenResult {
  token: string | null;
  isLoading: boolean;
  error: UseQueryResult["error"];
  refetch: UseQueryResult["refetch"];
}

export const useTelemetryToken = (): TelemetryTokenResult => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["telemetry-token"],
    // Intentionally wraps a POST: the endpoint is idempotent (returns the same
    // token per session). staleTime and gcTime: Infinity prevent automatic
    // re-fetches and garbage collection. Do NOT call invalidateQueries on this
    // key — explicit invalidation would silently re-POST.
    queryFn: () => rpc(client.api.telemetry.v4.$post()),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });

  return {
    token: data?.token ?? null,
    isLoading,
    error,
    refetch,
  };
};
