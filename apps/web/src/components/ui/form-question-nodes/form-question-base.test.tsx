// @vitest-environment jsdom

import type { ComponentType, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const plateState = vi.hoisted(
  (): { element: Record<string, unknown>; readOnly: boolean } => ({
    element: {
      type: "form_short_text",
      blockId: "question-1",
      children: [{ text: "" }],
    },
    readOnly: false,
  }),
);

vi.mock("platejs", () => ({
  ElementApi: {
    isElement: (node: unknown) =>
      typeof node === "object" && node !== null && "children" in node,
  },
}));

vi.mock(
  "@nexus-form/shared",
  () => ({
    isPlateQuestionType: (type: unknown) => type === "form_short_text",
  }),
);

vi.mock("platejs/react", () => ({
  PlateElement: ({
    children,
    className,
  }: {
    children?: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
  useElement: () => plateState.element,
  useReadOnly: () => plateState.readOnly,
}));

let collectText: (node: unknown) => string;
let FormQuestionElement: ComponentType<{ children?: ReactNode }>;

beforeAll(async () => {
  const formQuestionBase = await import("./form-question-base");
  collectText = formQuestionBase.collectText;
  FormQuestionElement =
    formQuestionBase.FormQuestionElement as unknown as ComponentType<{
      children?: ReactNode;
    }>;
});

function renderFormQuestionElement(element: Record<string, unknown>): {
  container: HTMLElement;
  root: Root;
} {
  plateState.element = element;
  const container = document.createElement("div");
  const root = createRoot(container);

  act(() => {
    root.render(
      <FormQuestionElement>
        <p>Question body</p>
      </FormQuestionElement>,
    );
  });

  return { container, root };
}

describe("collectText", () => {
  it("returns empty text for valid empty elements", () => {
    expect(collectText({ children: [{ text: "" }] })).toBe("");
  });

  it("collects text from valid nested elements", () => {
    expect(
      collectText({
        children: [
          { text: "Question " },
          { children: [{ text: "title" }] },
        ],
      }),
    ).toBe("Question title");
  });

  it("ignores malformed children and non-string text values", () => {
    expect(
      collectText({
        children: [
          { text: "Safe " },
          { text: 123 },
          { children: { text: "not an array" } },
          { children: [{ text: "title" }] },
        ],
      }),
    ).toBe("Safe title");
  });
});

describe("FormQuestionElement", () => {
  let mountedRoots: Root[];

  beforeEach(() => {
    mountedRoots = [];
    plateState.readOnly = false;
  });

  afterEach(() => {
    for (const root of mountedRoots) {
      act(() => root.unmount());
    }
  });

  it("renders placeholder without crashing when saved children are malformed", () => {
    const { container, root } = renderFormQuestionElement({
      type: "form_short_text",
      blockId: "question-1",
      children: { text: "not an array" },
    });
    mountedRoots.push(root);

    expect(container.textContent).toContain("質問タイトルを入力...");
  });

  it("keeps placeholder hidden for valid non-empty elements", () => {
    const { container, root } = renderFormQuestionElement({
      type: "form_short_text",
      blockId: "question-1",
      children: [{ text: "Question title" }],
    });
    mountedRoots.push(root);

    expect(container.textContent).not.toContain("質問タイトルを入力...");
  });
});
