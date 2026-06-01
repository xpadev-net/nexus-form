// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormPublishMenu } from "./form-publish-menu";

type PasswordProtectionState = {
  enabled: boolean;
  hasPassword: boolean;
  password_hint?: string;
};

type UpdatePasswordProtectionParams = {
  enabled: boolean;
  password?: string;
  password_hint?: string;
};

type UpdatePasswordProtectionOptions = {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
};

const mocks = vi.hoisted(() => ({
  mutatePasswordProtection: vi.fn(),
  passwordProtection: {
    enabled: false,
    hasPassword: false,
  } as PasswordProtectionState,
  shouldFailPasswordUpdate: false,
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: mocks.toast,
}));

vi.mock("@/hooks/forms/use-form-access-control", () => ({
  useFormAccessControl: () => ({
    isLoading: false,
    isUpdating: false,
    passwordProtection: mocks.passwordProtection,
    updatePasswordProtection: {
      mutate: mocks.mutatePasswordProtection,
    },
  }),
}));

vi.mock("@/hooks/forms/use-form-publish-actions", () => ({
  useFormPublishActions: () => ({
    activeSnapshotVersion: 1,
    hasActiveSnapshot: true,
    hasChangesFromActive: false,
    hasUnpublishedChanges: false,
    isProcessing: false,
    lastPublishedVersion: 1,
    publishForm: vi.fn(),
    publishSnapshotMutation: { isPending: false },
    resetToActiveSnapshot: vi.fn(),
    saveAndActivate: vi.fn(),
    saveAndPublish: vi.fn(),
    saveSnapshot: vi.fn(),
    totalChanges: 0,
    unpublishForm: vi.fn(),
  }),
}));

vi.mock("@/hooks/forms/use-snapshots", () => ({
  useSnapshots: () => ({
    activateSnapshotMutation: {
      isPending: false,
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
    },
    restoreEditFromSnapshotMutation: {
      isPending: false,
      mutate: vi.fn(),
    },
    snapshotsQuery: {
      data: { snapshots: [] },
    },
  }),
}));

