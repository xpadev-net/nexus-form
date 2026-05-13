import { lazy, Suspense } from "react";

const LazyPlateViewerInternal = lazy(() =>
  import("./plate-viewer-internal").then((m) => ({
    default: m.PlateViewerInternal,
  })),
);

type Props = {
  value: string;
};

export function PlateViewer(props: Props) {
  return (
    <Suspense
      fallback={<div className="p-4 text-muted-foreground">読み込み中...</div>}
    >
      <LazyPlateViewerInternal {...props} />
    </Suspense>
  );
}
