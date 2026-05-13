import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { client, rpc } from "@/lib/api";

const createFormPayloadSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
});

export const useForms = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const formsQuery = useQuery({
    queryKey: ["forms"],
    queryFn: () => rpc(client.api.forms.$get()),
  });

  const createFormMutation = useMutation({
    mutationFn: (payload: z.infer<typeof createFormPayloadSchema>) => {
      const validated = createFormPayloadSchema.parse(payload);
      return rpc(client.api.forms.$post({ json: validated }));
    },
    onSuccess: async (data) => {
      void queryClient.invalidateQueries({ queryKey: ["forms"] });
      if (data.form) {
        await navigate({ to: "/forms/$id/edit", params: { id: data.form.id } });
      }
    },
  });

  return {
    formsQuery,
    createFormMutation,
  };
};
