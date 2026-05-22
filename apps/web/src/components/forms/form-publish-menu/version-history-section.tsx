import { History, Save } from "lucide-react";
import type { FC } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { SnapshotGraph } from "../snapshot-graph";
import type { VersionHistorySectionState } from "./types";

interface VersionHistorySectionProps {
  state: VersionHistorySectionState;
  onSelect: (id: string | null) => void;
  onActivate: (version: number) => void;
  onPublish: (version: number) => void;
  onRestore: (version: number) => void;
  onSaveSnapshot: () => void;
}

export const VersionHistorySection: FC<VersionHistorySectionProps> = ({
  state,
  onSelect,
  onActivate,
  onPublish,
  onRestore,
  onSaveSnapshot,
}) => {
  return (
    <>
      <Separator />
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <History className="h-4 w-4" />
          バージョン履歴
        </div>
        {state.snapshots.length === 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              スナップショットがまだ作成されていません
            </p>
            {!state.hasUnpublishedChanges && (
              <Button
                variant="outline"
                size="sm"
                className="w-full h-7 text-xs"
                disabled={state.isMutating}
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
              snapshots={state.snapshots}
              selectedId={state.selectedSnapshotId}
              onSelect={onSelect}
              isMutating={state.isMutating}
              isNotPublished={state.isNotPublished}
              onActivate={onActivate}
              onPublish={onPublish}
              onRestore={onRestore}
            />
          </ScrollArea>
        )}
      </div>
    </>
  );
};
