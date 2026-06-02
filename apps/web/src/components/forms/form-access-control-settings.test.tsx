// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormAccessControlSettings } from "./form-access-control-settings";

type PasswordProtectionState = {
  enabled: boolean;
  hasPassword: boolean;
  password_hint?: string;
};

type PasswordProtectionPublicationState = {
  current: PasswordProtectionState;
  published: PasswordProtectionState | null;
  isSynced: boolean;
};

type UpdatePasswordProtectionParams = {
  enabled: boolean;
  password?: string;
  password_hint?: string;
};

type UpdatePasswordProtectionOptions = {
  onError?: (error: Error) => void;
  onSuccess?: () => void;
};

const mocks = vi.hoisted(() => ({
  mutatePasswordProtection: vi.fn(),
  passwordProtection: {
    enabled: false,
    hasPassword: false,
  } as PasswordProtectionState,
  passwordProtectionPublication: {
    current: {
      enabled: false,
      hasPassword: false,
    },
    published: null,
    isSynced: true,
  } as PasswordProtectionPublicationState,
  toast: {
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
    passwordProtectionPublication: mocks.passwordProtectionPublication,
    updatePasswordProtection: {
      mutate: mocks.mutatePasswordProtection,
    },
  }),
}));

vi.mock("lucide-react", () => ({
  Lock: () => <span data-icon="lock" />,
  Save: () => <span data-icon="save" />,
  Upload: () => <span data-icon="upload" />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    asChild,
    children,
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<"button"> & {
    asChild?: boolean;
    variant?: string;
    size?: string;
  }) =>
    asChild ? (
      <span data-button-as-child="true">{children}</span>
    ) : (
      <button {...props}>{children}</button>
    ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
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
    root.render(<FormAccessControlSettings formId="form-1" />);
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

function submit(container: HTMLElement) {
  const form = container.querySelector("form");
  expect(form).not.toBeNull();
  act(() => {
    form?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

function passwordInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>(
    "input[id$='-password']:not([readonly])",
  );
}

function confirmInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>(
    "input[id$='-password-confirm']",
  );
}

function hintInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>(
    "input[id$='-password-hint']",
  );
}

function passwordSwitch(container: HTMLElement) {
  return container.querySelector("[role='switch']");
}

describe("FormAccessControlSettings", () => {
  beforeEach(() => {
    mocks.passwordProtection = {
      enabled: false,
      hasPassword: false,
    };
    mocks.passwordProtectionPublication = {
      current: {
        enabled: false,
        hasPassword: false,
      },
      published: null,
      isSynced: true,
    };
    mocks.mutatePasswordProtection.mockReset();
    mocks.mutatePasswordProtection.mockImplementation(
      (
        _params: UpdatePasswordProtectionParams,
        options?: UpdatePasswordProtectionOptions,
      ) => {
        options?.onSuccess?.();
      },
    );
    mocks.toast.success.mockReset();
  });

  it("adds password protection controls to the settings surface", () => {
    mocks.passwordProtection = {
      enabled: true,
      hasPassword: true,
      password_hint: "pet name",
    };
    mocks.passwordProtectionPublication = {
      current: {
        enabled: true,
        hasPassword: true,
        password_hint: "pet name",
      },
      published: {
        enabled: false,
        hasPassword: true,
        password_hint: "old pet name",
      },
      isSynced: false,
    };
    const container = document.createElement("div");
    const root = renderSettings(container);

    expect(container.textContent).toContain("アクセス制御");
    expect(container.textContent).toContain("パスワード保護");
    expect(container.textContent).toContain("現在のパスワード");
    expect(container.textContent).toContain(
      "保存済みパスワードは表示されません",
    );
    expect(
      container.querySelector<HTMLInputElement>("input[readonly]")?.value,
    ).toBe("••••••••");
    expect(hintInput(container)?.value).toBe("pet name");
    expect(container.textContent).toContain("管理画面の現在設定");
    expect(container.textContent).toContain("回答者に効いている公開版");
    expect(container.textContent).toContain(
      "パスワード保護に未公開の変更があります",
    );

    act(() => {
      root.unmount();
    });
  });

  it("requires a matching confirmation before enabling password protection", () => {
    const container = document.createElement("div");
    const root = renderSettings(container);

    click(passwordSwitch(container));
    setInputValue(passwordInput(container), "secret123");
    setInputValue(confirmInput(container), "different123");
    submit(container);

    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "確認用パスワードが一致しません",
    );
    expect(mocks.mutatePasswordProtection).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("saves enabled password protection with password, confirmation, and hint", () => {
    mocks.passwordProtectionPublication = {
      current: {
        enabled: true,
        hasPassword: true,
        password_hint: "pet name",
      },
      published: {
        enabled: false,
        hasPassword: false,
      },
      isSynced: false,
    };
    const container = document.createElement("div");
    const root = renderSettings(container);

    click(passwordSwitch(container));
    setInputValue(passwordInput(container), " secret123 ");
    setInputValue(confirmInput(container), "secret123");
    setInputValue(hintInput(container), "pet name");
    submit(container);

    expect(mocks.mutatePasswordProtection).toHaveBeenCalledWith(
      {
        enabled: true,
        password: "secret123",
        password_hint: "pet name",
      },
      expect.objectContaining({
        onError: expect.any(Function),
        onSuccess: expect.any(Function),
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "パスワード保護を保存しました",
    );
    expect(container.textContent).toContain("公開して反映");
    expect(container.textContent).toContain(
      "回答者に反映するには、公開 snapshot",
    );

    act(() => {
      root.unmount();
    });
  });

  it("can disable protection without sending the existing password back", () => {
    mocks.passwordProtection = {
      enabled: true,
      hasPassword: true,
      password_hint: "pet name",
    };
    const container = document.createElement("div");
    const root = renderSettings(container);

    click(passwordSwitch(container));
    setInputValue(passwordInput(container), "typed-but-disabled");
    setInputValue(confirmInput(container), "different-disabled");
    submit(container);

    expect(mocks.mutatePasswordProtection).toHaveBeenCalledWith(
      { enabled: false },
      expect.objectContaining({
        onError: expect.any(Function),
        onSuccess: expect.any(Function),
      }),
    );

    act(() => {
      root.unmount();
    });
  });

  it("does not save when password protection settings are unchanged", () => {
    mocks.passwordProtection = {
      enabled: true,
      hasPassword: true,
      password_hint: "pet name",
    };
    const container = document.createElement("div");
    const root = renderSettings(container);

    submit(container);

    expect(mocks.mutatePasswordProtection).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });
});
