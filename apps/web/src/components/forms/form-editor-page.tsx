import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useRouter, useSearch } from "@tanstack/react-router";
import {
  Copy,
  ExternalLink,
  Eye,
  Inbox,
  type LucideIcon,
  MessageSquare,
  Settings,
  Share2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PlateEditor } from "@/components/editor/plate-editor";
import { FormArchiveManager } from "@/components/forms/form-archive-manager";
import { FormDeletionModal } from "@/components/forms/form-deletion-modal";
import { FormDuplicateModal } from "@/components/forms/form-duplicate-modal";
import {
  type EditorTab,
  getEditorTabFromSearch,
  isEditorTab,
} from "@/components/forms/form-editor-tabs";
import { FormHeader } from "@/components/forms/form-header";
import { FormPublishMenu } from "@/components/forms/form-publish-menu";
import { FormResponsesContent } from "@/components/forms/form-responses-page";
import { FormSharingSection } from "@/components/forms/form-sharing-section";
import { FormStatusBadge } from "@/components/forms/form-status-badge";
import { FormValidationRulesPage } from "@/components/forms/form-validation-rules-page";
import { GoogleSheetsIntegration } from "@/components/forms/google-sheets-integration";
import { PlateConflictBanner } from "@/components/forms/plate-conflict-banner";
import { ScheduleManager } from "@/components/forms/schedule-manager";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFormContentAutosave } from "@/hooks/forms/use-form-content-autosave";
import { usePageTitle } from "@/hooks/use-page-title";
import { client, rpc } from "@/lib/api";
import { logWarn } from "@/lib/logger";
import { FormStatus } from "@/types/validation/shared";

