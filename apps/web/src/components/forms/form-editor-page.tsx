import { ensureNodeIds } from "@nexus-form/shared";
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
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PlateEditor } from "@/components/editor/plate-editor";
import { FormArchiveManager } from "@/components/forms/form-archive-manager";
import { FormDeletionModal } from "@/components/forms/form-deletion-modal";
import { FormDuplicateModal } from "@/components/forms/form-duplicate-modal";
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
import { useEditorSSE } from "@/hooks/forms/use-editor-sse";
import { usePlateMerge } from "@/hooks/forms/use-plate-merge";
import { usePageTitle } from "@/hooks/use-page-title";
import { baseUrl, client, RpcError, rpc } from "@/lib/api";
import type { FormStatus } from "@/types/validation/shared";

type EditorTab = "editor" | "settings" | "validation" | "sharing" | "responses";

const EDITOR_TABS: EditorTab[] = [
  "editor",
  "settings",
  "validation",
  "sharing",
  "responses",
];

export function FormEditorPage() {
  const { id } = useParams({ from: "/_authenticated/forms/$id/edit" });
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tab } = useSearch({ from: "/_authenticated/forms/$id/edit" });

  const [activeTab, setActiveTab] = useState<EditorTab>(() =>
    EDITOR_TABS.includes(tab as EditorTab) ? (tab as EditorTab) : "editor",
  );
  const [responsesEverActive, setResponsesEverActive] = useState(
    tab === "responses",
  );
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Page-level draft content. Updated from server on initial load / after merge,
  // and snapshotted from editorValueRef when switching away from the editor tab.
  // Not updated on every keystroke — PlateEditor owns the live state while active.
  const [draftContent, setDraftContent] = useState<string | null>(null);

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

  // 最新のバージョンを ref で追跡（debounce 中のバージョン更新に対応）
  const versionRef = useRef(0);
  // サーバー確認済みコンテンツ（3-way merge のベース）
  const baseContentRef = useRef("[]");
  // エディタの現在値を merge 用に追跡
  const editorValueRef = useRef("[]");

  useEffect(() => {
    if (contentQuery.data) {
      versionRef.current = contentQuery.data.plateContentVersion;
      // Store the canonical form that Plate will produce after parseValue +
      // ensureNodeIds + JSON.stringify round-trip. If we stored the raw DB
      // value instead, Plate's initial normalisation (e.g. adding node IDs,
      // reordering keys) would produce a different serialised string, making
      // the baseContentRef equality check in handleContentChange fail and
      // arming a spurious debounce save on every page load.
      const raw = contentQuery.data.plateContent ?? "[]";
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          ensureNodeIds(parsed);
          baseContentRef.current = JSON.stringify(parsed);
        } else {
          baseContentRef.current = raw;
        }
      } catch {
        baseContentRef.current = raw;
      }
      editorValueRef.current = baseContentRef.current;
      setDraftContent(baseContentRef.current);
    }
  }, [contentQuery.data]);

  // debounce 付き自動保存
  const saveTimerRef = useRef<number | null>(null);
  const pendingValueRef = useRef<string | null>(null);
  const mutateRef = useRef<
    (data: { plateContent: string; expectedVersion: number }) => void
  >(() => {});

  // 自分が保存した直後のバージョンを追跡（SSE エコー判定用）
  const lastSavedVersionRef = useRef<number | null>(null);

  // コンフリクト解決中フラグ（SSE が refetch してエディタを書き換えるのを防ぐ）
  const isConflictActiveRef = useRef(false);
  // isMergingRef is exposed directly from usePlateMerge — no local mirror needed

  // Conflict resolutions lifted here so tab switches don't reset user choices.
  // Reset when a new conflictState arrives (new conflict detected).
  const [conflictResolutions, setConflictResolutions] = useState<
    Record<string, "local" | "remote">
  >({});

  // 3-way merge フック
  // Memoised callbacks for usePlateMerge — all state reads go through refs
  // so the dependency arrays stay minimal and the hook's internal useCallback
  // chains (attemptMerge, resolveConflicts) remain stable across renders.
  const handleMergeSuccess = useCallback(
    (mergedContent: string, newVersion: number, mergeLocalContent: string) => {
      // Cancel any in-flight debounce timer — the merge already saved the
      // latest content; letting the old timer fire would overwrite the merge
      // with pre-merge text, silently discarding all remote changes.
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pendingValueRef.current = null;
      isConflictActiveRef.current = false;
      versionRef.current = newVersion;
      baseContentRef.current = mergedContent;
      lastSavedVersionRef.current = newVersion;
      const hasInFlightTyping = editorValueRef.current !== mergeLocalContent;
      void queryClient.invalidateQueries({ queryKey: ["formDiff", id] });
      if (!hasInFlightTyping) {
        // No new local typing during merge round-trip: safely sync both
        // editor ref and query cache to the server-confirmed merged content.
        editorValueRef.current = mergedContent;
        queryClient.setQueryData(["formContent", id], {
          plateContent: mergedContent,
          plateContentVersion: newVersion,
        });
        setIsSaving(false);
      } else {
        // Preserve edits typed during the merge round-trip and re-arm autosave.
        // Do NOT call setIsSaving(false) here — keep the indicator visible
        // until the re-armed timer fires and the save mutation completes.
        const inFlightValue = editorValueRef.current;
        pendingValueRef.current = inFlightValue;
        saveTimerRef.current = window.setTimeout(() => {
          const pendingValue = pendingValueRef.current;
          saveTimerRef.current = null;
          if (pendingValue == null) return;
          pendingValueRef.current = null;
          mutateRef.current({
            plateContent: pendingValue,
            expectedVersion: versionRef.current,
          });
        }, 2000);
      }
    },
    [id, queryClient],
  );
  // Track activeTab via ref so handleConflict stays stable (no deps on state)
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const handleConflict = useCallback(() => {
    isConflictActiveRef.current = true;
    setIsSaving(false);
    // Notify if the user is not on the editor tab — they won't see the banner
    if (activeTabRef.current !== "editor") {
      toast.warning("編集が競合しています。エディタタブで解決してください。");
    }
  }, []);
  // contentQuery.refetch を ref で保持して handleMergeFallback を安定化
  const refetchRef = useRef(contentQuery.refetch);
  refetchRef.current = contentQuery.refetch;
  const handleMergeFallback = useCallback(() => {
    isConflictActiveRef.current = false;
    // Cancel stale debounce timer and clear pendingValueRef so that
    // post-refetch SSE events don't treat discarded local changes as
    // pending edits and trigger phantom merge attempts.
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingValueRef.current = null;
    void refetchRef.current();
    setIsSaving(false);
  }, []);

  const getCurrentEditorValue = useCallback(() => editorValueRef.current, []);
  const setCurrentEditorValue = useCallback((value: string) => {
    editorValueRef.current = value;
  }, []);

  const {
    attemptMerge,
    resolveConflicts,
    dismissConflict,
    isMerging,
    isMergingRef,
    conflictState,
  } = usePlateMerge({
    formId: id,
    baseContentRef,
    getCurrentEditorValue,
    setCurrentEditorValue,
    onMergeSuccess: handleMergeSuccess,
    onConflict: handleConflict,
    onMergeFallback: handleMergeFallback,
  });

  // Reset resolutions when a new conflict arrives
  useEffect(() => {
    if (conflictState) {
      setConflictResolutions({});
    }
  }, [conflictState]);

  // SSE (React Query キャッシュを自動無効化 — document_changed 対応済み)
  useEditorSSE(id, {
    pendingValueRef,
    lastSavedVersionRef,
    onMergeNeeded: attemptMerge,
    isConflictActiveRef,
  });

  // コンテンツ保存 mutation
  const contentMutation = useMutation({
    mutationFn: (data: { plateContent: string; expectedVersion: number }) =>
      rpc(
        client.api.forms[":id"].content.$put({
          param: { id },
          json: data,
        }),
      ),
    onSuccess: (data, variables) => {
      if (data && "plateContentVersion" in data) {
        versionRef.current = data.plateContentVersion;
        // variables.plateContent は実際にサーバーに保存された値。
        // editorValueRef はラウンドトリップ中のキー入力で先に進んでいる
        // 可能性があるため使ってはいけない。
        baseContentRef.current = variables.plateContent;
        lastSavedVersionRef.current = data.plateContentVersion;
      }
      void queryClient.invalidateQueries({ queryKey: ["formDiff", id] });
      setIsSaving(false);
    },
    onError: (err) => {
      setIsSaving(false);
      // Revert optimistic echo-skip: the save failed so the version we
      // pre-set will never arrive as an SSE event.
      lastSavedVersionRef.current = null;
      // Version conflict (409) — 3-way merge を試行
      if (err instanceof RpcError && err.status === 409) {
        void attemptMerge();
      } else {
        toast.error("保存に失敗しました");
      }
    },
  });

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

  // mutate を ref で保持（クリーンアップ用）
  mutateRef.current = contentMutation.mutate;
  // handleContentChange must be reference-stable to avoid unnecessary
  // PlateEditor re-renders on every conflict/merge state change.
  // All reactive values are read through refs (isMergingRef, isConflictActiveRef,
  // saveTimerRef, pendingValueRef, versionRef, mutateRef) so no deps are needed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally stable — all values read through refs
  const handleContentChange = useCallback((value: string) => {
    editorValueRef.current = value;
    // conflict 解決中または auto-merge 進行中は自動保存を一時停止し、
    // 先行する debounce タイマーもキャンセルする（タイマー発火による
    // stale save がマージ結果を上書きするのを防ぐ）。
    if (isConflictActiveRef.current || isMergingRef.current) {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        pendingValueRef.current = null;
      }
      return;
    }
    // Skip re-saving content the server already has. This prevents a spurious
    // PUT after auto-merge: setQueryData → PlateEditorInternal setValue →
    // onChange round-trip fires handleContentChange with mergedContent, but
    // that content is already persisted (baseContentRef was just updated).
    if (value === baseContentRef.current && pendingValueRef.current == null) {
      return;
    }
    setIsSaving(true);
    pendingValueRef.current = value;
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      // Re-check guards: a merge or conflict may have started during the
      // 2 s debounce window. Firing now would race with attemptMerge's save,
      // producing a spurious 409 and unnecessary retry cycle.
      if (isMergingRef.current || isConflictActiveRef.current) {
        saveTimerRef.current = null;
        return;
      }
      const pendingValue = pendingValueRef.current;
      saveTimerRef.current = null;
      if (pendingValue == null) return;
      pendingValueRef.current = null;
      // Optimistically mark the in-flight version so the SSE echo-skip logic
      // can suppress the event that arrives before onSuccess fires.
      lastSavedVersionRef.current = versionRef.current + 1;
      mutateRef.current({
        plateContent: pendingValue,
        expectedVersion: versionRef.current,
      });
    }, 2000);
  }, []);

  // アンマウント時にタイマーをクリーンアップ & 保留中の変更をベストエフォートで保存
  // keepalive fetch は 64KB のボディ制限があるため、大きなドキュメントの場合は
  // localStorage に退避し、次回ページ読み込み時にリトライする
  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (pendingValueRef.current != null) {
        const body = JSON.stringify({
          plateContent: pendingValueRef.current,
          expectedVersion: versionRef.current,
        });
        // keepalive fetch は 64KB 制限がある。超える場合は localStorage に退避
        const KEEPALIVE_LIMIT = 64 * 1024;
        if (new Blob([body]).size <= KEEPALIVE_LIMIT) {
          fetch(`${baseUrl}/api/forms/${id}/content`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            keepalive: true,
            body,
          }).catch(() => {
            // 送信失敗時は localStorage にフォールバック
            try {
              localStorage.setItem(`pendingSave:${id}`, body);
            } catch {
              // localStorage も利用不可の場合は諦める
            }
          });
        } else {
          // 64KB を超える場合は localStorage に保存して次回リトライ
          try {
            localStorage.setItem(`pendingSave:${id}`, body);
          } catch {
            // localStorage も利用不可の場合は諦める
          }
        }
      }
    };
  }, [id]);

  // 前回ナビゲーション時に保存できなかった変更を localStorage からリトライ
  useEffect(() => {
    const key = `pendingSave:${id}`;
    const saved = localStorage.getItem(key);
    if (!saved) return;
    localStorage.removeItem(key);
    fetch(`${baseUrl}/api/forms/${id}/content`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: saved,
    })
      .then((res) => {
        if (res.ok) {
          toast.success("前回未保存の変更を復元しました");
          void queryClient.invalidateQueries({ queryKey: ["formContent", id] });
        }
        // 409 等は無視（既に新しいバージョンで上書き済み）
      })
      .catch(() => {
        // ネットワークエラー — 次回リトライのため再保存
        try {
          localStorage.setItem(key, saved);
        } catch {
          // 諦める
        }
      });
  }, [id, queryClient]);

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
      void formQuery.refetch();
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
      void formQuery.refetch();
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "アーカイブ解除に失敗しました",
      );
    },
  });

  if (formQuery.isLoading || contentQuery.isLoading) {
    return (
      <section className="rounded-lg border bg-card p-6">読み込み中...</section>
    );
  }

  if (formQuery.isError || contentQuery.isError) {
    return (
      <section className="rounded-lg border bg-card p-6 text-destructive">
        フォームの読み込みに失敗しました。再読み込みしてください。
      </section>
    );
  }

  const formData = formQuery.data?.form;
  const plateContent = contentQuery.data?.plateContent ?? "[]";

  const tabs: { key: EditorTab; label: string; icon: LucideIcon }[] = [
    { key: "editor", label: "エディタ", icon: MessageSquare },
    { key: "settings", label: "設定", icon: Settings },
    { key: "validation", label: "検証", icon: ShieldCheck },
    { key: "sharing", label: "共有", icon: Share2 },
    { key: "responses", label: "回答", icon: Inbox },
  ];

  return (
    <div className="space-y-4">
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
              {formData && <FormStatusBadge status={formData.status} />}
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
                  formStatus={formData.status as FormStatus}
                  onStatusChange={() => void formQuery.refetch()}
                  onResetSuccess={() => void contentQuery.refetch()}
                />
              )}
            </div>
          }
        />

        {/* タブナビゲーション */}
        <div className="flex gap-1 border-b">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  if (activeTab === "editor") {
                    setDraftContent(editorValueRef.current);
                  }
                  setActiveTab(tab.key);
                  if (tab.key === "responses") setResponsesEverActive(true);
                }}
                className={[
                  "flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm transition-colors",
                  activeTab === tab.key
                    ? "border-primary font-medium text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* エディタタブ */}
      {activeTab === "editor" && (
        <>
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
        </>
      )}

      {/* 設定タブ */}
      {activeTab === "settings" && (
        <div className="space-y-4">
          <section className="rounded-lg border bg-card p-6 shadow-sm">
            <ScheduleManager formId={id} />
          </section>

          <GoogleSheetsIntegration formId={id} />

          <section className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">フォーム管理</h2>
            <div className="flex flex-wrap gap-2">
              <FormArchiveManager
                isArchived={formData?.status === "ARCHIVED"}
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
        </div>
      )}

      {/* 検証タブ */}
      {activeTab === "validation" && (
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <FormValidationRulesPage
            formId={id}
            plateContent={draftContent ?? plateContent}
          />
        </section>
      )}

      {/* 共有タブ */}
      {activeTab === "sharing" && (
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <FormSharingSection formId={id} />
        </section>
      )}

      {/* 回答タブ — 一度訪れたら hidden で状態を保持 */}
      {responsesEverActive && (
        <div
          className={activeTab !== "responses" ? "hidden" : undefined}
          aria-hidden={activeTab !== "responses"}
        >
          <FormResponsesContent formId={id} />
        </div>
      )}

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
    </div>
  );
}
