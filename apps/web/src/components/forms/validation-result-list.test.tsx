// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationResultList } from "./validation-result-list";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type MutationOptions = {
  onError?: (error: unknown) => void;
  onSuccess?: () => void;
};

type ValidationStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "MISSING"
  | null;

type ValidationItem = {
  error_message: string | null;
  error_code?: string | null;
  id: string;
  provider_name: string;
  referenced_block_id: string;
  referenced_block_label: string | null;
  referenced_block_missing: boolean;
  rule_id: string;
  rule_name: string;
  rule_type: string;
  service: string | null;
  status: ValidationStatus;
  success: boolean | null;
  output_values?: Array<{ key: string; label?: string; value: string }>;
  metadata?: unknown;
};

const mocks = vi.hoisted(
  (): {
    cancelValidationMutate: ReturnType<typeof vi.fn>;
    retryResponseValidationMutate: ReturnType<typeof vi.fn>;
    toastError: ReturnType<typeof vi.fn>;
    toastSuccess: ReturnType<typeof vi.fn>;
    validationResultsRefetch: ReturnType<typeof vi.fn>;
    validations: ValidationItem[];
  } => ({
    cancelValidationMutate: vi.fn(),
    retryResponseValidationMutate: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    validationResultsRefetch: vi.fn(),
    validations: [],
  }),
);

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/hooks/forms/use-validation-results", () => ({
  useValidationResults: () => ({
    cancelValidationMutation: {
      isPending: false,
      mutate: mocks.cancelValidationMutate,
    },
    retryResponseValidationMutation: {
      isPending: false,
      mutate: mocks.retryResponseValidationMutate,
    },
    validationResultsQuery: {
      isLoading: false,
      refetch: mocks.validationResultsRefetch,
    },
    validations: mocks.validations,
  }),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement> & {
    children: ReactNode;
  }) => <span {...props}>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
  }) => <button {...props}>{children}</button>,
}));

function createValidation(
  status: ValidationStatus = "PENDING",
): ValidationItem {
  return {
    error_message: null,
    id: "validation-result-1",
    provider_name: "discord",
    referenced_block_id: "question-1",
    referenced_block_label: "Discord ID",
    referenced_block_missing: false,
    rule_id: "rule-1",
    rule_name: "Discord membership",
    rule_type: "discord_member",
    service: "discord",
    status,
    success: null,
  };
}

function renderList(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <ValidationResultList formId="form-1" responseId="response-1" />,
    );
  });
  return root;
}

function findCancelButton(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === "キャンセル",
  );

  if (!button) {
    throw new Error("Cancel button was not rendered");
  }

  return button;
}

describe("ValidationResultList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validations = [createValidation()];
    mocks.validationResultsRefetch.mockResolvedValue(undefined);
  });

  it.each([
    [
      "409 conflict",
      "Validation result cannot be cancelled in its current status",
    ],
    ["403 forbidden", "You do not have access to this validation result"],
    ["network error", "Failed to fetch"],
  ])("shows the cancel failure reason for %s and refetches validation results", async (_caseName, message) => {
    mocks.cancelValidationMutate.mockImplementation(
      (_validationResultId: string, options?: MutationOptions) => {
        options?.onError?.(new Error(message));
      },
    );
    const container = document.createElement("div");
    const root = renderList(container);

    await act(async () => {
      findCancelButton(container).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(mocks.cancelValidationMutate).toHaveBeenCalledWith(
      "validation-result-1",
      expect.objectContaining({
        onError: expect.any(Function),
        onSuccess: expect.any(Function),
      }),
    );
    expect(mocks.toastError).toHaveBeenCalledWith(message);
    expect(mocks.validationResultsRefetch).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });

  it("shows the fallback cancel error message for non-Error failures", async () => {
    mocks.cancelValidationMutate.mockImplementation(
      (_validationResultId: string, options?: MutationOptions) => {
        options?.onError?.("cancel failed");
      },
    );
    const container = document.createElement("div");
    const root = renderList(container);

    await act(async () => {
      findCancelButton(container).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(mocks.toastError).toHaveBeenCalledWith("キャンセルに失敗しました");
    expect(mocks.validationResultsRefetch).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });

  it("displays explicit error_message when validation fails", () => {
    mocks.validations = [
      {
        ...createValidation("FAILED"),
        success: false,
        error_message: "Discord サーバーに参加していません",
      },
    ];

    const container = document.createElement("div");
    const root = renderList(container);

    const errorEl = container.querySelector(
      '[data-testid="validation-error-validation-result-1"]',
    );
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain(
      "Discord サーバーに参加していません",
    );

    act(() => root.unmount());
  });

  it("displays custom output values (custom fields)", () => {
    mocks.validations = [
      {
        ...createValidation("COMPLETED"),
        success: true,
        output_values: [
          { key: "username", label: "ユーザー名", value: "octocat" },
          { key: "roles", label: "ロール一覧", value: "Developer, Admin" },
        ],
      },
    ];

    const container = document.createElement("div");
    const root = renderList(container);

    const customFieldsEl = container.querySelector(
      '[data-testid="validation-custom-fields-validation-result-1"]',
    );
    expect(customFieldsEl).not.toBeNull();
    expect(customFieldsEl?.textContent).toContain("ユーザー名");
    expect(customFieldsEl?.textContent).toContain("octocat");
    expect(customFieldsEl?.textContent).toContain("ロール一覧");
    expect(customFieldsEl?.textContent).toContain("Developer, Admin");

    act(() => root.unmount());
  });

  it("displays custom output values extracted from metadata fallback", () => {
    mocks.validations = [
      {
        ...createValidation("COMPLETED"),
        success: true,
        metadata: {
          validationOutputs: [
            { key: "tenant_id", label: "テナントID", value: "tenant-99" },
          ],
        },
      },
    ];

    const container = document.createElement("div");
    const root = renderList(container);

    const customFieldsEl = container.querySelector(
      '[data-testid="validation-custom-fields-validation-result-1"]',
    );
    expect(customFieldsEl).not.toBeNull();
    expect(customFieldsEl?.textContent).toContain("テナントID");
    expect(customFieldsEl?.textContent).toContain("tenant-99");

    act(() => root.unmount());
  });
});
