import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getEditorTabFromSearch,
  isEditorTab,
} from "@/components/forms/form-editor-tabs";
import { useFormContentAutosave } from "@/hooks/forms/use-form-content-autosave";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  client,
  getShareTokenAuthorizationHeader,
  RpcError,
  rpc,
} from "@/lib/api";
import { logWarn } from "@/lib/logger";
import { shouldRetryQuery } from "@/lib/query-retry";
import { FormStatus } from "@/types/validation/shared";

type FormsQueryCache = {
  forms: Array<{ id: string; status: FormStatus }>;
};

const updateFormsCacheStatus = (
  current: FormsQueryCache | undefined,
  formId: string,
  status: FormStatus,
): FormsQueryCache | undefined => {
  if (!current?.forms) return current;

  return {
    ...current,
    forms: current.forms.map((form) =>
      form.id === formId ? { ...form, status } : form,
    ),
  };
};

class DuplicateTitleSaveError extends Error {
  constructor() {
    super("Duplicate title save failed");
    this.name = "DuplicateTitleSaveError";
  }
}

export function useFormEditorPageModel(formId: string) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { shareToken, tab } = useSearch({
    from: "/_authenticated/forms/$id/edit",
  });

  const activeTab = getEditorTabFromSearch(tab);
  const [responsesEverActive, setResponsesEverActive] = useState(
    activeTab === "responses",
  );
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleSavePromiseRef = useRef<Promise<unknown> | null>(null);
  const titleSaveValueRef = useRef<string | null>(null);
  const formDetailQueryKey = useMemo(
    () => ["formDetail", formId, shareToken ?? null] as const,
    [formId, shareToken],
  );
  const contentQueryKey = useMemo(
    () => ["formContent", formId, shareToken ?? null] as const,
    [formId, shareToken],
  );
  const shareTokenRequestOptionsArgs = useMemo(
    () =>
      shareToken
        ? ([{ headers: getShareTokenAuthorizationHeader(shareToken) }] as const)
        : ([] as const),
    [shareToken],
  );

  const formQuery = useQuery({
    queryKey: formDetailQueryKey,
    queryFn: () =>
      rpc(
        client.api.forms[":id"].$get(
          { param: { id: formId } },
          ...shareTokenRequestOptionsArgs,
        ),
      ),
    retry: shouldRetryQuery,
  });
  const isNotFound =
    formQuery.error instanceof RpcError && formQuery.error.status === 404;

  usePageTitle(
    isNotFound
      ? "フォームが見つかりません"
      : (formQuery.data?.form?.title ?? "フォームを編集"),
  );

  const contentQuery = useQuery({
    enabled: !formQuery.isError,
    queryKey: contentQueryKey,
    queryFn: () =>
      rpc(
        client.api.forms[":id"].content.$get(
          { param: { id: formId } },
          ...shareTokenRequestOptionsArgs,
        ),
      ),
    retry: shouldRetryQuery,
  });

  const myPermissionQuery = useQuery({
    enabled: !formQuery.isError,
    queryKey: ["formPermissionMe", formId, shareToken ?? null] as const,
    queryFn: () =>
      rpc(
        client.api.forms[":id"].permissions.me.$get(
          { param: { id: formId } },
          ...shareTokenRequestOptionsArgs,
        ),
      ),
    retry: shouldRetryQuery,
  });
  const canUseEditorRealtimeSync =
    myPermissionQuery.data?.role === "OWNER" ||
    myPermissionQuery.data?.role === "EDITOR";
  const canEditForm = canUseEditorRealtimeSync;

  const {
    isSaving,
    draftContent,
    isMerging,
    conflictState,
    conflictResolutions,
    setConflictResolutions,
    resolveConflicts,
    dismissConflict,
    handleContentChange,
    snapshotEditorToDraft,
    hasUnsavedLocalEdits,
  } = useFormContentAutosave({
    formId,
    contentData: contentQuery.data,
    contentQueryKey,
    contentRefetch: contentQuery.refetch,
    getActiveTab: () => activeTab,
    enabled: canEditForm,
    enableRealtimeSync: canUseEditorRealtimeSync,
  });

  const previousActiveTabRef = useRef(activeTab);
  const snapshotEditorToDraftRef = useRef(snapshotEditorToDraft);
  snapshotEditorToDraftRef.current = snapshotEditorToDraft;

  const updateTitleMutation = useMutation({
    mutationFn: (title: string) =>
      rpc(
        client.api.forms[":id"].$put(
          {
            param: { id: formId },
            json: { title },
          },
          ...shareTokenRequestOptionsArgs,
        ),
      ),
    onSuccess: (data) => {
      if (data?.form) {
        queryClient.setQueryData(formDetailQueryKey, { form: data.form });
      } else {
        void queryClient.invalidateQueries({
          queryKey: formDetailQueryKey,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["forms"] });
    },
    onError: () => {
      toast.error("フォーム名の保存に失敗しました");
    },
  });

  const saveTitle = async (title: string) => {
    const promise = updateTitleMutation.mutateAsync(title);
    titleSavePromiseRef.current = promise;
    titleSaveValueRef.current = title;
    try {
      await promise;
    } finally {
      if (titleSavePromiseRef.current === promise) {
        titleSavePromiseRef.current = null;
        titleSaveValueRef.current = null;
      }
    }
  };

  const saveTitleBeforeDuplicate = async () => {
    try {
      const pendingTitleSave = titleSavePromiseRef.current;
      const pendingTitle = titleSaveValueRef.current?.trim() ?? "";
      if (pendingTitleSave) {
        await pendingTitleSave;
      }

      const savedTitle =
        pendingTitle || formQuery.data?.form?.title?.trim() || "";
      const draftTitle = titleDraft.trim();
      if (!draftTitle || draftTitle === savedTitle) return;

      await saveTitle(draftTitle);
    } catch {
      throw new DuplicateTitleSaveError();
    }
  };

  const deleteMutation = useMutation({
    mutationFn: () =>
      rpc(
        client.api.forms[":id"].$delete(
          { param: { id: formId } },
          ...shareTokenRequestOptionsArgs,
        ),
      ),
    onSuccess: () => {
      toast.success("フォームを削除しました");
      void queryClient.invalidateQueries({ queryKey: ["forms"] });
      void router.navigate({ to: "/" });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "削除に失敗しました");
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      await saveTitleBeforeDuplicate();
      return rpc(
        client.api.forms[":id"].duplicate.$post(
          { param: { id: formId } },
          ...shareTokenRequestOptionsArgs,
        ),
      );
    },
    onSuccess: (data) => {
      setShowDuplicateModal(false);
      toast.success(
        data?.form?.title
          ? `${data.form.title} を作成しました`
          : "フォームを複製しました",
      );
      void queryClient.invalidateQueries({ queryKey: ["forms"] });
      if (data?.form?.id) {
        void router.navigate({
          to: "/forms/$id/edit",
          params: { id: data.form.id },
        });
      }
    },
    onError: (err) => {
      if (err instanceof DuplicateTitleSaveError) return;
      toast.error(err instanceof Error ? err.message : "複製に失敗しました");
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () =>
      rpc(
        client.api.forms[":id"].archive.$post(
          { param: { id: formId } },
          ...shareTokenRequestOptionsArgs,
        ),
      ),
    onSuccess: () => {
      toast.success("フォームをアーカイブしました");
      queryClient.setQueryData<typeof formQuery.data>(
        formDetailQueryKey,
        (current) => {
          if (!current?.form) return current;
          return {
            ...current,
            form: { ...current.form, status: "ARCHIVED" },
          };
        },
      );
      queryClient.setQueryData<FormsQueryCache>(["forms"], (current) =>
        updateFormsCacheStatus(current, formId, "ARCHIVED"),
      );
      void queryClient.invalidateQueries({ queryKey: formDetailQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["forms"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "アーカイブに失敗しました",
      );
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: () =>
      rpc(
        client.api.forms[":id"].unarchive.$post(
          { param: { id: formId } },
          ...shareTokenRequestOptionsArgs,
        ),
      ),
    onSuccess: () => {
      toast.success("アーカイブを解除しました");
      queryClient.setQueryData<typeof formQuery.data>(
        formDetailQueryKey,
        (current) => {
          if (!current?.form) return current;
          return {
            ...current,
            form: { ...current.form, status: "DRAFT" },
          };
        },
      );
      queryClient.setQueryData<FormsQueryCache>(["forms"], (current) =>
        updateFormsCacheStatus(current, formId, "DRAFT"),
      );
      void queryClient.invalidateQueries({ queryKey: formDetailQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["forms"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "アーカイブ解除に失敗しました",
      );
    },
  });

  const formData = formQuery.data?.form;
  const formIdForStatus = formData?.id;
  const rawFormStatus = formData?.status;
  const formStatusResult = FormStatus.safeParse(rawFormStatus);
  const formStatus = formStatusResult.success ? formStatusResult.data : "DRAFT";

  useEffect(() => {
    if (tab === undefined || isEditorTab(tab)) return;
    void router.navigate({
      to: "/forms/$id/edit",
      params: { id: formId },
      search: { ...(shareToken ? { shareToken } : {}), tab: "editor" },
      replace: true,
    });
  }, [formId, router, shareToken, tab]);

  useEffect(() => {
    if (canEditForm || activeTab === "editor" || myPermissionQuery.isLoading) {
      return;
    }
    void router.navigate({
      to: "/forms/$id/edit",
      params: { id: formId },
      search: { ...(shareToken ? { shareToken } : {}), tab: "editor" },
      replace: true,
    });
  }, [
    activeTab,
    canEditForm,
    formId,
    myPermissionQuery.isLoading,
    router,
    shareToken,
  ]);

  useEffect(() => {
    if (activeTab === "responses") {
      setResponsesEverActive(true);
    }
  }, [activeTab]);

  useEffect(() => {
    const previousActiveTab = previousActiveTabRef.current;
    if (previousActiveTab === "editor" && activeTab !== "editor") {
      snapshotEditorToDraftRef.current();
    }
    previousActiveTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (!formIdForStatus || FormStatus.safeParse(rawFormStatus).success) {
      return;
    }
    logWarn("Unrecognized form status received in editor", "forms", {
      formId: formIdForStatus,
      status: rawFormStatus,
    });
  }, [formIdForStatus, rawFormStatus]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedLocalEdits()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedLocalEdits]);

  const handleTabChange = (value: string) => {
    if (!isEditorTab(value) || value === activeTab) return;
    if (
      !canEditForm &&
      (value === "settings" ||
        value === "validation" ||
        value === "sharing" ||
        value === "responses")
    ) {
      toast.info("閲覧権限ではこの設定を変更できません");
      return;
    }
    void router.navigate({
      to: "/forms/$id/edit",
      params: { id: formId },
      search: { ...(shareToken ? { shareToken } : {}), tab: value },
    });
  };

  const handlePublishStatusChange = () => {
    void queryClient.invalidateQueries({ queryKey: formDetailQueryKey });
    void queryClient.invalidateQueries({ queryKey: ["forms"] });
  };

  const refetchContent = () => {
    void contentQuery.refetch();
  };

  return {
    activeTab,
    archiveForm: () => archiveMutation.mutate(),
    canEditForm,
    conflictResolutions,
    conflictState,
    deleteForm: () => deleteMutation.mutate(),
    dismissConflict,
    draftContent,
    duplicateForm: () => duplicateMutation.mutate(),
    formData,
    formStatus,
    handleContentChange,
    handlePublishStatusChange,
    handleTabChange,
    isArchivePending: archiveMutation.isPending || unarchiveMutation.isPending,
    isContentError: contentQuery.isError,
    isContentLoading: contentQuery.isLoading,
    isDeletePending: deleteMutation.isPending,
    isDuplicatePending: duplicateMutation.isPending,
    isFormError: formQuery.isError,
    isFormLoading: formQuery.isLoading,
    isMerging,
    isNotFound,
    isSaving,
    isTitlePending: updateTitleMutation.isPending,
    plateContent: contentQuery.data?.plateContent ?? "[]",
    refetchContent,
    resolveConflicts,
    responsesEverActive,
    setConflictResolutions,
    setShowDeleteModal,
    setShowDuplicateModal,
    shareToken,
    showDeleteModal,
    showDuplicateModal,
    titleSaveFailureCount: updateTitleMutation.failureCount,
    titleDraft,
    unarchiveForm: () => unarchiveMutation.mutate(),
    updateTitle: (title: string) => {
      void saveTitle(title).catch(() => {
        // The mutation onError already reports the failure for blur-triggered saves.
      });
    },
    updateTitleDraft: setTitleDraft,
  };
}
