import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getEditorTabFromSearch,
  isEditorTab,
} from "@/components/forms/form-editor-tabs";
import { useFormContentAutosave } from "@/hooks/forms/use-form-content-autosave";
import { usePageTitle } from "@/hooks/use-page-title";
import { client, rpc } from "@/lib/api";
import { logWarn } from "@/lib/logger";
import { FormStatus } from "@/types/validation/shared";

export function useFormEditorPageModel(formId: string) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tab } = useSearch({ from: "/_authenticated/forms/$id/edit" });

  const activeTab = getEditorTabFromSearch(tab);
  const [responsesEverActive, setResponsesEverActive] = useState(
    activeTab === "responses",
  );
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);

  const formQuery = useQuery({
    queryKey: ["formDetail", formId],
    queryFn: () => rpc(client.api.forms[":id"].$get({ param: { id: formId } })),
  });

  usePageTitle(formQuery.data?.form?.title ?? "フォームを編集");

  const contentQuery = useQuery({
    queryKey: ["formContent", formId],
    queryFn: () =>
      rpc(client.api.forms[":id"].content.$get({ param: { id: formId } })),
  });

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
    contentRefetch: contentQuery.refetch,
    getActiveTab: () => activeTab,
  });

  const previousActiveTabRef = useRef(activeTab);
  const snapshotEditorToDraftRef = useRef(snapshotEditorToDraft);
  snapshotEditorToDraftRef.current = snapshotEditorToDraft;

  const updateTitleMutation = useMutation({
    mutationFn: (title: string) =>
      rpc(
        client.api.forms[":id"].$put({
          param: { id: formId },
          json: { title },
        }),
      ),
    onSuccess: (data) => {
      if (data?.form) {
        queryClient.setQueryData(["formDetail", formId], { form: data.form });
      } else {
        void queryClient.invalidateQueries({
          queryKey: ["formDetail", formId],
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["forms"] });
    },
    onError: () => {
      toast.error("フォーム名の保存に失敗しました");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      rpc(client.api.forms[":id"].$delete({ param: { id: formId } })),
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
    mutationFn: () =>
      rpc(client.api.forms[":id"].duplicate.$post({ param: { id: formId } })),
    onSuccess: (data) => {
      toast.success("フォームを複製しました");
      void queryClient.invalidateQueries({ queryKey: ["forms"] });
      if (data?.form?.id) {
        void router.navigate({
          to: "/forms/$id/edit",
          params: { id: data.form.id },
        });
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "複製に失敗しました");
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () =>
      rpc(client.api.forms[":id"].archive.$post({ param: { id: formId } })),
    onSuccess: () => {
      toast.success("フォームをアーカイブしました");
      void queryClient.invalidateQueries({ queryKey: ["formDetail", formId] });
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
      rpc(client.api.forms[":id"].unarchive.$post({ param: { id: formId } })),
    onSuccess: () => {
      toast.success("アーカイブを解除しました");
      void queryClient.invalidateQueries({ queryKey: ["formDetail", formId] });
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
      search: { tab: "editor" },
      replace: true,
    });
  }, [formId, router, tab]);

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
    void router.navigate({
      to: "/forms/$id/edit",
      params: { id: formId },
      search: { tab: value },
    });
  };

  const handlePublishStatusChange = () => {
    void queryClient.invalidateQueries({ queryKey: ["formDetail", formId] });
    void queryClient.invalidateQueries({ queryKey: ["forms"] });
  };

  const refetchContent = () => {
    void contentQuery.refetch();
  };

  return {
    activeTab,
    archiveForm: () => archiveMutation.mutate(),
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
    isSaving,
    isTitlePending: updateTitleMutation.isPending,
    plateContent: contentQuery.data?.plateContent ?? "[]",
    refetchContent,
    resolveConflicts,
    responsesEverActive,
    setConflictResolutions,
    setShowDeleteModal,
    setShowDuplicateModal,
    showDeleteModal,
    showDuplicateModal,
    titleSaveFailureCount: updateTitleMutation.failureCount,
    unarchiveForm: () => unarchiveMutation.mutate(),
    updateTitle: (title: string) => updateTitleMutation.mutate(title),
  };
}
