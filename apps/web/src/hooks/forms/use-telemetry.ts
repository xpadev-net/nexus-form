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
    // token per session). staleTime: Infinity prevents automatic re-fetches;
    // callers using refetch() will re-POST by design.
    queryFn: () => rpc(client.api.telemetry.v4.$post()),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  return {
    token: data?.token ?? null,
    isLoading,
    error,
    refetch,
  };
};
