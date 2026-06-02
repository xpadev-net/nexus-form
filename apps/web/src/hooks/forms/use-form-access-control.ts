import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { PasswordProtectionPublicationSnapshot } from "@/components/forms/password-protection-publication";
import { client, rpc } from "@/lib/api";
import {
  formAccessControlStructureQueryKey,
  formDiffQueryKey,
  formLogicStructureQueryKey,
  unpublishedChangesQueryKey,
} from "./form-structure-query-keys";

interface PasswordProtectionState {
  enabled: boolean;
  hasPassword: boolean;
  password_hint?: string;
}

interface PasswordProtectionPublicationState {
  current: PasswordProtectionPublicationSnapshot;
  published: PasswordProtectionPublicationSnapshot | null;
  isSynced: boolean;
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

  const passwordProtectionPublication =
    useMemo((): PasswordProtectionPublicationState => {
      const publication = structureQuery.data?.password_protection_publication;
      const current = {
        enabled: publication?.current.enabled ?? passwordProtection.enabled,
        hasPassword:
          publication?.current.has_password ?? passwordProtection.hasPassword,
        password_hint:
          publication?.current.password_hint ??
          passwordProtection.password_hint,
      };
      const published = publication?.published
        ? {
            enabled: publication.published.enabled,
            hasPassword: publication.published.has_password,
            password_hint: publication.published.password_hint,
          }
        : null;

      return {
        current,
        published,
        isSynced: publication?.is_synced ?? true,
      };
    }, [passwordProtection, structureQuery.data]);

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
        queryClient.invalidateQueries({ queryKey: formDiffQueryKey(formId) }),
        queryClient.invalidateQueries({
          queryKey: unpublishedChangesQueryKey(formId),
        }),
      ]);
    },
  });

  const mutatePasswordProtection = useCallback(
    (
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
    [updatePasswordProtectionMutation.mutate],
  );

  const mutatePasswordProtectionAsync = useCallback(
    (
      ...[params, options]: Parameters<
        typeof updatePasswordProtectionMutation.mutateAsync
      >
    ) =>
      updatePasswordProtectionMutation.mutateAsync(params, {
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
      }),
    [updatePasswordProtectionMutation.mutateAsync],
  );

  const {
    context,
    data,
    error,
    failureCount,
    failureReason,
    isError,
    isIdle,
    isPaused,
    isPending,
    isSuccess,
    reset,
    status,
    submittedAt,
    variables,
  } = updatePasswordProtectionMutation;

  const updatePasswordProtection = useMemo(
    () => ({
      context,
      data,
      error,
      failureCount,
      failureReason,
      isError,
      isIdle,
      isPaused,
      isPending,
      isSuccess,
      mutate: mutatePasswordProtection,
      mutateAsync: mutatePasswordProtectionAsync,
      reset,
      status,
      submittedAt,
      variables,
    }),
    [
      context,
      data,
      error,
      failureCount,
      failureReason,
      isError,
      isIdle,
      isPaused,
      isPending,
      isSuccess,
      mutatePasswordProtection,
      mutatePasswordProtectionAsync,
      reset,
      status,
      submittedAt,
      variables,
    ],
  );

  return {
    passwordProtection,
    passwordProtectionPublication,
    isLoading: structureQuery.isLoading,
    updatePasswordProtection,
    isUpdating: updatePasswordProtectionMutation.isPending,
  };
};
