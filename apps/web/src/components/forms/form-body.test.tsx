// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormResponseProvider } from "@/contexts/form-response-context";
import { FormBody } from "./form-body";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const plateViewerValues = vi.hoisted(() => [] as string[]);

vi.mock("@/components/editor/plate-viewer", () => ({
  PlateViewer: ({ value }: { value: string }) => {
    plateViewerValues.push(value);
    return <div data-testid="plate-viewer">{value}</div>;
  },
}));

function renderFormBody(container: HTMLElement, plateContent: string): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <FormResponseProvider>
        <FormBody
          title="公開フォーム"
          plateContent={plateContent}
          mode="public"
        />
      </FormResponseProvider>,
    );
  });
  return root;
}

describe("FormBody", () => {
  beforeEach(() => {
    plateViewerValues.length = 0;
  });

  it("excludes isolated slash and empty blocks from public viewer content", () => {
    const plateContent = JSON.stringify([
      { type: "p", children: [{ text: "/" }] },
      {
        type: "p",
        children: [{ type: "a", url: "/", children: [{ text: "/" }] }],
      },
      { type: "p", children: [{ text: "" }] },
      {
        type: "form_short_text",
        blockId: "question-1",
        validation: { type: "short_text", required: false },
        children: [{ type: "p", children: [{ text: "氏名" }] }],
      },
    ]);

    const container = document.createElement("div");
    const root = renderFormBody(container, plateContent);

    const renderedValue = plateViewerValues.at(-1);
    expect(renderedValue).toBeDefined();
    expect(JSON.parse(renderedValue ?? "[]")).toEqual([
      {
        type: "form_short_text",
        blockId: "question-1",
        validation: { type: "short_text", required: false },
        children: [{ type: "p", children: [{ text: "氏名" }] }],
      },
    ]);
    expect(container.textContent).not.toContain('text":"/"');

    act(() => root.unmount());
  });

  it("treats slash-only sanitized content as an empty form body", () => {
    const container = document.createElement("div");
    const root = renderFormBody(
      container,
      JSON.stringify([{ type: "p", children: [{ text: "/" }] }]),
    );

    expect(container.textContent).toContain("フォームの内容が空です。");
    expect(plateViewerValues).toEqual([]);

    act(() => root.unmount());
  });
});
