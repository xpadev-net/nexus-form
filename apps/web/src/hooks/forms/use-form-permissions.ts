import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { z } from "zod";
import { client, rpc } from "@/lib/api";

const invitationCreateSchema = z.object({
  email: z.string().email(),
  role: z.enum(["EDITOR", "VIEWER"]),
  message: z.string().max(1000).optional(),
  expiresAt: z.string().datetime().optional(),
});

const transferOwnerSchema = z.object({
  newOwnerUserId: z.string().min(1),
});

type PermissionsParams = {
  page?: number;
  limit?: number;
};

type InvitationsParams = {
  page?: number;
  limit?: number;
  status?: "PENDING" | "ACCEPTED" | "EXPIRED" | "CANCELLED";
};

const toStringRecord = (
  params: Record<string, string | number | undefined>,
): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      result[key] = String(value);
    }
  }
  return result;
};

export const useFormPermissions = (
  formId: string | null | undefined,
  permissionsParams?: PermissionsParams,
  invitationsParams?: InvitationsParams,
) => {
  const queryClient = useQueryClient();
  const permissionsPage = permissionsParams?.page ?? null;
  const permissionsLimit = permissionsParams?.limit ?? null;
  const invitationsPage = invitationsParams?.page ?? null;
  const invitationsLimit = invitationsParams?.limit ?? null;
  const invitationsStatus = invitationsParams?.status ?? null;

  const permissionsQuery = useQuery({
    queryKey: ["formPermissions", formId, permissionsPage, permissionsLimit],
    enabled: Boolean(formId),
    staleTime: 60_000,
    queryFn: () =>
      rpc(
        client.api.forms[":id"].permissions.$get({
          param: { id: formId as string },
          query: toStringRecord({
            page: permissionsParams?.page,
            limit: permissionsParams?.limit,
          }),
        }),
      ),
  });

  const invitationsQuery = useQuery({
    queryKey: [
      "formInvitations",
      formId,
      invitationsPage,
      invitationsLimit,
      invitationsStatus,
    ],
    enabled: Boolean(formId),
    queryFn: () =>
      rpc(
        client.api.forms[":id"].invitations.$get({
          param: { id: formId as string },
          query: toStringRecord({
            page: invitationsParams?.page,
            limit: invitationsParams?.limit,
            status: invitationsParams?.status,
          }),
        }),
      ),
  });

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["formPermissions", formId] }),
      queryClient.invalidateQueries({ queryKey: ["formInvitations", formId] }),
    ]);
  }, [formId, queryClient]);

  const createInvitationMutation = useMutation({
    mutationFn: async (payload: z.infer<typeof invitationCreateSchema>) => {
      if (!formId) throw new Error("formId is required");
      const validated = invitationCreateSchema.parse(payload);
      return rpc(
        client.api.forms[":id"].invitations.$post({
          param: { id: formId },
          json: validated,
        }),
      );
    },
    onSuccess: invalidate,
  });

  const deleteInvitationMutation = useMutation({
    mutationFn: (invitationId: string) => {
      if (!formId) throw new Error("formId is required");
      return rpc(
        client.api.forms[":id"].invitations[":invitationId"].$delete({
          param: { id: formId, invitationId },
        }),
      );
    },
    onSuccess: invalidate,
  });

  const updatePermissionMutation = useMutation({
    mutationFn: ({
      userId,
      role,
    }: {
      userId: string;
      role: "EDITOR" | "VIEWER";
    }) => {
      if (!formId) throw new Error("formId is required");
      return rpc(
        client.api.forms[":id"].permissions[":userId"].$put({
          param: { id: formId, userId },
          json: { role },
        }),
      );
    },
    onSuccess: invalidate,
  });

  const removePermissionMutation = useMutation({
    mutationFn: (userId: string) => {
      if (!formId) throw new Error("formId is required");
      return rpc(
        client.api.forms[":id"].permissions[":userId"].$delete({
          param: { id: formId, userId },
        }),
      );
    },
    onSuccess: invalidate,
  });

  const transferOwnershipMutation = useMutation({
    mutationFn: (payload: z.infer<typeof transferOwnerSchema>) => {
      if (!formId) throw new Error("formId is required");
      const validated = transferOwnerSchema.parse(payload);
      return rpc(
        client.api.forms[":id"].permissions["transfer-owner"].$post({
          param: { id: formId },
          json: validated,
        }),
      );
    },
    onSuccess: invalidate,
  });

  return {
    permissionsQuery,
    invitationsQuery,
    createInvitationMutation,
    deleteInvitationMutation,
    updatePermissionMutation,
    removePermissionMutation,
    transferOwnershipMutation,
  };
};
