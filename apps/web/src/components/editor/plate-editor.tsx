import { lazy, Suspense } from "react";

const LazyPlateEditorInternal = lazy(() =>
  import("./plate-editor-internal").then((m) => ({
    default: m.PlateEditorInternal,
  })),
);

type Props = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
};

export function PlateEditor(props: Props) {
  return (
    <Suspense
      fallback={<div className="p-4 text-muted-foreground">読み込み中...</div>}
    >
      <LazyPlateEditorInternal {...props} />
    </Suspense>
  );
}