export function FormEditorPage() {
  const { id } = useParams({ from: "/_authenticated/forms/$id/edit" });
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tab } = useSearch({ from: "/_authenticated/forms/$id/edit" });

  const activeTab = getEditorTabFromSearch(tab);
  const [responsesEverActive, setResponsesEverActive] = useState(
    activeTab === "responses",
  );
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  // フォームメタデータ取得
  const formQuery = useQuery({
    queryKey: ["formDetail", id],
    queryFn: () => rpc(client.api.forms[":id"].$get({ param: { id } })),
  });

  usePageTitle(formQuery.data?.form?.title ?? "フォームを編集");

  // Plate コンテンツ取得
  const contentQuery = useQuery({
    queryKey: ["formContent", id],
    queryFn: () => rpc(client.api.forms[":id"].content.$get({ param: { id } })),
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
  } = useFormContentAutosave({
    formId: id,
    contentData: contentQuery.data,
    contentRefetch: contentQuery.refetch,
    getActiveTab: () => activeTab,
  });
  const previousActiveTabRef = useRef(activeTab);
  const snapshotEditorToDraftRef = useRef(snapshotEditorToDraft);
  snapshotEditorToDraftRef.current = snapshotEditorToDraft;

  // フォーム名更新 mutation
  const updateTitleMutation = useMutation({
    mutationFn: (title: string) =>
      rpc(client.api.forms[":id"].$put({ param: { id }, json: { title } })),
    onSuccess: (data) => {
      if (data?.form) {
        // setQueryData で直接キャッシュを更新し、refetch による一時的な旧値上書きを防ぐ
        queryClient.setQueryData(["formDetail", id], { form: data.form });
      } else {
        // form が含まれない場合は再取得してキャッシュを同期（重複 PUT を防ぐ）
        void queryClient.invalidateQueries({ queryKey: ["formDetail", id] });
      }
      void queryClient.invalidateQueries({ queryKey: ["forms"] });
    },
    onError: () => {
      toast.error("フォーム名の保存に失敗しました");
      // FormHeader 側は titleSaveFailureCount の変化を検知してローカル表示をリセットする
    },
  });

  // フォーム削除
  const deleteMutation = useMutation({
    mutationFn: () => rpc(client.api.forms[":id"].$delete({ param: { id } })),
    onSuccess: () => {
      toast.success("フォームを削除しました");
      void queryClient.invalidateQueries({ queryKey: ["forms"] });
      void router.navigate({ to: "/" });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "削除に失敗しました");
    },
  });

  // フォーム複製
  const duplicateMutation = useMutation({
    mutationFn: () =>
      rpc(client.api.forms[":id"].duplicate.$post({ param: { id } })),
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

  // アーカイブ
  const archiveMutation = useMutation({
    mutationFn: () =>
      rpc(client.api.forms[":id"].archive.$post({ param: { id } })),
    onSuccess: () => {
      toast.success("フォームをアーカイブしました");
      void queryClient.invalidateQueries({ queryKey: ["formDetail", id] });
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
      rpc(client.api.forms[":id"].unarchive.$post({ param: { id } })),
    onSuccess: () => {
      toast.success("アーカイブを解除しました");
      void queryClient.invalidateQueries({ queryKey: ["formDetail", id] });
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
      params: { id },
      search: { tab: "editor" },
      replace: true,
    });
  }, [id, router, tab]);

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

  if (formQuery.isLoading || contentQuery.isLoading) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: Loading status is not calculation output.
      <div
        className="rounded-lg border bg-card p-6"
        role="status"
        aria-live="polite"
      >
        読み込み中...
      </div>
    );
  }

  if (formQuery.isError || contentQuery.isError) {
    return (
      <section className="rounded-lg border bg-card p-6 text-destructive">
        フォームの読み込みに失敗しました。再読み込みしてください。
      </section>
    );
  }

  const plateContent = contentQuery.data?.plateContent ?? "[]";

  const tabs: { key: EditorTab; label: string; icon: LucideIcon }[] = [
    { key: "editor", label: "エディタ", icon: MessageSquare },
    { key: "settings", label: "設定", icon: Settings },
    { key: "validation", label: "検証", icon: ShieldCheck },
    { key: "sharing", label: "共有", icon: Share2 },
    { key: "responses", label: "回答", icon: Inbox },
  ];

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        if (!isEditorTab(value) || value === activeTab) return;
        void router.navigate({
          to: "/forms/$id/edit",
          params: { id },
          search: { tab: value },
        });
      }}
      className="gap-4"
    >
      {/* ヘッダー */}
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <FormHeader
          title={formData?.title ?? "フォームエディタ"}
          onTitleBlur={
            formData ? (title) => updateTitleMutation.mutate(title) : undefined
          }
          isTitleSaving={updateTitleMutation.isPending}
          titleSaveFailureCount={updateTitleMutation.failureCount}
          action={
            <div className="flex items-center gap-2">
              {formData && <FormStatusBadge status={formStatus} />}
              {isSaving && (
                <span className="text-xs text-muted-foreground">保存中...</span>
              )}
              {formData?.publicId && (
                <Button variant="outline" size="sm" asChild>
                  <Link
                    to="/forms/public/$publicId"
                    params={{ publicId: formData.publicId }}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                    公開フォームを開く
                  </Link>
                </Button>
              )}
              <Button variant="outline" size="sm" asChild>
                <Link
                  to="/forms/preview/$id"
                  params={{ id }}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Eye className="mr-1 h-3.5 w-3.5" />
                  プレビュー
                </Link>
              </Button>
              {formData && (
                <FormPublishMenu
                  formId={id}
                  formStatus={formStatus}
                  onStatusChange={() => void formQuery.refetch()}
                  onResetSuccess={() => void contentQuery.refetch()}
                />
              )}
            </div>
          }
        />

        <TabsList
          variant="line"
          aria-label="フォーム編集セクション"
          className="w-full border-b"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.key} value={tab.key} className="px-4">
                <Icon className="h-4 w-4" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </section>

      {/* エディタタブ */}
      <TabsContent value="editor" className="space-y-4">
        {conflictState && (
          <PlateConflictBanner
            conflicts={conflictState.result.conflicts}
            resolutions={conflictResolutions}
            onResolutionChange={setConflictResolutions}
            onResolve={resolveConflicts}
            onDismiss={dismissConflict}
            isMerging={isMerging}
          />
        )}
        <section className="rounded-lg border bg-card shadow-sm">
          <PlateEditor
            value={draftContent ?? plateContent}
            onChange={handleContentChange}
          />
        </section>
      </TabsContent>

      {/* 設定タブ */}
      <TabsContent value="settings" className="space-y-4">
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <ScheduleManager formId={id} />
        </section>

        <GoogleSheetsIntegration formId={id} />

        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">フォーム管理</h2>
          <div className="flex flex-wrap gap-2">
            <FormArchiveManager
              isArchived={formStatus === "ARCHIVED"}
              isLoading={
                archiveMutation.isPending || unarchiveMutation.isPending
              }
              onArchive={() => archiveMutation.mutate()}
              onUnarchive={() => unarchiveMutation.mutate()}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDuplicateModal(true)}
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              複製
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteModal(true)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              削除
            </Button>
          </div>
        </section>
      </TabsContent>

      {/* 検証タブ */}
      <TabsContent value="validation">
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <FormValidationRulesPage formId={id} plateContent={plateContent} />
        </section>
      </TabsContent>

      {/* 共有タブ */}
      <TabsContent value="sharing">
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <FormSharingSection formId={id} />
        </section>
      </TabsContent>

      {/* 回答タブ — 一度訪れたら forceMount で状態を保持 */}
      <TabsContent
        value="responses"
        forceMount
        hidden={activeTab !== "responses"}
        aria-hidden={activeTab !== "responses"}
      >
        {responsesEverActive ? <FormResponsesContent formId={id} /> : null}
      </TabsContent>

      {/* モーダル */}
      <FormDeletionModal
        open={showDeleteModal}
        title={formData?.title}
        isDeleting={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onClose={() => setShowDeleteModal(false)}
      />
      <FormDuplicateModal
        open={showDuplicateModal}
        isDuplicating={duplicateMutation.isPending}
        onConfirm={() => duplicateMutation.mutate()}
        onClose={() => setShowDuplicateModal(false)}
      />
    </Tabs>
  );
}
