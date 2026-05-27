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
type PasswordDialogMode = "enable" | "change";

export interface FormPublishMenuProps {
  formId: string;
  formStatus: FormStatus;
  onStatusChange?: () => void;
  onResetSuccess?: () => void;
}

interface PublishMenuState {
  dialogMode: DialogMode;
  showResetDialog: boolean;
  showPasswordDialog: boolean;
  passwordDialogMode: PasswordDialogMode | null;
  selectedSnapshotId: string | null;
  passwordInput: string;
  passwordHintInput: string;
  passwordDirty: boolean;
  snapshotSaveError: string | null;
  passwordDialogError: string | null;
}

type PublishMenuAction =
  | { type: "open-save-dialog"; mode: Exclude<DialogMode, null> }
  | { type: "close-save-dialog" }
  | { type: "set-reset-dialog"; open: boolean }
  | { type: "open-password-dialog"; mode: PasswordDialogMode }
  | { type: "close-password-dialog"; hintInput: string }
  | { type: "set-password-dialog-error"; error: string | null }
  | { type: "select-snapshot"; snapshotId: string | null }
  | { type: "set-password-input"; value: string }
  | { type: "set-password-hint"; value: string }
  | { type: "sync-password-hint"; value: string }
  | { type: "complete-password-edit"; hintInput: string }
  | { type: "set-snapshot-save-error"; error: string | null };

const initialPublishMenuState: PublishMenuState = {
  dialogMode: null,
  showResetDialog: false,
  showPasswordDialog: false,
  passwordDialogMode: null,
  selectedSnapshotId: null,
  passwordInput: "",
  passwordHintInput: "",
  passwordDirty: false,
  snapshotSaveError: null,
  passwordDialogError: null,
};

