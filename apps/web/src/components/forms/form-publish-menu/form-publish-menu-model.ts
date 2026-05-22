import { useCallback, useEffect, useReducer } from "react";
import { toast } from "sonner";
import { useFormAccessControl } from "@/hooks/forms/use-form-access-control";
import { useFormPublishActions } from "@/hooks/forms/use-form-publish-actions";
import { useSnapshots } from "@/hooks/forms/use-snapshots";
import type { FormStatus } from "@/types/validation/shared";
import {
  getPublishToggleSectionState,
  getTriggerVisualState,
  type PasswordProtectionSectionState,
  type PublishToggleAction,
  type PublishToggleSectionState,
  type UnpublishedChangesSectionState,
  type VersionHistorySectionState,
} from "./types";

type DialogMode = "saveAndPublish" | "saveAndActivate" | "saveOnly" | null;

export interface FormPublishMenuProps {
  formId: string;
  formStatus: FormStatus;
  onStatusChange?: () => void;
  onResetSuccess?: () => void;
}

interface PublishMenuState {
  dialogMode: DialogMode;
  showResetDialog: boolean;
  selectedSnapshotId: string | null;
  passwordInput: string;
  passwordHintInput: string;
  passwordDirty: boolean;
}

type PublishMenuAction =
  | { type: "open-save-dialog"; mode: Exclude<DialogMode, null> }
  | { type: "close-save-dialog" }
  | { type: "set-reset-dialog"; open: boolean }
  | { type: "select-snapshot"; snapshotId: string | null }
  | { type: "set-password-input"; value: string }
  | { type: "set-password-hint"; value: string }
  | { type: "sync-password-hint"; value: string }
  | { type: "complete-password-edit"; hintInput: string };

const initialPublishMenuState: PublishMenuState = {
  dialogMode: null,
  showResetDialog: false,
  selectedSnapshotId: null,
  passwordInput: "",
  passwordHintInput: "",
  passwordDirty: false,
};

const publishMenuReducer = (
  state: PublishMenuState,
  action: PublishMenuAction,
): PublishMenuState => {
  switch (action.type) {
    case "open-save-dialog":
      return { ...state, dialogMode: action.mode };
    case "close-save-dialog":
      return { ...state, dialogMode: null };
    case "set-reset-dialog":
      return { ...state, showResetDialog: action.open };
    case "select-snapshot":
      return { ...state, selectedSnapshotId: action.snapshotId };
    case "set-password-input":
      return {
        ...state,
        passwordInput: action.value,
        passwordDirty: true,
      };
    case "set-password-hint":
      return {
        ...state,
        passwordHintInput: action.value,
        passwordDirty: true,
      };
    case "sync-password-hint":
      if (state.passwordDirty) {
        return state;
      }
      return { ...state, passwordHintInput: action.value };
    case "complete-password-edit":
      return {
        ...state,
        passwordInput: "",
        passwordHintInput: action.hintInput,
        passwordDirty: false,
      };
    default:
      return state;
  }
};

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

