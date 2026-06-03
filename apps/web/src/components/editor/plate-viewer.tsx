import { lazy, Suspense } from "react";

const LazyPlateViewerInternal = lazy(() =>
  import("./plate-viewer-internal").then((m) => ({
    default: m.PlateViewerInternal,
  })),
);

type Props = {
  value: string;
};

function PlateViewerLoadingFallback() {
  return (
    <div
      aria-hidden="true"
      className="space-y-3 p-4"
      data-testid="plate-viewer-loading"
    >
      <div className="h-4 w-2/3 rounded bg-muted" />
      <div className="h-4 w-full rounded bg-muted" />
      <div className="h-10 w-full rounded bg-muted/70" />
    </div>
  );
}

export function PlateViewer(props: Props) {
  return (
    <Suspense fallback={<PlateViewerLoadingFallback />}>
      <LazyPlateViewerInternal {...props} />
    </Suspense>
  );
}
