// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormAppearance } from "@/types/validation/form";
import { FormAppearanceSettings } from "./form-appearance-settings";

type MutationOptions<TInput> = {
  mutationFn: (input: TInput) => Promise<unknown>;
  onError?: (error: Error) => void;
  onSuccess?: () => Promise<void> | void;
};

const mocks = vi.hoisted(() => ({
  getRequest: vi.fn(() => ({ kind: "get" })),
  invalidateQueries: vi.fn(),
  putRequest: vi.fn((payload: unknown) => ({ kind: "put", payload })),
  rpc: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

let structureData: {
  structure: {
    version: number;
    settings: { require_fingerprint: boolean };
    appearance?: FormAppearance;
  };
};

vi.mock("@tanstack/react-query", () => ({
  useMutation: <TInput,>(options: MutationOptions<TInput>) => ({
    isPending: false,
    mutate: (input: TInput) => {
      void options
        .mutationFn(input)
        .then(() => options.onSuccess?.())
        .catch((error) =>
          options.onError?.(
            error instanceof Error ? error : new Error("mutation failed"),
          ),
        );
    },
  }),
  useQuery: () => ({
    data: structureData,
    isLoading: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock("@/lib/api", () => ({
  client: {
    api: {
      forms: {
        ":id": {
          structure: {
            $get: mocks.getRequest,
            $put: mocks.putRequest,
          },
        },
      },
    },
  },
  rpc: mocks.rpc,
}));

vi.mock("sonner", () => ({
  toast: mocks.toast,
}));

vi.mock("lucide-react", () => ({
  AlertTriangle: () => <span data-icon="alert" />,
  ChevronDownIcon: () => <span data-icon="chevron-down" />,
  Laptop: () => <span data-icon="laptop" />,
  Palette: () => <span data-icon="palette" />,
  Save: () => <span data-icon="save" />,
  Smartphone: () => <span data-icon="smartphone" />,
}));

vi.mock("./form-body", () => ({
  FormBody: ({ appearance }: { appearance: FormAppearance }) => (
    <div
      data-testid="appearance-preview"
      data-primary={appearance.theme.primary_color}
      data-question-numbers={
        appearance.layout.show_question_numbers ? "shown" : "hidden"
      }
    />
  ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked = false,
    onCheckedChange,
    ...props
  }: {
    checked?: boolean;
    id?: string;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <button
      {...props}
      aria-checked={checked}
      role="switch"
      type="button"
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    type = "button",
    ...props
  }: {
    children: ReactNode;
    type?: "button" | "submit";
    [key: string]: unknown;
  }) => (
    <button {...props} type={type}>
      {children}
    </button>
  ),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderSettings(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <FormAppearanceSettings
        formId="form-1"
        formTitle="Preview form"
        formDescription="Preview description"
        plateContent="[]"
      />,
    );
  });
  return root;
}

function setInputValue(input: HTMLInputElement | null, value: string) {
  expect(input).not.toBeNull();
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;

  act(() => {
    valueSetter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    input?.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function click(element: Element | null) {
  expect(element).not.toBeNull();
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function submit(element: HTMLFormElement | null) {
  expect(element).not.toBeNull();
  act(() => {
    element?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("FormAppearanceSettings", () => {
  beforeEach(() => {
    structureData = {
      structure: {
        version: 1,
        settings: { require_fingerprint: true },
        appearance: {
          theme: {
            primary_color: "#ffffff",
            accent_color: "#ffffff",
            background_color: "#ffffff",
            font_family: "Inter",
          },
          layout: {
            width: "medium",
            alignment: "center",
            spacing: "comfortable",
            show_progress_bar: true,
            progress_position: "top",
            show_question_numbers: true,
          },
        },
      },
    };
    mocks.getRequest.mockClear();
    mocks.invalidateQueries.mockReset();
    mocks.putRequest.mockClear();
    mocks.rpc.mockReset();
    mocks.rpc.mockImplementation(async (request: { kind?: string }) =>
      request.kind === "get" ? structureData : {},
    );
    mocks.toast.error.mockReset();
    mocks.toast.success.mockReset();
  });

  it("shows snapshot scope guidance and mobile desktop preview controls", () => {
    const container = document.createElement("div");
    const root = renderSettings(container);

    expect(container.textContent).toContain("structure.appearance");
    expect(
      container.querySelector("[data-preview-viewport='desktop']"),
    ).not.toBeNull();

    click(container.querySelector("[aria-label='モバイル幅でプレビュー']"));

    expect(
      container.querySelector("[data-preview-viewport='mobile']"),
    ).not.toBeNull();

    act(() => root.unmount());
  });

  it("updates the live preview immediately and warns on low contrast", () => {
    const container = document.createElement("div");
    const root = renderSettings(container);

    expect(container.textContent).toContain("配色の警告");
    setInputValue(
      container.querySelector<HTMLInputElement>("#appearance-primary-color"),
      "#111111",
    );

    expect(
      container
        .querySelector("[data-testid='appearance-preview']")
        ?.getAttribute("data-primary"),
    ).toBe("#111111");

    act(() => root.unmount());
  });

  it("saves appearance into the form structure", async () => {
    const container = document.createElement("div");
    const root = renderSettings(container);

    setInputValue(
      container.querySelector<HTMLInputElement>("#appearance-primary-color"),
      "#111111",
    );
    submit(
      container.querySelector<HTMLFormElement>("#form-appearance-settings"),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const putPayload = mocks.putRequest.mock.calls[0]?.[0];
    expect(putPayload).toMatchObject({
      json: {
        changeLog: "Update appearance settings",
        structure: {
          appearance: {
            theme: {
              primary_color: "#111111",
            },
          },
        },
      },
      param: { id: "form-1" },
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("外観設定を保存しました");

    act(() => root.unmount());
  });
});
