export type PublishState = "published" | "unpublished";
export type PublishProcessState = "idle" | "processing";
export type SnapshotAvailability = "available" | "missing";
export type DraftStatus = "draft" | "published-or-archived";

export type PublishToggleAction = "publish" | "unpublish";

export type PublishToggleSectionState =
  | {
      kind: "idle";
      mode: PublishState;
      activeSnapshotVersion: number | null;
    }
  | {
      kind: "processing";
      mode: PublishState;
      activeSnapshotVersion: number | null;
    }
  | {
      kind: "needsSnapshot";
      activeSnapshotVersion: number | null;
    };

export interface PublishToggleSectionInputState {
  publishState: PublishState;
  processingState: PublishProcessState;
  snapshotState: SnapshotAvailability;
  draftStatus: DraftStatus;
  activeSnapshotVersion: number | null;
}

export const getPublishToggleSectionState = ({
  publishState,
  processingState,
  snapshotState,
  draftStatus,
  activeSnapshotVersion,
}: PublishToggleSectionInputState): PublishToggleSectionState => {
  if (processingState === "processing") {
    return {
      kind: "processing",
      mode: publishState,
      activeSnapshotVersion,
    };
  }

  if (snapshotState === "missing" && draftStatus === "draft") {
    return {
      kind: "needsSnapshot",
      activeSnapshotVersion,
    };
  }

  return {
    kind: "idle",
    mode: publishState,
    activeSnapshotVersion,
  };
};

export interface UnpublishedChangesSectionState {
  publishState: PublishState;
  actionState: PublishProcessState;
  totalChanges: number;
  hasChangesFromActive: boolean;
  hasPasswordProtectionChanges: boolean;
  activeSnapshotVersion: number | null;
  nextSnapshotVersion: number;
}

export interface PasswordProtectionPublicationSnapshot {
  enabled: boolean;
  hasPassword: boolean;
  password_hint?: string;
}

export interface PasswordProtectionSectionState {
  isEnabled: boolean;
  hasPassword: boolean;
  current: PasswordProtectionPublicationSnapshot;
  published: PasswordProtectionPublicationSnapshot | null;
  hasUnpublishedChanges: boolean;
  updateState: PublishProcessState;
  publishActionState: PublishProcessState;
}

export interface SnapshotItem {
  id: string;
  version: number;
  parentVersion?: number | null;
  isActive: boolean;
  publishedAt: string;
  changeLog?: string | null;
}

export interface VersionHistorySectionState {
  snapshots: SnapshotItem[];
  selectedSnapshotId: string | null;
  isMutating: boolean;
  isNotPublished: boolean;
  hasUnpublishedChanges: boolean;
}

export type TriggerVisualState =
  | { kind: "archived" }
  | { kind: "published"; activeSnapshotVersion: number | null }
  | {
      kind: "publishedWithChanges";
      activeSnapshotVersion: number | null;
    }
  | { kind: "unpublished"; activeSnapshotVersion: number | null }
  | { kind: "draft"; activeSnapshotVersion: number | null };

export const getTriggerVisualState = (
  formStatus: "DRAFT" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED",
  hasUnpublishedChanges: boolean,
  activeSnapshotVersion: number | null,
): TriggerVisualState => {
  if (formStatus === "ARCHIVED") {
    return { kind: "archived" };
  }

  if (formStatus === "PUBLISHED" && hasUnpublishedChanges) {
    return {
      kind: "publishedWithChanges",
      activeSnapshotVersion,
    };
  }

  if (formStatus === "PUBLISHED") {
    return {
      kind: "published",
      activeSnapshotVersion,
    };
  }

  if (formStatus === "UNPUBLISHED") {
    return {
      kind: "unpublished",
      activeSnapshotVersion,
    };
  }

  return {
    kind: "draft",
    activeSnapshotVersion,
  };
};
