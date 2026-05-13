import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { client, rpc } from "@/lib/api";

export const useTelemetryToken = () => {
  const mutation = useMutation({
    mutationFn: () => rpc(client.api.telemetry.v4.$post()),
  });

  useEffect(() => {
    mutation.mutate();
  }, [mutation.mutate]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    token: mutation.data?.token ?? null,
    isLoading: mutation.isPending,
    error: mutation.error,
    refetch: () => mutation.mutate(),
  };
};
