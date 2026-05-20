import {
  AlertCircle,
  ChevronDown,
  Globe,
  History,
  KeyRound,
  Lock,
  RotateCcw,
  Save,
  Upload,
} from "lucide-react";
import { type FC, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useFormAccessControl } from "@/hooks/forms/use-form-access-control";
import { useFormPublishActions } from "@/hooks/forms/use-form-publish-actions";
import { useSnapshots } from "@/hooks/forms/use-snapshots";
import type { FormStatus } from "@/types/validation/shared";
import { NodesDiffList } from "./nodes-diff-list";
import { SnapshotGraph } from "./snapshot-graph";
import { SnapshotSaveDialog } from "./snapshot-save-dialog";

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

interface PublishToggleSectionProps {
  state: {
    publishState: "published" | "unpublished";
    processingState: "idle" | "processing";
    snapshotState: "available" | "missing";
    draftState: "draft" | "published-or-archived";
    activeSnapshotVersion: number | null;
  };
  onToggle: (checked: boolean) => void;
}

const PublishToggleSection: FC<PublishToggleSectionProps> = ({
  state,
  onToggle,
}) => {
  const isPublished = state.publishState === "published";
  const requiresSnapshot =
    state.snapshotState === "missing" && state.draftState === "draft";

  return (
    <div className="p-4 space-y-1">
      <div className="flex items-center justify-between">
        <Label
          htmlFor="publish-toggle"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Globe className="h-4 w-4" />
          フォームを公開する
        </Label>
        <Switch
          id="publish-toggle"
          size="sm"
          checked={isPublished}
          disabled={state.processingState === "processing" || requiresSnapshot}
          onCheckedChange={onToggle}
        />
      </div>
      {requiresSnapshot && (
        <p className="text-xs text-muted-foreground pl-6">
          先にスナップショットを保存してください
        </p>
      )}
      {isPublished && state.activeSnapshotVersion != null && (
        <p className="text-xs text-muted-foreground pl-6">
          公開版: v{state.activeSnapshotVersion}
        </p>
      )}
    </div>
  );
};

interface UnpublishedChangesSectionProps {
  isPublished: boolean;
  isProcessing: boolean;
  totalChanges: number;
  hasChangesFromActive: boolean;
  activeSnapshotVersion: number | null;
  onPublishChanges: () => void;
  onSaveOnly: () => void;
  onReset: () => void;
}

