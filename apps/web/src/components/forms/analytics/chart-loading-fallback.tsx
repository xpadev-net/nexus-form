import type { FC } from "react";

export const ChartLoadingFallback: FC = () => (
  <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-muted-foreground/25">
    <output aria-live="polite" className="text-sm text-muted-foreground">
      チャートを読み込み中...
    </output>
  </div>
);
