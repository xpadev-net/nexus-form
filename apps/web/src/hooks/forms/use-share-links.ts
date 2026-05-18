import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { client, rpc } from "@/lib/api";

const createShareLinkSchema = z.object({
  role: z.enum(["EDITOR", "VIEWER"]),
  expiresAt: z.string().datetime().optional(),
});

const updateShareLinkSchema = z.object({
  isActive: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
});

const querySchema = z.object({
  page: z.number().optional(),
  limit: z.number().optional(),
  isActive: z.boolean().optional(),
});

const toQueryStrings = (params: z.infer<typeof querySchema>) => {
  const result: Record<string, string> = {};
  if (params.page !== undefined) result.page = String(params.page);
  if (params.limit !== undefined) result.limit = String(params.limit);
  if (params.isActive !== undefined) result.isActive = String(params.isActive);
  return result;
};

export const useShareLinks = (
  formId: string | null | undefined,
  params: z.infer<typeof querySchema> = {},
) => {
  const queryClient = useQueryClient();
  const parsedParams = querySchema.parse(params);
  const page = parsedParams.page ?? null;
  const limit = parsedParams.limit ?? null;
  const isActive = parsedParams.isActive ?? null;

  const shareLinksQuery = useQuery({
    queryKey: ["shareLinks", formId, page, limit, isActive],
    enabled: Boolean(formId),
    staleTime: 60_000,
    queryFn: () =>
      rpc(
        client.api.forms[":id"]["share-links"].$get({
          param: { id: formId as string },
          query: toQueryStrings(parsedParams),
        }),
      ),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["shareLinks", formId] });
  };

  const createShareLinkMutation = useMutation({
    mutationFn: (payload: z.infer<typeof createShareLinkSchema>) => {
      if (!formId) throw new Error("formId is required");
      return rpc(
        client.api.forms[":id"]["share-links"].$post({
          param: { id: formId },
          json: createShareLinkSchema.parse(payload),
        }),
      );
    },
    onSuccess: invalidate,
  });

  const updateShareLinkMutation = useMutation({
    mutationFn: ({
      linkId,
      payload,
    }: {
      linkId: string;
      payload: z.infer<typeof updateShareLinkSchema>;
    }) => {
      if (!formId) throw new Error("formId is required");
      return rpc(
        client.api.forms[":id"]["share-links"][":linkId"].$put({
          param: { id: formId, linkId },
          json: updateShareLinkSchema.parse(payload),
        }),
      );
    },
    onSuccess: invalidate,
  });

  const deleteShareLinkMutation = useMutation({
    mutationFn: (linkId: string) => {
      if (!formId) throw new Error("formId is required");
      return rpc(
        client.api.forms[":id"]["share-links"][":linkId"].$delete({
          param: { id: formId, linkId },
        }),
      );
    },
    onSuccess: invalidate,
  });

  const toggleShareLinkStatusMutation = useMutation({
    mutationFn: ({
      linkId,
      isActive,
    }: {
      linkId: string;
      isActive: boolean;
    }) => {
      if (!formId) throw new Error("formId is required");
      const validated = updateShareLinkSchema.parse({ isActive });
      return rpc(
        client.api.forms[":id"]["share-links"][":linkId"].$put({
          param: { id: formId, linkId },
          json: validated,
        }),
      );
    },
    onSuccess: invalidate,
  });

  const copyShareLinkUrl = async (token: string) => {
    const url = `${window.location.origin}/forms/shared/${token}`;
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      return true;
    }

    const textArea = document.createElement("textarea");
    textArea.value = url;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textArea);
    return copied;
  };

  return {
    shareLinksQuery,
    createShareLinkMutation,
    updateShareLinkMutation,
    deleteShareLinkMutation,
    toggleShareLinkStatusMutation,
    copyShareLinkUrl,
  };
};
