import type { FC } from "react";
import { PopoverContent } from "@/components/ui/popover";
import { PasswordProtectionSection } from "./password-protection-section";
import { PublishToggleSection } from "./publish-toggle-section";
import type {
  PasswordProtectionSectionState,
  PublishToggleAction,
  PublishToggleSectionState,
  UnpublishedChangesSectionState,
  VersionHistorySectionState,
} from "./types";
import { UnpublishedChangesSection } from "./unpublished-changes-section";
import { VersionHistorySection } from "./version-history-section";

interface PublishMenuPopoverContentProps {
  publishSectionState: PublishToggleSectionState;
  unpublishedSection: UnpublishedChangesSectionState | null;
  passwordState: PasswordProtectionSectionState;
  historyState: VersionHistorySectionState;
  onPublishAction: (action: PublishToggleAction) => void;
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

export const PublishMenuPopoverContent: FC<PublishMenuPopoverContentProps> = ({
  publishSectionState,
  unpublishedSection,
  passwordState,
  historyState,
  onPublishAction,
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
}) => {
  return (
    <PopoverContent align="end" className="w-80 p-0">
      <PublishToggleSection
        state={publishSectionState}
        onAction={onPublishAction}
      />

      {unpublishedSection && (
        <UnpublishedChangesSection
          state={unpublishedSection}
          onPublishChanges={onPublishChanges}
          onSaveOnly={onSaveOnly}
          onReset={onReset}
        />
      )}

      <PasswordProtectionSection
        state={passwordState}
        onToggle={onPasswordToggle}
        onPasswordChange={onPasswordChange}
        onHintChange={onHintChange}
        onSave={onPasswordSave}
      />

      <VersionHistorySection
        state={historyState}
        onSelect={onSelectSnapshot}
        onActivate={onActivateSnapshot}
        onPublish={onPublishSnapshot}
        onRestore={onRestoreSnapshot}
        onSaveSnapshot={onSaveOnly}
      />
    </PopoverContent>
  );
};
