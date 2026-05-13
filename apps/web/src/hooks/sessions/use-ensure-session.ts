import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";

export const useEnsureSession = () => {
  const session = authClient.useSession();

  const ensureQuery = useQuery({
    queryKey: ["ensureSession"],
    enabled: !session.data?.session,
    queryFn: () => authClient.getSession(),
    staleTime: 30_000,
  });

  return {
    session,
    ensureQuery,
  };
};
