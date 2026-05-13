import { Redo2Icon, Undo2Icon } from "lucide-react";
import { useEditorRef, useEditorSelector } from "platejs/react";
import type { ComponentProps } from "react";

import { ToolbarButton } from "./toolbar";

const isMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";

export function RedoToolbarButton(
  props: ComponentProps<typeof ToolbarButton>,
) {
  const editor = useEditorRef();
  const disabled = useEditorSelector(
    (editor) => editor.history.redos.length === 0,
    [],
  );

  return (
    <ToolbarButton
      {...props}
      disabled={disabled}
      onClick={() => editor.redo()}
      onMouseDown={(e) => e.preventDefault()}
      tooltip={`Redo (${modKey}+Shift+Z)`}
    >
      <Redo2Icon />
    </ToolbarButton>
  );
}

export function UndoToolbarButton(
  props: ComponentProps<typeof ToolbarButton>,
) {
  const editor = useEditorRef();
  const disabled = useEditorSelector(
    (editor) => editor.history.undos.length === 0,
    [],
  );

  return (
    <ToolbarButton
      {...props}
      disabled={disabled}
      onClick={() => editor.undo()}
      onMouseDown={(e) => e.preventDefault()}
      tooltip={`Undo (${modKey}+Z)`}
    >
      <Undo2Icon />
    </ToolbarButton>
  );
}