const publishMenuReducer = (
  state: PublishMenuState,
  action: PublishMenuAction,
): PublishMenuState => {
  switch (action.type) {
    case "open-save-dialog":
      return { ...state, dialogMode: action.mode, snapshotSaveError: null };
    case "close-save-dialog":
      return { ...state, dialogMode: null, snapshotSaveError: null };
    case "set-reset-dialog":
      return { ...state, showResetDialog: action.open };
    case "open-password-dialog":
      return {
        ...state,
        showPasswordDialog: true,
        passwordDialogMode: action.mode,
        passwordDialogError: null,
      };
    case "close-password-dialog":
      return {
        ...state,
        showPasswordDialog: false,
        passwordDialogError: null,
        passwordDialogMode: null,
        passwordInput: "",
        passwordHintInput: action.hintInput,
        passwordDirty: false,
      };
    case "set-password-dialog-error":
      return { ...state, passwordDialogError: action.error };
    case "select-snapshot":
      return { ...state, selectedSnapshotId: action.snapshotId };
    case "set-password-input":
      return {
        ...state,
        passwordInput: action.value,
        passwordDirty: true,
        passwordDialogError: null,
      };
    case "set-password-hint":
      return {
        ...state,
        passwordHintInput: action.value,
        passwordDirty: true,
        passwordDialogError: null,
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
    case "set-snapshot-save-error":
      return { ...state, snapshotSaveError: action.error };
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
    showPasswordDialog,
    passwordDialogMode,
    selectedSnapshotId,
    passwordInput,
    passwordHintInput,
    snapshotSaveError,
    passwordDialogError,
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

  const unpublishedSection: UnpublishedChangesSectionState | null =
    hasUnpublishedChanges
      ? {
          publishState: isPublished ? "published" : "unpublished",
          actionState: isProcessing ? "processing" : "idle",
          totalChanges,
          hasChangesFromActive,
          activeSnapshotVersion,
        }
      : null;

  const passwordState: PasswordProtectionSectionState = {
    isEnabled: passwordProtection.enabled,
    hasPassword: passwordProtection.hasPassword,
    updateState: isPasswordUpdating ? "processing" : "idle",
    publishActionState: isProcessing ? "processing" : "idle",
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
        const message =
          error instanceof Error ? error.message : "Unknown error";
        toast.error(`処理に失敗しました: ${message}`);
        dispatch({ type: "set-snapshot-save-error", error: message });
      }
    },
    [dialogMode, onStatusChange, saveAndActivate, saveAndPublish, saveSnapshot],
  );

  const publishAction = useCallback(
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

  const publishFromHistory = useCallback(
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
    if (!checked) {
      updatePasswordProtection.mutate(
        { enabled: false },
        {
          onSuccess: () => {
            toast.success("パスワード保護を無効にしました");
            dispatch({
              type: "complete-password-edit",
              hintInput: passwordHintInput,
            });
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
      return;
    }

    dispatch({ type: "open-password-dialog", mode: "enable" });
  };

  const handlePasswordDialogOpen = (mode: PasswordDialogMode) => {
    dispatch({ type: "open-password-dialog", mode });
  };

  const handlePasswordDialogClose = () => {
    dispatch({
      type: "close-password-dialog",
      hintInput: passwordProtection.password_hint ?? "",
    });
  };

  const handlePasswordDialogConfirm = () => {
    const action = passwordDialogMode ?? "change";
    const enabled = action === "enable" ? true : passwordProtection.enabled;
    const hasNewPassword = passwordInput.length > 0;
    const payload = {
      enabled,
      password: hasNewPassword ? passwordInput : undefined,
      password_hint: passwordHintInput,
    };

    if (enabled && !passwordProtection.hasPassword && !hasNewPassword) {
      const message = "パスワードを設定してから有効にしてください";
      dispatch({ type: "set-password-dialog-error", error: message });
      toast.error(message);
      return;
    }

    if (hasNewPassword && passwordInput.length < 8) {
      const message = "パスワードは8文字以上で入力してください";
      dispatch({ type: "set-password-dialog-error", error: message });
      toast.error(message);
      return;
    }

    updatePasswordProtection.mutate(payload, {
      onSuccess: () => {
        toast.success(
          action === "enable"
            ? "パスワード保護を有効にしました"
            : "パスワードを更新しました",
        );
        dispatch({
          type: "complete-password-edit",
          hintInput: passwordHintInput,
        });
        dispatch({
          type: "close-password-dialog",
          hintInput: passwordHintInput,
        });
      },
      onError: (error) => {
        const message =
          error instanceof Error
            ? error.message
            : "パスワードの更新に失敗しました";
        dispatch({
          type: "set-password-dialog-error",
          error: message,
        });
        toast.error(message);
      },
    });
  };

  const handlePasswordDialogOpenChange = (open: boolean) => {
    if (!open) {
      handlePasswordDialogClose();
      return;
    }
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

  const handlePasswordInputChange = useCallback((value: string) => {
    dispatch({ type: "set-password-input", value });
  }, []);

  const handlePasswordHintChange = useCallback((value: string) => {
    dispatch({ type: "set-password-hint", value });
  }, []);

  const handleSelectSnapshot = useCallback((snapshotId: string | null) => {
    dispatch({ type: "select-snapshot", snapshotId });
  }, []);

  const handlePublishFromHistory = useCallback(
    (version: number) => {
      void publishFromHistory(version);
    },
    [publishFromHistory],
  );

  const handleDialogConfirmClick = useCallback(
    (changeLog: string) => {
      void handleDialogConfirm(changeLog);
    },
    [handleDialogConfirm],
  );

  const handleSaveDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      dispatch({ type: "close-save-dialog" });
    }
  }, []);

  const handleResetDialogOpenChange = useCallback((open: boolean) => {
    dispatch({ type: "set-reset-dialog", open });
  }, []);

  const handleResetClick = useCallback(() => {
    void handleReset();
  }, [handleReset]);

  const handlePublishAction = useCallback(
    (action: PublishToggleAction) => {
      void publishAction(action);
    },
    [publishAction],
  );

  return {
    activeSnapshotVersion,
    dialogMode,
    formId,
    handleActivateSnapshot,
    handleDialogConfirmClick,
    handlePasswordHintChange,
    handleOpenResetDialog,
    handlePasswordInputChange,
    handlePasswordDialogOpen,
    handlePasswordDialogConfirm,
    handlePasswordDialogOpenChange,
    handlePasswordDialogClose,
    handlePasswordToggle,
    handlePublishChanges,
    handlePublishFromHistory,
    handlePublishAction,
    handleResetClick,
    handleResetDialogOpenChange,
    handleRestoreEdit,
    handleSaveDialogOpenChange,
    handleSaveOnly,
    handleSelectSnapshot,
    hasUnpublishedChanges,
    isPasswordUpdating,
    isArchived,
    isProcessing,
    lastPublishedVersion,
    passwordHintInput,
    passwordInput,
    passwordState,
    publishSectionState,
    passwordDialogError,
    showPasswordDialog,
    passwordDialogMode,
    triggerState,
    historyState,
    showResetDialog,
    snapshotSaveError,
    totalChanges,
    unpublishedSection,
    snapshotSaveConfirmLabel: getSnapshotSaveConfirmLabel(dialogMode),
  } as const;
}
