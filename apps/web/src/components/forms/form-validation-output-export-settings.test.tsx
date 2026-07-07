// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormValidationOutputExportSettings } from "./form-validation-output-export-settings";

type MutationOptions = {
  mutationFn: () => Promise<unknown>;
  onError?: (error: Error) => void;
  onSuccess?: () => Promise<void> | void;
};

const mocks = vi.hoisted(() => ({
  getRequest: vi.fn(() => ({ kind: "get" })),
  invalidateQueries: vi.fn(),
  patchRequest: vi.fn((payload: unknown) => ({
    kind: "patch",
    payload,
  })),
  refetch: vi.fn(),
  rpc: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

let queryState: {
  data?: {
    values: Array<{
      rule_id: string;
      rule_name: string;
      provider_name: string;
      rule_type: string;
      output_key: string;
      label: string;
      enabled: boolean;
      source: "builtin" | "result" | "saved";
    }>;
  };
  isError?: boolean;
  isLoading?: boolean;
};
let mutationPending = false;

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: MutationOptions) => ({
    isPending: mutationPending,
    mutate: () => {
      void options
        .mutationFn()
        .then(() => options.onSuccess?.())
        .catch((error) =>
          options.onError?.(
            error instanceof Error ? error : new Error("mutation failed"),
          ),
        );
    },
  }),
  useQuery: () => ({
    data: queryState.data,
    isError: queryState.isError ?? false,
    isLoading: queryState.isLoading ?? false,
    refetch: mocks.refetch,
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
            "validation-output-export": {
              $get: mocks.getRequest,
              $patch: mocks.patchRequest,
            },
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
  FileOutput: () => <span data-icon="file-output" />,
  Loader2: () => <span data-icon="loader" />,
  Save: () => <span data-icon="save" />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    type = "button",
    ...props
  }: ComponentProps<"button"> & {
    size?: string;
    variant?: string;
  }) => (
    <button {...props} type={type}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: ComponentProps<"label">) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked = false,
    onCheckedChange,
    ...props
  }: Omit<ComponentProps<"button">, "onChange"> & {
    checked?: boolean;
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

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderSettings(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<FormValidationOutputExportSettings formId="form-1" />);
  });
  return root;
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

describe("FormValidationOutputExportSettings", () => {
  beforeEach(() => {
    queryState = {
      data: {
        values: [
          {
            rule_id: "rule-1",
            rule_name: "GitHub account",
            provider_name: "github",
            rule_type: "user_exists",
            output_key: "username",
            label: "GitHub username",
            enabled: true,
            source: "builtin",
          },
          {
            rule_id: "rule-1",
            rule_name: "GitHub account",
            provider_name: "github",
            rule_type: "user_exists",
            output_key: "followers",
            label: "Followers",
            enabled: false,
            source: "result",
          },
          {
            rule_id: "deleted-rule",
            rule_name: "deleted-rule",
            provider_name: "unknown",
            rule_type: "unknown",
            output_key: "legacy_score",
            label: "Legacy Score",
            enabled: true,
            source: "saved",
          },
        ],
      },
    };
    mutationPending = false;
    mocks.getRequest.mockClear();
    mocks.invalidateQueries.mockReset();
    mocks.patchRequest.mockClear();
    mocks.refetch.mockReset();
    mocks.rpc.mockReset();
    mocks.rpc.mockImplementation(async (request: { kind?: string }) =>
      request.kind === "get" ? queryState.data : {},
    );
    mocks.toast.error.mockReset();
    mocks.toast.success.mockReset();
  });

  it("renders grouped output value toggles including saved unknown keys", () => {
    const container = document.createElement("div");
    const root = renderSettings(container);

    expect(container.textContent).toContain("検証結果の出力");
    expect(container.textContent).toContain("GitHub account");
    expect(container.textContent).toContain("github / user_exists");
    expect(container.textContent).toContain("GitHub username");
    expect(container.textContent).toContain("Followers");
    expect(container.textContent).toContain("Legacy Score");
    expect(container.textContent).toContain("保存済み設定");
    expect(
      container
        .querySelector("#validation-output-export-rule-1-username")
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      container
        .querySelector("#validation-output-export-rule-1-followers")
        ?.getAttribute("aria-checked"),
    ).toBe("false");

    act(() => root.unmount());
  });

  it("saves independent per-rule output toggles", async () => {
    const container = document.createElement("div");
    const root = renderSettings(container);

    click(container.querySelector("#validation-output-export-rule-1-username"));
    click(
      container.querySelector("#validation-output-export-rule-1-followers"),
    );
    submit(
      container.querySelector<HTMLFormElement>(
        "#validation-output-export-settings",
      ),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const patchPayload = mocks.patchRequest.mock.calls[0]?.[0];
    expect(patchPayload).toMatchObject({
      param: { id: "form-1" },
      json: {
        values: [
          {
            rule_id: "rule-1",
            provider_name: "github",
            rule_type: "user_exists",
            output_key: "username",
            enabled: false,
          },
          {
            rule_id: "rule-1",
            provider_name: "github",
            rule_type: "user_exists",
            output_key: "followers",
            enabled: true,
          },
          {
            rule_id: "deleted-rule",
            provider_name: "unknown",
            rule_type: "unknown",
            output_key: "legacy_score",
            enabled: true,
          },
        ],
      },
    });
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "検証結果の出力設定を保存しました",
    );
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["validationOutputExportSettings", "form-1"],
    });

    act(() => root.unmount());
  });

  it("preserves fetched disabled values when saving without local changes", async () => {
    const container = document.createElement("div");
    const root = renderSettings(container);

    submit(
      container.querySelector<HTMLFormElement>(
        "#validation-output-export-settings",
      ),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const patchPayload = mocks.patchRequest.mock.calls[0]?.[0];
    expect(patchPayload).toMatchObject({
      json: {
        values: [
          {
            output_key: "username",
            enabled: true,
          },
          {
            output_key: "followers",
            enabled: false,
          },
          {
            output_key: "legacy_score",
            enabled: true,
          },
        ],
      },
    });

    act(() => root.unmount());
  });

  it("disables value toggles while saving", () => {
    mutationPending = true;
    const container = document.createElement("div");
    const root = renderSettings(container);

    expect(
      container
        .querySelector("#validation-output-export-rule-1-username")
        ?.hasAttribute("disabled"),
    ).toBe(true);
    expect(
      container
        .querySelector("#validation-output-export-rule-1-followers")
        ?.hasAttribute("disabled"),
    ).toBe(true);

    act(() => root.unmount());
  });

  it("shows an empty state before output values are discovered", () => {
    queryState = { data: { values: [] } };
    const container = document.createElement("div");
    const root = renderSettings(container);

    expect(container.textContent).toContain(
      "出力できる検証結果の値はまだありません",
    );
    expect(
      container
        .querySelector("button[type='submit']")
        ?.hasAttribute("disabled"),
    ).toBe(true);

    act(() => root.unmount());
  });
});
