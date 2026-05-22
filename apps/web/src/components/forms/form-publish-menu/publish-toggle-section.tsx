import { Globe } from "lucide-react";
import type { FC } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PublishToggleAction, PublishToggleSectionState } from "./types";

interface PublishToggleSectionProps {
  state: PublishToggleSectionState;
  onAction: (action: PublishToggleAction) => void;
}

export const PublishToggleSection: FC<PublishToggleSectionProps> = ({
  state,
  onAction,
}) => {
  const isPublished =
    state.kind !== "needsSnapshot" && state.mode === "published";
  const isBusy = state.kind !== "idle";
  const action: PublishToggleAction = isPublished ? "unpublish" : "publish";

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
          disabled={isBusy}
          onCheckedChange={() => onAction(action)}
        />
      </div>
      {state.kind === "needsSnapshot" && (
        <p className="text-xs text-muted-foreground pl-6">
          先にスナップショットを保存してください
        </p>
      )}
      {(state.kind === "needsSnapshot" || isPublished) &&
        state.activeSnapshotVersion != null && (
          <p className="text-xs text-muted-foreground pl-6">
            公開版: v{state.activeSnapshotVersion}
          </p>
        )}
    </div>
  );
};