const UnpublishedChangesSection: FC<UnpublishedChangesSectionProps> = ({
  isPublished,
  isProcessing,
  totalChanges,
  hasChangesFromActive,
  activeSnapshotVersion,
  onPublishChanges,
  onSaveOnly,
  onReset,
}) => (
  <>
    <Separator />
    <div className="p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertCircle className="h-4 w-4 text-amber-500" />
        未公開の変更
        {totalChanges > 0 && (
          <Badge variant="secondary" className="text-xs">
            {totalChanges}件
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={isProcessing} onClick={onPublishChanges}>
          <Upload className="mr-1 h-3.5 w-3.5" />
          {isPublished ? "変更を公開" : "保存して公開"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isProcessing}
          onClick={onSaveOnly}
        >
          <Save className="mr-1 h-3.5 w-3.5" />
          スナップショット保存
        </Button>
      </div>
      {activeSnapshotVersion != null && hasChangesFromActive && (
        <Button
          variant="ghost"
          size="sm"
          disabled={isProcessing}
          onClick={onReset}
          className="text-muted-foreground"
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          公開版に戻す
        </Button>
      )}
    </div>
  </>
);

interface PasswordProtectionSectionProps {
  enabled: boolean;
  hasPassword: boolean;
  isUpdating: boolean;
  isProcessing: boolean;
  passwordInput: string;
  passwordHintInput: string;
  passwordDirty: boolean;
  onToggle: (checked: boolean) => void;
  onPasswordChange: (value: string) => void;
  onHintChange: (value: string) => void;
  onSave: () => void;
}

const PasswordProtectionSection: FC<PasswordProtectionSectionProps> = ({
  enabled,
  hasPassword,
  isUpdating,
  isProcessing,
  passwordInput,
  passwordHintInput,
  passwordDirty,
  onToggle,
  onPasswordChange,
  onHintChange,
  onSave,
}) => (
  <>
    <Separator />
    <div className="p-4 space-y-2">
      <div className="flex items-center justify-between">
        <Label
          htmlFor="password-toggle"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Lock className="h-4 w-4" />
          パスワード保護
        </Label>
        <Switch
          id="password-toggle"
          size="sm"
          checked={enabled}
          disabled={isUpdating || isProcessing}
          onCheckedChange={onToggle}
        />
      </div>
      {enabled && (
        <div className="space-y-2 pl-6">
          <div className="space-y-1">
            <Label htmlFor="password-input" className="text-xs">
              パスワード
            </Label>
            <div className="flex gap-1">
              <Input
                id="password-input"
                type="password"
                placeholder={
                  hasPassword ? "変更する場合のみ入力" : "パスワードを入力"
                }
                value={passwordInput}
                onChange={(e) => onPasswordChange(e.target.value)}
                className="h-8 text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                disabled={isUpdating || (!passwordInput && !passwordDirty)}
                onClick={onSave}
              >
                <KeyRound className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="password-hint-input" className="text-xs">
              ヒント
            </Label>
            <Input
              id="password-hint-input"
              type="text"
              placeholder="パスワードのヒント（任意）"
              value={passwordHintInput}
              onChange={(e) => onHintChange(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </div>
      )}
    </div>
  </>
);

interface SnapshotItem {
  id: string;
  version: number;
  parentVersion?: number | null;
  isActive: boolean;
  publishedAt: string;
  changeLog?: string | null;
}

interface VersionHistorySectionProps {
  snapshots: SnapshotItem[];
  selectedSnapshotId: string | null;
  isMutating: boolean;
  isNotPublished: boolean;
  hasUnpublishedChanges: boolean;
  onSelect: (id: string | null) => void;
  onActivate: (version: number) => void;
  onPublish: (version: number) => void;
  onRestore: (version: number) => void;
  onSaveSnapshot: () => void;
}

const VersionHistorySection: FC<VersionHistorySectionProps> = ({
  snapshots,
  selectedSnapshotId,
  isMutating,
  isNotPublished,
  hasUnpublishedChanges,
  onSelect,
  onActivate,
  onPublish,
  onRestore,
  onSaveSnapshot,
}) => (
  <>
    <Separator />
    <div className="p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <History className="h-4 w-4" />
        バージョン履歴
      </div>
      {snapshots.length === 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            スナップショットがまだ作成されていません
          </p>
          {!hasUnpublishedChanges && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-7 text-xs"
              disabled={isMutating}
              onClick={onSaveSnapshot}
            >
              <Save className="mr-1 h-3 w-3" />
              スナップショットを保存する
            </Button>
          )}
        </div>
      ) : (
        <ScrollArea className="max-h-64">
          <SnapshotGraph
            snapshots={snapshots}
            selectedId={selectedSnapshotId}
            onSelect={onSelect}
            isMutating={isMutating}
            isNotPublished={isNotPublished}
            onActivate={onActivate}
            onPublish={onPublish}
            onRestore={onRestore}
          />
        </ScrollArea>
      )}
    </div>
  </>
);

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────

interface FormPublishMenuProps {
  formId: string;
  formStatus: FormStatus;
  onStatusChange?: () => void;
  onResetSuccess?: () => void;
}

type DialogMode = "saveAndPublish" | "saveAndActivate" | "saveOnly" | null;

interface TriggerContentProps {
  formStatus: FormStatus;
  isArchived: boolean;
  isPublished: boolean;
  hasUnpublishedChanges: boolean;
  activeSnapshotVersion: number | null;
}

const TriggerContent: FC<TriggerContentProps> = ({
  formStatus,
  isArchived,
  isPublished,
  hasUnpublishedChanges,
  activeSnapshotVersion,
}) => {
  if (isArchived) {
    return (
      <>
        <span className="h-2 w-2 rounded-full bg-muted-foreground" />
        アーカイブ済み
      </>
    );
  }

  if (isPublished && !hasUnpublishedChanges) {
    return (
      <>
        <span className="h-2 w-2 rounded-full bg-green-500" />
        公開中
        {activeSnapshotVersion != null && (
          <Badge variant="secondary" className="font-mono text-xs ml-1">
            v{activeSnapshotVersion}
          </Badge>
        )}
      </>
    );
  }

  if (isPublished && hasUnpublishedChanges) {
    return (
      <>
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        {activeSnapshotVersion != null && (
          <Badge variant="secondary" className="font-mono text-xs">
            v{activeSnapshotVersion}
          </Badge>
        )}
        未公開の変更
      </>
    );
  }

  if (formStatus === "UNPUBLISHED") {
    return (
      <>
        <span className="h-2 w-2 rounded-full bg-muted-foreground" />
        非公開
        {activeSnapshotVersion != null && (
          <Badge variant="secondary" className="font-mono text-xs ml-1">
            v{activeSnapshotVersion}
          </Badge>
        )}
      </>
    );
  }

  return (
    <>
      <span className="h-2 w-2 rounded-full bg-muted-foreground" />
      未公開
    </>
  );
};

const ArchivedPublishButton: FC<TriggerContentProps> = (props) => (
  <Button variant="outline" size="sm" disabled>
    <span className="flex items-center gap-1.5">
      <TriggerContent {...props} />
    </span>
  </Button>
);

interface ResetSnapshotDialogProps {
  formId: string;
  open: boolean;
  activeSnapshotVersion: number | null;
  totalChanges: number;
  isProcessing: boolean;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
}

const ResetSnapshotDialog: FC<ResetSnapshotDialogProps> = ({
  formId,
  open,
  activeSnapshotVersion,
  totalChanges,
  isProcessing,
  onOpenChange,
  onReset,
}) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
      <AlertDialogHeader>
        <AlertDialogTitle>公開版スナップショットに戻す</AlertDialogTitle>
        <AlertDialogDescription>
          現在の編集内容を破棄し、公開版のスナップショット
          {activeSnapshotVersion != null && ` (v${activeSnapshotVersion})`}
          に戻します。 この操作は元に戻せません。本当に実行しますか？
        </AlertDialogDescription>
      </AlertDialogHeader>

      {totalChanges > 0 && (
        <div className="my-4">
          <h4 className="text-sm font-medium mb-2">
            変更内容 ({totalChanges}件):
          </h4>
          <div className="max-h-96 overflow-auto">
            <NodesDiffList formId={formId} />
          </div>
        </div>
      )}

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isProcessing}>
          キャンセル
        </AlertDialogCancel>
        <Button onClick={onReset} disabled={isProcessing}>
          {isProcessing ? "リセット中..." : "リセットする"}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

interface PublishMenuPopoverContentProps {
  publish: {
    isPublished: boolean;
    isProcessing: boolean;
    hasActiveSnapshot: boolean;
    isNotPublished: boolean;
    hasUnpublishedChanges: boolean;
    hasChangesFromActive: boolean;
    activeSnapshotVersion: number | null;
    totalChanges: number;
  };
  password: {
    enabled: boolean;
    hasPassword: boolean;
    isUpdating: boolean;
    input: string;
    hintInput: string;
    dirty: boolean;
  };
  history: {
    snapshots: SnapshotItem[];
    selectedSnapshotId: string | null;
    isMutating: boolean;
  };
  onPublishToggle: (checked: boolean) => void;
  onPublishChanges: () => void;
  onSaveOnly: () => void;
  onReset: () => void;
  onPasswordToggle: (checked: boolean) => void;
  onPasswordChange: (value: string) => void;
  onHintChange: (value: string) => void;
  onPasswordSave: () => void;
  onSelectSnapshot: (id: string | null) => void;
  onActivateSnapshot: (version: number) => void;
  onPublishSnapshot: (version: number) => void;
  onRestoreSnapshot: (version: number) => void;
}

const PublishMenuPopoverContent: FC<PublishMenuPopoverContentProps> = ({
  publish,
  password,
  history,
  onPublishToggle,
  onPublishChanges,
  onSaveOnly,
  onReset,
  onPasswordToggle,
  onPasswordChange,
  onHintChange,
  onPasswordSave,
  onSelectSnapshot,
  onActivateSnapshot,
  onPublishSnapshot,
  onRestoreSnapshot,
}) => (
  <PopoverContent align="end" className="w-80 p-0">
    <PublishToggleSection
      state={{
        publishState: publish.isPublished ? "published" : "unpublished",
        processingState: publish.isProcessing ? "processing" : "idle",
        snapshotState: publish.hasActiveSnapshot ? "available" : "missing",
        draftState: publish.isNotPublished ? "draft" : "published-or-archived",
        activeSnapshotVersion: publish.activeSnapshotVersion,
      }}
      onToggle={onPublishToggle}
    />

    {publish.hasUnpublishedChanges && (
      <UnpublishedChangesSection
        isPublished={publish.isPublished}
        isProcessing={publish.isProcessing}
        totalChanges={publish.totalChanges}
        hasChangesFromActive={publish.hasChangesFromActive}
        activeSnapshotVersion={publish.activeSnapshotVersion}
        onPublishChanges={onPublishChanges}
        onSaveOnly={onSaveOnly}
        onReset={onReset}
      />
    )}

    <PasswordProtectionSection
      enabled={password.enabled}
      hasPassword={password.hasPassword}
      isUpdating={password.isUpdating}
      isProcessing={publish.isProcessing}
      passwordInput={password.input}
      passwordHintInput={password.hintInput}
      passwordDirty={password.dirty}
      onToggle={onPasswordToggle}
      onPasswordChange={onPasswordChange}
      onHintChange={onHintChange}
      onSave={onPasswordSave}
    />

    <VersionHistorySection
      snapshots={history.snapshots}
      selectedSnapshotId={history.selectedSnapshotId}
      isMutating={history.isMutating}
      isNotPublished={publish.isNotPublished}
      hasUnpublishedChanges={publish.hasUnpublishedChanges}
      onSelect={onSelectSnapshot}
      onActivate={onActivateSnapshot}
      onPublish={onPublishSnapshot}
      onRestore={onRestoreSnapshot}
      onSaveSnapshot={onSaveOnly}
    />
  </PopoverContent>
);

const getSnapshotSaveConfirmLabel = (mode: DialogMode): string => {
  switch (mode) {
    case "saveAndPublish":
      return "保存して公開";
    case "saveAndActivate":
      return "保存して公開版を更新";
    case "saveOnly":
      return "保存する";
    default:
      return "保存する";
  }
};

export function FormPublishMenu({
  formId,
  formStatus,
  onStatusChange,
  onResetSuccess,
}: FormPublishMenuProps) {
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(
    null,
  );
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordHintInput, setPasswordHintInput] = useState("");
  const [passwordDirty, setPasswordDirty] = useState(false);

  const {
    hasUnpublishedChanges,
    hasChangesFromActive,
    hasActiveSnapshot,
    lastPublishedVersion,
    activeSnapshotVersion,
    isProcessing,
    totalChanges,
    saveSnapshot,
    saveAndPublish,
    saveAndActivate,
    publishForm,
    unpublishForm,
    resetToActiveSnapshot,
  } = useFormPublishActions(formId);

  const {
    snapshotsQuery,
    activateSnapshotMutation,
    restoreEditFromSnapshotMutation,
  } = useSnapshots(formId);

  const {
    passwordProtection,
    updatePasswordProtection,
    isUpdating: isPasswordUpdating,
  } = useFormAccessControl(formId);

  // パスワード保護設定の取得完了後、入力欄を既存値で初期化する
  useEffect(() => {
    if (!passwordDirty) {
      setPasswordHintInput(passwordProtection.password_hint ?? "");
    }
  }, [passwordProtection.password_hint, passwordDirty]);

  const snapshots = snapshotsQuery.data?.snapshots ?? [];
  const isArchived = formStatus === "ARCHIVED";
  const isPublished = formStatus === "PUBLISHED";
  const isNotPublished = formStatus === "DRAFT" || formStatus === "UNPUBLISHED";

  // --- Handlers ---
  const handleDialogConfirm = async (changeLog: string) => {
    try {
      switch (dialogMode) {
        case "saveAndPublish": {
          await saveAndPublish(changeLog);
          toast.success("スナップショットを保存し、フォームを公開しました");
          break;
        }
        case "saveAndActivate": {
          await saveAndActivate(changeLog);
          toast.success("スナップショットを保存し、公開版を更新しました");
          break;
        }
        case "saveOnly": {
          const result = await saveSnapshot(changeLog);
          toast.success(`スナップショットを保存しました (v${result.version})`);
          break;
        }
        default:
          return;
      }
      setDialogMode(null);
      onStatusChange?.();
    } catch (error) {
      toast.error(
        `処理に失敗しました: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  const handlePublishToggle = async (checked: boolean) => {
    try {
      if (checked) {
        await publishForm();
        toast.success("フォームを公開しました");
      } else {
        await unpublishForm();
        toast.success("フォームを非公開にしました");
      }
      onStatusChange?.();
    } catch (error) {
      toast.error(
        `操作に失敗しました: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  const handleReset = async () => {
    try {
      await resetToActiveSnapshot();
      toast.success("公開版スナップショットにリセットしました");
      setShowResetDialog(false);
      onResetSuccess?.();
    } catch (error) {
      toast.error(
        `リセットに失敗しました: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  const handleActivateSnapshot = useCallback(
    (version: number) => {
      activateSnapshotMutation.mutate(version, {
        onSuccess: () => {
          toast.success(`バージョン ${version} を公開版にしました`);
          setSelectedSnapshotId(null);
          onStatusChange?.();
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "公開版の切り替えに失敗しました",
          );
        },
      });
    },
    [activateSnapshotMutation, onStatusChange],
  );

  const handlePublishFromHistory = useCallback(
    async (version: number) => {
      try {
        await activateSnapshotMutation.mutateAsync(version);
        await publishForm();
        toast.success(`バージョン ${version} を公開版にして公開しました`);
        setSelectedSnapshotId(null);
        onStatusChange?.();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "公開に失敗しました",
        );
      }
    },
    [activateSnapshotMutation, publishForm, onStatusChange],
  );

  const handleRestoreEdit = useCallback(
    (version: number) => {
      restoreEditFromSnapshotMutation.mutate(version, {
        onSuccess: () => {
          toast.success(
            `バージョン ${version} の内容で編集データを復元しました`,
          );
          setSelectedSnapshotId(null);
          onResetSuccess?.();
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "編集データの復元に失敗しました",
          );
        },
      });
    },
    [restoreEditFromSnapshotMutation, onResetSuccess],
  );

  const handlePasswordToggle = (checked: boolean) => {
    // パスワード未設定のまま有効化しようとした場合はエラーを表示
    if (checked && !passwordProtection.hasPassword && !passwordInput) {
      toast.error("パスワードを設定してから有効にしてください");
      return;
    }
    // 既存パスワードがない状態でONにする場合は、入力中のパスワードも一緒に送信する
    const extraFields =
      checked && !passwordProtection.hasPassword
        ? { password: passwordInput }
        : {};
    updatePasswordProtection.mutate(
      { enabled: checked, ...extraFields },
      {
        onSuccess: () => {
          toast.success(
            checked
              ? "パスワード保護を有効にしました"
              : "パスワード保護を無効にしました",
          );
          // パスワードを同時に設定した場合は入力欄をクリアする
          if (checked && !passwordProtection.hasPassword) {
            setPasswordInput("");
            setPasswordDirty(false);
          }
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "パスワード保護の変更に失敗しました",
          );
        },
      },
    );
  };

  const handlePasswordSave = () => {
    if (!passwordInput && !passwordDirty) return;
    updatePasswordProtection.mutate(
      {
        enabled: passwordProtection.enabled,
        password: passwordInput || undefined,
        // 空文字列をそのまま送信することで API 側がヒント削除として処理する
        password_hint: passwordHintInput,
      },
      {
        onSuccess: () => {
          toast.success("パスワードを更新しました");
          setPasswordInput("");
          setPasswordDirty(false);
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "パスワードの更新に失敗しました",
          );
        },
      },
    );
  };

  if (isArchived) {
    return (
      <ArchivedPublishButton
        formStatus={formStatus}
        isArchived={isArchived}
        isPublished={isPublished}
        hasUnpublishedChanges={hasUnpublishedChanges}
        activeSnapshotVersion={activeSnapshotVersion}
      />
    );
  }

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <span className="flex items-center gap-1.5">
              <TriggerContent
                formStatus={formStatus}
                isArchived={isArchived}
                isPublished={isPublished}
                hasUnpublishedChanges={hasUnpublishedChanges}
                activeSnapshotVersion={activeSnapshotVersion}
              />
            </span>
            <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PublishMenuPopoverContent
          publish={{
            isPublished,
            isProcessing,
            hasActiveSnapshot,
            isNotPublished,
            hasUnpublishedChanges,
            hasChangesFromActive,
            activeSnapshotVersion,
            totalChanges,
          }}
          password={{
            enabled: passwordProtection.enabled,
            hasPassword: passwordProtection.hasPassword,
            isUpdating: isPasswordUpdating,
            input: passwordInput,
            hintInput: passwordHintInput,
            dirty: passwordDirty,
          }}
          history={{
            snapshots,
            selectedSnapshotId,
            isMutating:
              activateSnapshotMutation.isPending ||
              restoreEditFromSnapshotMutation.isPending ||
              isProcessing,
          }}
          onPublishToggle={(checked) => void handlePublishToggle(checked)}
          onPublishChanges={() =>
            setDialogMode(isPublished ? "saveAndActivate" : "saveAndPublish")
          }
          onSaveOnly={() => setDialogMode("saveOnly")}
          onReset={() => setShowResetDialog(true)}
          onPasswordToggle={handlePasswordToggle}
          onPasswordChange={(value) => {
            setPasswordInput(value);
            setPasswordDirty(true);
          }}
          onHintChange={(value) => {
            setPasswordHintInput(value);
            setPasswordDirty(true);
          }}
          onPasswordSave={handlePasswordSave}
          onSelectSnapshot={setSelectedSnapshotId}
          onActivateSnapshot={handleActivateSnapshot}
          onPublishSnapshot={(version) =>
            void handlePublishFromHistory(version)
          }
          onRestoreSnapshot={handleRestoreEdit}
        />
      </Popover>

      {/* 保存ダイアログ */}
      <SnapshotSaveDialog
        formId={formId}
        open={dialogMode !== null}
        onOpenChange={(open) => {
          if (!open) setDialogMode(null);
        }}
        isProcessing={isProcessing}
        hasUnpublishedChanges={hasUnpublishedChanges}
        lastPublishedVersion={lastPublishedVersion}
        totalChanges={totalChanges}
        confirmLabel={getSnapshotSaveConfirmLabel(dialogMode)}
        onConfirm={(changeLog) => void handleDialogConfirm(changeLog)}
      />

      <ResetSnapshotDialog
        formId={formId}
        open={showResetDialog}
        activeSnapshotVersion={activeSnapshotVersion}
        totalChanges={totalChanges}
        isProcessing={isProcessing}
        onOpenChange={setShowResetDialog}
        onReset={() => void handleReset()}
      />
    </>
  );
}
