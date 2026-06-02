// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TElement } from "platejs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FormResponseProvider,
  useFormResponse,
} from "@/contexts/form-response-context";
import { DateInput } from "./form-date-node";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const plateState = vi.hoisted(() => ({
  element: {
    type: "form_date",
    blockId: "q-date",
    validation: {
      minDate: "2026-01-01",
      maxDate: "2026-06-30",
    },
    children: [{ text: "Date" }],
  },
}));

vi.mock("platejs", () => ({
  ElementApi: {
    isElement: (node: unknown) =>
      typeof node === "object" &&
      node !== null &&
      Array.isArray((node as { children?: unknown }).children),
  },
}));

vi.mock("platejs/react", () => ({
  PlateElement: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  useElement: () => plateState.element,
  useReadOnly: () => true,
}));

function AnswerProbe({ onValue }: { onValue: (value: unknown) => void }) {
  const { answers } = useFormResponse();
  onValue(answers.get("q-date")?.value);
  return null;
}

function renderDateNode(
  container: HTMLElement,
  onValue: (value: unknown) => void,
): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <FormResponseProvider>
        <DateInput element={plateState.element as TElement} />
        <AnswerProbe onValue={onValue} />
      </FormResponseProvider>,
    );
  });
  return root;
}

describe("FormDateElement", () => {
  beforeEach(() => {
    plateState.element = {
      type: "form_date",
      blockId: "q-date",
      validation: {
        minDate: "2026-01-01",
        maxDate: "2026-06-30",
      },
      children: [{ text: "Date" }],
    };
  });

  it("keeps date input and blur events synced to response state", async () => {
    const container = document.createElement("div");
    let latestValue: unknown;
    const root = renderDateNode(container, (value) => {
      latestValue = value;
    });

    const input = container.querySelector<HTMLInputElement>("input[type=date]");
    expect(input).not.toBeNull();

    await act(async () => {
      if (!input) return;
      input.value = "2026-06-15";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(latestValue).toBe("2026-06-15");

    await act(async () => {
      if (!input) return;
      input.value = "2026-06-20";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(latestValue).toBe("2026-06-20");

    await act(async () => {
      if (!input) return;
      input.value = "2026-06-25";
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(latestValue).toBe("2026-06-25");

    act(() => root.unmount());
  });

  it("marks date values outside configured range invalid without changing the stored value", async () => {
    const container = document.createElement("div");
    let latestValue: unknown;
    const root = renderDateNode(container, (value) => {
      latestValue = value;
    });

    const input = container.querySelector<HTMLInputElement>("input[type=date]");
    expect(input).not.toBeNull();

    await act(async () => {
      if (!input) return;
      input.value = "2026-07-01";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(latestValue).toBe("2026-07-01");
    expect(
      container
        .querySelector<HTMLInputElement>("input[type=date]")
        ?.getAttribute("aria-invalid"),
    ).toBe("true");

    act(() => root.unmount());
  });
});