export function useFormPublishMenuModel({
  formId,
  formStatus,
  onStatusChange,
  onResetSuccess,
}: FormPublishMenuProps) {
  const [state, dispatch] = useReducer(
    publishMenuReducer,
    initialPublishMenuState,
  );
  const {
    dialogMode,
    showResetDialog,
    selectedSnapshotId,
    passwordInput,
    passwordHintInput,
    passwordDirty,
  } = state;

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

  useEffect(() => {
    dispatch({
      type: "sync-password-hint",
      value: passwordProtection.password_hint ?? "",
    });
  }, [passwordProtection.password_hint]);

  const snapshots = snapshotsQuery.data?.snapshots ?? [];
  const isArchived = formStatus === "ARCHIVED";
  const isPublished = formStatus === "PUBLISHED";
  const isNotPublished = formStatus === "DRAFT" || formStatus === "UNPUBLISHED";

  const publishSectionState: PublishToggleSectionState =
    getPublishToggleSectionState({
      publishState: isPublished ? "published" : "unpublished",
      processingState: isProcessing ? "processing" : "idle",
      snapshotState: hasActiveSnapshot ? "available" : "missing",
      draftStatus: isNotPublished ? "draft" : "published-or-archived",
      activeSnapshotVersion,
    });

  const unpublishedChangesState: UnpublishedChangesSectionState = {
    publishState: isPublished ? "published" : "unpublished",
    actionState: isProcessing ? "processing" : "idle",
    totalChanges,
    hasChangesFromActive,
    activeSnapshotVersion,
  };

  const passwordState: PasswordProtectionSectionState = {
    isEnabled: passwordProtection.enabled,
    hasPassword: passwordProtection.hasPassword,
    updateState: isPasswordUpdating ? "processing" : "idle",
    publishActionState: isProcessing ? "processing" : "idle",
    input: passwordInput,
    hintInput: passwordHintInput,
    isDirty: passwordDirty,
  };

  const historyState: VersionHistorySectionState = {
    snapshots,
    selectedSnapshotId,
    isMutating:
      activateSnapshotMutation.isPending ||
      restoreEditFromSnapshotMutation.isPending ||
      isProcessing,
    isNotPublished,
    hasUnpublishedChanges,
  };

  const triggerState = getTriggerVisualState(
    formStatus,
    hasUnpublishedChanges,
    activeSnapshotVersion,
  );

  const handleDialogConfirm = useCallback(
    async (changeLog: string) => {
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
            toast.success(
              `スナップショットを保存しました (v${result.version})`,
            );
            break;
          }
          default:
            return;
        }
        dispatch({ type: "close-save-dialog" });
        onStatusChange?.();
      } catch (error) {
        toast.error(
          `処理に失敗しました: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    },
    [dialogMode, onStatusChange, saveAndActivate, saveAndPublish, saveSnapshot],
  );

  const handlePublishAction = useCallback(
    async (action: PublishToggleAction) => {
      try {
        if (action === "publish") {
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
    },
    [onStatusChange, publishForm, unpublishForm],
  );

  const handleReset = useCallback(async () => {
    try {
      await resetToActiveSnapshot();
      toast.success("公開版スナップショットにリセットしました");
      dispatch({ type: "set-reset-dialog", open: false });
      onResetSuccess?.();
    } catch (error) {
      toast.error(
        `リセットに失敗しました: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [onResetSuccess, resetToActiveSnapshot]);

  const handleActivateSnapshot = useCallback(
    (version: number) => {
      activateSnapshotMutation.mutate(version, {
        onSuccess: () => {
          toast.success(`バージョン ${version} を公開版にしました`);
          dispatch({ type: "select-snapshot", snapshotId: null });
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
        dispatch({ type: "select-snapshot", snapshotId: null });
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
          dispatch({ type: "select-snapshot", snapshotId: null });
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
    if (checked && !passwordProtection.hasPassword && !passwordInput) {
      toast.error("パスワードを設定してから有効にしてください");
      return;
    }

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
          if (checked && !passwordProtection.hasPassword) {
            dispatch({
              type: "complete-password-edit",
              hintInput: passwordHintInput,
            });
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
        password_hint: passwordHintInput,
      },
      {
        onSuccess: () => {
          toast.success("パスワードを更新しました");
          dispatch({
            type: "complete-password-edit",
            hintInput: passwordHintInput,
          });
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

  const handlePublishChanges = useCallback(() => {
    dispatch({
      type: "open-save-dialog",
      mode: isPublished ? "saveAndActivate" : "saveAndPublish",
    });
  }, [isPublished]);

  const handleSaveOnly = useCallback(() => {
    dispatch({ type: "open-save-dialog", mode: "saveOnly" });
  }, []);

  const handleOpenResetDialog = useCallback(() => {
    dispatch({ type: "set-reset-dialog", open: true });
  }, []);

  const handlePasswordChange = useCallback((value: string) => {
    dispatch({ type: "set-password-input", value });
  }, []);

  const handleHintChange = useCallback((value: string) => {
    dispatch({ type: "set-password-hint", value });
  }, []);

  const handleSelectSnapshot = useCallback((snapshotId: string | null) => {
    dispatch({ type: "select-snapshot", snapshotId });
  }, []);

  const handlePublishSnapshot = useCallback(
    (version: number) => {
      void handlePublishFromHistory(version);
    },
    [handlePublishFromHistory],
  );

  const handleDialogConfirmClick = useCallback(
    (changeLog: string) => {
      void handleDialogConfirm(changeLog);
    },
    [handleDialogConfirm],
  );

  const handleResetDialogOpenChange = useCallback((open: boolean) => {
    dispatch({ type: "set-reset-dialog", open });
  }, []);

  const handleResetClick = useCallback(() => {
    void handleReset();
  }, [handleReset]);

  return {
    activeSnapshotVersion,
    dialogMode,
    formId,
    formStatus,
    handleActivateSnapshot,
    handleDialogConfirmClick,
    handleHintChange,
    handleOpenResetDialog,
    handlePasswordChange,
    handlePasswordSave,
    handlePasswordToggle,
    handlePublishChanges,
    handlePublishFromHistory: handlePublishSnapshot,
    handlePublishAction,
    handleResetClick,
    handleResetDialogOpenChange,
    handleRestoreEdit,
    handleSaveDialogOpenChange: (open: boolean) => {
      if (!open) dispatch({ type: "close-save-dialog" });
    },
    handleSaveOnly,
    handleSelectSnapshot,
    hasActiveSnapshot,
    hasChangesFromActive,
    hasUnpublishedChanges,
    isArchived,
    isNotPublished,
    isPasswordUpdating,
    isProcessing,
    isPublished,
    lastPublishedVersion,
    passwordDirty,
    passwordHintInput,
    passwordInput,
    publishSectionState,
    unpublishedChangesState,
    passwordState,
    triggerState,
    historyState,
    showResetDialog,
    snapshots,
    totalChanges,
    unpublishedSection: hasUnpublishedChanges ? unpublishedChangesState : null,
    snapshotSaveConfirmLabel: getSnapshotSaveConfirmLabel(dialogMode),
  } as const;
}
