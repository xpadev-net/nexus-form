import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import { client, rpc } from "@/lib/api";
import {
  formAccessControlStructureQueryKey,
  formLogicStructureQueryKey,
} from "./form-structure-query-keys";

interface PasswordProtectionState {
  enabled: boolean;
  hasPassword: boolean;
  password_hint?: string;
}

interface UpdatePasswordProtectionParams {
  enabled: boolean;
  password?: string;
  password_hint?: string;
}

export const useFormAccessControl = (formId: string) => {
  const queryClient = useQueryClient();

  const structureQuery = useQuery({
    queryKey: formAccessControlStructureQueryKey(formId),
    queryFn: () =>
      rpc(client.api.forms[":id"].structure.$get({ param: { id: formId } })),
    enabled: !!formId,
  });

  const passwordProtection = useMemo((): PasswordProtectionState => {
    const ac = structureQuery.data?.structure?.access_control;
    const pp = ac?.password_protection;
    if (!pp) {
      return { enabled: false, hasPassword: false };
    }
    return {
      enabled: pp.enabled ?? false,
      // GET レスポンスではハッシュがマスクされ has_password フラグで代替される
      hasPassword: pp.has_password ?? false,
      password_hint: pp.password_hint,
    };
  }, [structureQuery.data]);

  const updatePasswordProtectionMutation = useMutation({
    mutationFn: (params: UpdatePasswordProtectionParams) =>
      rpc(
        client.api.forms[":id"].structure["access-control"].$patch({
          param: { id: formId },
          json: {
            password_protection: {
              enabled: params.enabled,
              password: params.password,
              password_hint: params.password_hint,
            },
          },
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: formAccessControlStructureQueryKey(formId),
        }),
        queryClient.invalidateQueries({
          queryKey: formLogicStructureQueryKey(formId),
        }),
        queryClient.invalidateQueries({ queryKey: ["formDiff", formId] }),
        queryClient.invalidateQueries({
          queryKey: ["unpublishedChanges", formId],
        }),
      ]);
    },
  });

  const updatePasswordProtection = {
    ...updatePasswordProtectionMutation,
    mutate: (
      ...[params, options]: Parameters<
        typeof updatePasswordProtectionMutation.mutate
      >
    ) => {
      updatePasswordProtectionMutation.mutate(params, {
        ...options,
        onError: (error, variables, onMutateResult, context) => {
          if (options?.onError) {
            options.onError(error, variables, onMutateResult, context);
            return;
          }

          toast.error(
            error instanceof Error
              ? error.message
              : "パスワード保護の変更に失敗しました",
          );
        },
      });
    },
  };

  return {
    passwordProtection,
    isLoading: structureQuery.isLoading,
    updatePasswordProtection,
    isUpdating: updatePasswordProtectionMutation.isPending,
  };
};
