import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import type { FormPublishMenuProps } from "./form-publish-menu/form-publish-menu-model";
import { useFormPublishMenuModel } from "./form-publish-menu/form-publish-menu-model";
import { PasswordProtectionDialog } from "./form-publish-menu/password-protection-dialog";
import { PublishMenuPopoverContent } from "./form-publish-menu/publish-menu-popover-content";
import { ResetSnapshotDialog } from "./form-publish-menu/reset-snapshot-dialog";
import {
  ArchivedPublishButton,
  TriggerContent,
} from "./form-publish-menu/trigger-content";
import { SnapshotSaveDialog } from "./snapshot-save-dialog";

export function FormPublishMenu(props: FormPublishMenuProps) {
  const model = useFormPublishMenuModel(props);

  if (model.isArchived) {
    return <ArchivedPublishButton state={model.triggerState} />;
  }

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <span className="flex items-center gap-1.5">
              <TriggerContent state={model.triggerState} />
            </span>
            <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>

        <PublishMenuPopoverContent
          publishSectionState={model.publishSectionState}
          unpublishedSection={model.unpublishedSection}
          passwordState={model.passwordState}
          historyState={model.historyState}
          onPublishAction={model.handlePublishAction}
          onPublishChanges={model.handlePublishChanges}
          onSaveOnly={model.handleSaveOnly}
          onReset={model.handleOpenResetDialog}
          onPasswordToggle={model.handlePasswordToggle}
          onOpenPasswordDialog={model.handlePasswordDialogOpen}
          onSelectSnapshot={model.handleSelectSnapshot}
          onActivateSnapshot={model.handleActivateSnapshot}
          onPublishFromHistory={model.handlePublishFromHistory}
          onRestoreSnapshot={model.handleRestoreEdit}
        />
      </Popover>

      <SnapshotSaveDialog
        formId={model.formId}
        open={model.dialogMode !== null}
        onOpenChange={model.handleSaveDialogOpenChange}
        isProcessing={model.isProcessing}
        hasUnpublishedChanges={model.hasUnpublishedChanges}
        lastPublishedVersion={model.lastPublishedVersion}
        totalChanges={model.totalChanges}
        confirmLabel={model.snapshotSaveConfirmLabel}
        willPublish={model.snapshotSaveWillPublish}
        onConfirm={model.handleDialogConfirmClick}
        error={model.snapshotSaveError}
      />

      <ResetSnapshotDialog
        formId={model.formId}
        open={model.showResetDialog}
        activeSnapshotVersion={model.activeSnapshotVersion}
        totalChanges={model.totalChanges}
        isProcessing={model.isProcessing}
        onOpenChange={model.handleResetDialogOpenChange}
        onReset={model.handleResetClick}
      />

      <PasswordProtectionDialog
        open={model.showPasswordDialog}
        mode={model.passwordDialogMode ?? "change"}
        isProcessing={model.isPasswordUpdating}
        password={model.passwordInput}
        passwordHint={model.passwordHintInput}
        error={model.passwordDialogError}
        hasCurrentPassword={model.passwordState.hasPassword}
        onOpenChange={model.handlePasswordDialogOpenChange}
        onPasswordChange={model.handlePasswordInputChange}
        onHintChange={model.handlePasswordHintChange}
        onConfirm={model.handlePasswordDialogConfirm}
      />
    </>
  );
}
