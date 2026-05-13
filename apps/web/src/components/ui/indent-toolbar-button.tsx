import { useIndentButton, useOutdentButton } from "@platejs/indent/react";
import { IndentIcon, OutdentIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { ToolbarButton } from "./toolbar";

export function IndentToolbarButton(
  props: ComponentProps<typeof ToolbarButton>,
) {
  const { props: buttonProps } = useIndentButton();

  return (
    <ToolbarButton {...props} {...buttonProps} tooltip="Indent">
      <IndentIcon />
    </ToolbarButton>
  );
}

export function OutdentToolbarButton(
  props: ComponentProps<typeof ToolbarButton>,
) {
  const { props: buttonProps } = useOutdentButton();

  return (
    <ToolbarButton {...props} {...buttonProps} tooltip="Outdent">
      <OutdentIcon />
    </ToolbarButton>
  );
}
