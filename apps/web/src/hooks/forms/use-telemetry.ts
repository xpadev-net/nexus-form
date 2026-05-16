import { useQuery } from "@tanstack/react-query";
import { client, rpc } from "@/lib/api";

export const useTelemetryToken = () => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["telemetry-token"],
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
