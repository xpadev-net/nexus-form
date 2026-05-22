import type { FC } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TriggerVisualState } from "./types";

interface TriggerContentProps {
  state: TriggerVisualState;
}

export const TriggerContent: FC<TriggerContentProps> = ({ state }) => {
  if (state.kind === "archived") {
    return (
      <>
        <span className="h-2 w-2 rounded-full bg-muted-foreground" />
        アーカイブ済み
      </>
    );
  }

  if (state.kind === "published") {
    return (
      <>
        <span className="h-2 w-2 rounded-full bg-green-500" />
        公開中
        {state.activeSnapshotVersion != null && (
          <Badge variant="secondary" className="font-mono text-xs ml-1">
            v{state.activeSnapshotVersion}
          </Badge>
        )}
      </>
    );
  }

  if (state.kind === "publishedWithChanges") {
    return (
      <>
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        {state.activeSnapshotVersion != null && (
          <Badge variant="secondary" className="font-mono text-xs mr-1">
            v{state.activeSnapshotVersion}
          </Badge>
        )}
        未公開の変更
      </>
    );
  }

  return (
    <>
      <span className="h-2 w-2 rounded-full bg-muted-foreground" />
      {state.kind === "unpublished" ? "非公開" : "未公開"}
      {state.activeSnapshotVersion != null && (
        <Badge variant="secondary" className="font-mono text-xs ml-1">
          v{state.activeSnapshotVersion}
        </Badge>
      )}
    </>
  );
};

interface ArchivedPublishButtonProps {
  state: TriggerVisualState;
}

export const ArchivedPublishButton: FC<ArchivedPublishButtonProps> = ({
  state,
}) => (
  <Button variant="outline" size="sm" disabled>
    <span className="flex items-center gap-1.5">
      <TriggerContent state={state} />
    </span>
  </Button>
);
