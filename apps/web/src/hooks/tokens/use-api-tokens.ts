import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { client, rpc } from "@/lib/api";

const apiTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  form_ids: z.array(z.string()).optional(),
  expires_at: z.string().optional(),
  last_used_at: z.string().optional(),
  created_at: z.string(),
  is_active: z.boolean(),
});

const createTokenPayloadSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(["read", "write", "admin"])).min(1),
  form_ids: z.array(z.string()).optional(),
  expires_at: z.string().datetime().optional(),
});

export type ApiToken = z.infer<typeof apiTokenSchema>;
export type CreateApiTokenPayload = z.infer<typeof createTokenPayloadSchema>;

export const useApiTokens = () => {
  const queryClient = useQueryClient();

  const tokensQuery = useQuery({
    queryKey: ["apiTokens"],
    queryFn: () => rpc(client.api.tokens.$get({ query: {} })),
    staleTime: 5 * 60 * 1000,
  });

  const createTokenMutation = useMutation({
    mutationFn: (payload: CreateApiTokenPayload) => {
      const validated = createTokenPayloadSchema.parse(payload);
      return rpc(client.api.tokens.$post({ json: validated }));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["apiTokens"] });
    },
  });

  const revokeTokenMutation = useMutation({
    mutationFn: (id: string) =>
      rpc(client.api.tokens[":id"].revoke.$post({ param: { id } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["apiTokens"] });
    },
  });

  return {
    tokensQuery,
    createTokenMutation,
    revokeTokenMutation,
  };
};
