import { useQuery } from "@tanstack/react-query";
import { client, rpc } from "@/lib/api";

export const useCsrfToken = () => {
  const csrfQuery = useQuery({
    queryKey: ["csrfToken"],
    queryFn: () => rpc(client.api.csrf.$get()),
    staleTime: 5 * 60 * 1000,
  });

  return {
    csrfQuery,
    token: csrfQuery.data?.token ?? null,
    isLoading: csrfQuery.isLoading,
    error: csrfQuery.error,
    refetch: csrfQuery.refetch,
  };
};
