// @vitest-environment jsdom

import { getByRole } from "@testing-library/dom";
import { BoldIcon, PlusIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  Toolbar,
  ToolbarButton,
  ToolbarSplitButton,
  ToolbarSplitButtonPrimary,
  ToolbarSplitButtonSecondary,
} from "./toolbar";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderToolbar(children: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(<Toolbar>{children}</Toolbar>);
  });

  return {
    container,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("Toolbar accessible names", () => {
  it("uses string tooltips as accessible names for icon-only toolbar controls", () => {
    const { cleanup, container } = renderToolbar(
      <>
        <ToolbarButton tooltip="Undo (⌘+Z)">
          <Undo2Icon />
        </ToolbarButton>
        <ToolbarButton tooltip="Redo (⌘+Shift+Z)">
          <Redo2Icon />
        </ToolbarButton>
        <ToolbarButton tooltip="Insert" isDropdown>
          <PlusIcon />
        </ToolbarButton>
        <ToolbarButton tooltip="Bold (⌘+B)" pressed={false}>
          <BoldIcon />
        </ToolbarButton>
      </>,
    );

    try {
      expect(
        getByRole(container, "button", { name: "Undo (⌘+Z)" }),
      ).toBeTruthy();
      expect(
        getByRole(container, "button", { name: "Redo (⌘+Shift+Z)" }),
      ).toBeTruthy();
      expect(getByRole(container, "button", { name: "Insert" })).toBeTruthy();
      expect(
        getByRole(container, "radio", { name: "Bold (⌘+B)" }),
      ).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  it("keeps explicit accessible names instead of replacing them with tooltip text", () => {
    const { cleanup, container } = renderToolbar(
      <ToolbarButton aria-label="Undo" tooltip="Undo (⌘+Z)">
        <Undo2Icon />
      </ToolbarButton>,
    );

    try {
      expect(getByRole(container, "button", { name: "Undo" })).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  it("exposes split toolbar actions and option triggers with distinct names", () => {
    const { cleanup, container } = renderToolbar(
      <ToolbarSplitButton pressed={false} tooltip="Bulleted list">
        <ToolbarSplitButtonPrimary>
          <PlusIcon />
        </ToolbarSplitButtonPrimary>
        <ToolbarSplitButtonSecondary aria-label="Bulleted list options" />
      </ToolbarSplitButton>,
    );

    try {
      expect(
        getByRole(container, "radio", { name: "Bulleted list" }),
      ).toBeTruthy();
      expect(
        getByRole(container, "button", { name: "Bulleted list options" }),
      ).toBeTruthy();
    } finally {
      cleanup();
    }
  });
});
