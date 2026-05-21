import { cn } from "@udecode/cn";
import {
  type CursorData,
  type CursorOverlayState,
  type SelectionRect,
  useCursorOverlay,
} from "@platejs/selection/react";
import type { FC } from "react";
import type { UnknownObject } from "platejs";

function getSelectionRectKey(rect: SelectionRect): string {
  return [
    rect.left,
    rect.top,
    rect.width,
    rect.height,
  ].join(":");
}

function getKeyedSelectionRects(selectionRects: SelectionRect[]) {
  const keyCounts = new Map<string, number>();

  return selectionRects.map((rect) => {
    const baseKey = getSelectionRectKey(rect);
    const occurrence = keyCounts.get(baseKey) ?? 0;
    keyCounts.set(baseKey, occurrence + 1);

    return {
      key: `${baseKey}:${occurrence}`,
      rect,
    };
  });
}

function Cursor<TCursorData extends UnknownObject>({
  caretPosition,
  data,
  selectionRects,
}: CursorOverlayState<TCursorData>) {
  const cursorColor =
    (data as CursorData | undefined)?.style?.backgroundColor ?? "#6366f1";

  return (
    <>
      {getKeyedSelectionRects(selectionRects).map(({ key, rect }) => (
        <div
          key={key}
          className="pointer-events-none absolute z-10 opacity-30"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            backgroundColor: cursorColor,
          }}
        />
      ))}
      {caretPosition && (
        <div
          className="pointer-events-none absolute z-10 w-0.5"
          style={{
            top: caretPosition.top,
            left: caretPosition.left,
            height: caretPosition.height,
            backgroundColor: cursorColor,
          }}
        />
      )}
    </>
  );
}

export const CursorOverlay: FC<{
  className?: string;
}> = ({ className }) => {
  const { cursors } = useCursorOverlay<CursorData>();

  return (
    <div
      className={cn("pointer-events-none absolute inset-0 z-50", className)}
    >
      {cursors.map((cursor) => (
        <Cursor key={cursor.id} {...cursor} />
      ))}
    </div>
  );
};