vi.mock("lucide-react", () => ({
  AlertCircle: () => <span data-icon="alert-circle" />,
  ChevronDown: () => <span data-icon="chevron-down" />,
  Globe: () => <span data-icon="globe" />,
  History: () => <span data-icon="history" />,
  KeyRound: () => <span data-icon="key-round" />,
  Lock: () => <span data-icon="lock" />,
  RotateCcw: () => <span data-icon="rotate-ccw" />,
  Save: () => <span data-icon="save" />,
  Upload: () => <span data-icon="upload" />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<"button"> & {
    size?: string;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: ReactNode;
    onOpenChange?: (open: boolean) => void;
    open: boolean;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    htmlFor: _htmlFor,
    ...props
  }: ComponentProps<"label">) => <span {...props}>{children}</span>,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked = false,
    onCheckedChange,
    size: _size,
    ...props
  }: Omit<ComponentProps<"button">, "onChange"> & {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    size?: string;
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

vi.mock("./snapshot-save-dialog", () => ({
  SnapshotSaveDialog: () => null,
}));

vi.mock("./form-publish-menu/reset-snapshot-dialog", () => ({
  ResetSnapshotDialog: () => null,
}));

vi.mock("./snapshot-graph", () => ({
  SnapshotGraph: () => <div data-testid="snapshot-graph" />,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderMenu(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<FormPublishMenu formId="form-1" formStatus="PUBLISHED" />);
  });
  return root;
}

function click(element: Element | null) {
  expect(element).not.toBeNull();
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
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

function passwordSwitch(container: HTMLElement): Element | null {
  return container.querySelector("button[id$='password-toggle']");
}

function submitPasswordDialog(container: HTMLElement) {
  const form = container.querySelector("form");
  expect(form).not.toBeNull();
  act(() => {
    form?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("FormPublishMenu password protection", () => {
  beforeEach(() => {
    mocks.passwordProtection = {
      enabled: false,
      hasPassword: false,
    };
    mocks.shouldFailPasswordUpdate = false;
    mocks.toast.error.mockReset();
    mocks.toast.success.mockReset();
    mocks.mutatePasswordProtection.mockReset();
    mocks.mutatePasswordProtection.mockImplementation(
      (
        params: UpdatePasswordProtectionParams,
        options?: UpdatePasswordProtectionOptions,
      ) => {
        if (mocks.shouldFailPasswordUpdate) {
          options?.onError?.(new Error("サーバーで保存できませんでした"));
          return;
        }

        mocks.passwordProtection = {
          enabled: params.enabled,
          hasPassword: params.enabled
            ? true
            : mocks.passwordProtection.hasPassword,
          password_hint:
            params.password_hint ?? mocks.passwordProtection.password_hint,
        };
        options?.onSuccess?.();
      },
    );
  });

  it("opens the password dialog when toggled on without saving immediately", () => {
    const container = document.createElement("div");
    const root = renderMenu(container);

    click(passwordSwitch(container));

    expect(container.querySelector("[role='dialog']")).not.toBeNull();
    expect(container.textContent).toContain("パスワード保護を有効化");
    expect(mocks.mutatePasswordProtection).not.toHaveBeenCalled();
    expect(passwordSwitch(container)?.getAttribute("aria-checked")).toBe(
      "false",
    );

    act(() => {
      root.unmount();
    });
  });

  it("rejects empty password enable attempts with dialog and toast errors", () => {
    const container = document.createElement("div");
    const root = renderMenu(container);

    click(passwordSwitch(container));
    submitPasswordDialog(container);

    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "パスワードを入力してから有効にしてください",
    );
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "パスワードを入力してから有効にしてください",
    );
    expect(mocks.mutatePasswordProtection).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("rejects whitespace-only password enable attempts with dialog and toast errors", () => {
    const container = document.createElement("div");
    const root = renderMenu(container);

    click(passwordSwitch(container));
    setInputValue(
      container.querySelector<HTMLInputElement>(
        "#password-protection-password",
      ),
      "        ",
    );
    submitPasswordDialog(container);

    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "パスワードを入力してから有効にしてください",
    );
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "パスワードを入力してから有効にしてください",
    );
    expect(mocks.mutatePasswordProtection).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("saves the password only after dialog confirmation and keeps it after a reload-equivalent rerender", () => {
    const container = document.createElement("div");
    const root = renderMenu(container);

    click(passwordSwitch(container));
    setInputValue(
      container.querySelector<HTMLInputElement>(
        "#password-protection-password",
      ),
      "secret123",
    );
    submitPasswordDialog(container);

    expect(mocks.mutatePasswordProtection).toHaveBeenCalledWith(
      {
        enabled: true,
        password: "secret123",
      },
      expect.objectContaining({
        onError: expect.any(Function),
        onSuccess: expect.any(Function),
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "パスワード保護を有効にしました",
    );

    act(() => {
      root.render(<FormPublishMenu formId="form-1" formStatus="PUBLISHED" />);
    });

    expect(container.textContent).toContain("有効");
    expect(container.textContent).toContain(
      "保存されたパスワードを使用して保護中です",
    );
    expect(passwordSwitch(container)?.getAttribute("aria-checked")).toBe(
      "true",
    );

    act(() => {
      root.unmount();
    });
  });

  it("trims leading and trailing spaces before saving a password", () => {
    const container = document.createElement("div");
    const root = renderMenu(container);

    click(passwordSwitch(container));
    setInputValue(
      container.querySelector<HTMLInputElement>(
        "#password-protection-password",
      ),
      "  secret123  ",
    );
    submitPasswordDialog(container);

    expect(mocks.mutatePasswordProtection).toHaveBeenCalledWith(
      {
        enabled: true,
        password: "secret123",
      },
      expect.objectContaining({
        onError: expect.any(Function),
        onSuccess: expect.any(Function),
      }),
    );

    act(() => {
      root.unmount();
    });
  });

  it("keeps the dialog open and shows the save failure both inline and as toast", () => {
    mocks.shouldFailPasswordUpdate = true;
    const container = document.createElement("div");
    const root = renderMenu(container);

    click(passwordSwitch(container));
    setInputValue(
      container.querySelector<HTMLInputElement>(
        "#password-protection-password",
      ),
      "secret123",
    );
    submitPasswordDialog(container);

    expect(container.querySelector("[role='dialog']")).not.toBeNull();
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "サーバーで保存できませんでした",
    );
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "サーバーで保存できませんでした",
    );

    act(() => {
      root.unmount();
    });
  });
});
