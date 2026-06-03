// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormPostSubmitSettings } from "./form-post-submit-settings";

type MutationOptions<TInput> = {
  mutationFn: (input: TInput) => Promise<unknown>;
  onError?: (error: Error) => void;
  onSuccess?: () => Promise<void> | void;
};

const mocks = vi.hoisted(() => ({
  getRequest: vi.fn(() => ({ kind: "get" })),
  invalidateQueries: vi.fn(),
  patchPostSubmitRequest: vi.fn((payload: unknown) => ({
    kind: "patchPostSubmit",
    payload,
  })),
  rpc: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

let structureData: {
  structure: {
    version: number;
    settings: { require_fingerprint: boolean };
    confirmation?: unknown;
    notifications?: unknown;
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
            "post-submit": {
              $patch: mocks.patchPostSubmitRequest,
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
  Bell: () => <span data-icon="bell" />,
  Link2: () => <span data-icon="link" />,
  Mail: () => <span data-icon="mail" />,
  MessageCircle: () => <span data-icon="message" />,
  Save: () => <span data-icon="save" />,
  Trash2: () => <span data-icon="trash" />,
  Webhook: () => <span data-icon="webhook" />,
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

vi.mock("@/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: ComponentProps<"label">) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
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
    root.render(<FormPostSubmitSettings formId="form-1" />);
  });
  return root;
}

function setInputValue(
  input: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
) {
  expect(input).not.toBeNull();
  const valueSetter = Object.getOwnPropertyDescriptor(
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
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

function findButtonByText(
  container: HTMLElement,
  text: string,
): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes(text),
    ) ?? null
  );
}

function submit(element: HTMLFormElement | null) {
  expect(element).not.toBeNull();
  act(() => {
    element?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("FormPostSubmitSettings", () => {
  beforeEach(() => {
    structureData = {
      structure: {
        version: 1,
        settings: { require_fingerprint: true },
        confirmation: {
          title: "Thanks",
          message: "Done",
          supplemental_link: {
            label: "Guide",
            url: "https://example.com/guide",
          },
          contact: {
            label: "Support",
            email: "support@example.com",
          },
        },
        notifications: {
          on_submit: {
            email: {
              enabled: false,
              recipients: [],
            },
            discord: {
              enabled: true,
              has_webhook_url: true,
              message_template: "Old Discord",
            },
            webhook: {
              enabled: true,
              has_url: true,
              has_secret: true,
              timeout_seconds: 30,
              retry_attempts: 3,
            },
          },
        },
      },
    };
    mocks.getRequest.mockClear();
    mocks.invalidateQueries.mockReset();
    mocks.patchPostSubmitRequest.mockClear();
    mocks.rpc.mockReset();
    mocks.rpc.mockImplementation(async (request: { kind?: string }) =>
      request.kind === "get" ? structureData : {},
    );
    mocks.toast.error.mockReset();
    mocks.toast.success.mockReset();
  });

  it("shows post-submit scope guidance and masked webhook placeholders", () => {
    const container = document.createElement("div");
    const root = renderSettings(container);

    expect(container.textContent).toContain("送信後");
    expect(container.textContent).toContain(
      "有効な通知チャネルが回答送信時に使用されます",
    );
    expect(container.textContent).toContain("保存済み URL は表示されません");
    expect(container.textContent).toContain("保存済み secret は表示されません");
    expect(
      container
        .querySelector("#post-submit-email-enabled")
        ?.getAttribute("aria-labelledby"),
    ).toBe("post-submit-email-heading");
    expect(
      container
        .querySelector("#post-submit-discord-enabled")
        ?.getAttribute("aria-labelledby"),
    ).toBe("post-submit-discord-heading");
    expect(
      container
        .querySelector("#post-submit-webhook-enabled")
        ?.getAttribute("aria-labelledby"),
    ).toBe("post-submit-webhook-heading");

    act(() => root.unmount());
  });

  it("lets masked webhook values be removed explicitly", async () => {
    const container = document.createElement("div");
    const root = renderSettings(container);

    click(findButtonByText(container, "保存済み URL を削除"));
    click(findButtonByText(container, "保存済み URL を削除"));
    click(findButtonByText(container, "保存済み secret を削除"));
    submit(
      container.querySelector<HTMLFormElement>("#form-post-submit-settings"),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const patchPayload = mocks.patchPostSubmitRequest.mock.calls[0]?.[0];
    expect(patchPayload).toMatchObject({
      json: {
        notifications: {
          on_submit: {
            discord: {
              enabled: false,
              has_webhook_url: false,
            },
            webhook: {
              enabled: false,
              has_url: false,
              has_secret: false,
            },
          },
        },
      },
    });

    act(() => root.unmount());
  });

  it("sends null when saved supplemental link and contact values are cleared", async () => {
    const container = document.createElement("div");
    const root = renderSettings(container);

    setInputValue(
      container.querySelector<HTMLInputElement>("#post-submit-link-label"),
      "",
    );
    setInputValue(
      container.querySelector<HTMLInputElement>("#post-submit-link-url"),
      "",
    );
    setInputValue(
      container.querySelector<HTMLInputElement>("#post-submit-contact-email"),
      "",
    );
    submit(
      container.querySelector<HTMLFormElement>("#form-post-submit-settings"),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const patchPayload = mocks.patchPostSubmitRequest.mock.calls[0]?.[0];
    expect(patchPayload).toMatchObject({
      json: {
        confirmation: {
          supplemental_link: null,
          contact: null,
        },
      },
    });

    act(() => root.unmount());
  });

  it("saves post-submit settings with the dedicated patch endpoint", async () => {
    const container = document.createElement("div");
    const root = renderSettings(container);

    setInputValue(
      container.querySelector<HTMLInputElement>("#post-submit-title"),
      "送信ありがとうございました",
    );
    setInputValue(
      container.querySelector<HTMLTextAreaElement>("#post-submit-message"),
      "担当者から連絡します。",
    );
    setInputValue(
      container.querySelector<HTMLInputElement>("#post-submit-link-label"),
      "次のステップ",
    );
    setInputValue(
      container.querySelector<HTMLInputElement>("#post-submit-link-url"),
      "https://example.com/next",
    );
    setInputValue(
      container.querySelector<HTMLInputElement>("#post-submit-contact-label"),
      "サポート窓口",
    );
    setInputValue(
      container.querySelector<HTMLInputElement>("#post-submit-contact-email"),
      "",
    );
    click(container.querySelector("#post-submit-email-enabled"));
    setInputValue(
      container.querySelector<HTMLTextAreaElement>(
        "#post-submit-email-recipients",
      ),
      "owner@example.com",
    );
    submit(
      container.querySelector<HTMLFormElement>("#form-post-submit-settings"),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const patchPayload = mocks.patchPostSubmitRequest.mock.calls[0]?.[0];
    expect(mocks.getRequest).not.toHaveBeenCalled();
    expect(patchPayload).toMatchObject({
      param: { id: "form-1" },
      json: {
        confirmation: {
          title: "送信ありがとうございました",
          message: "担当者から連絡します。",
          supplemental_link: {
            label: "次のステップ",
            url: "https://example.com/next",
          },
        },
        notifications: {
          on_submit: {
            email: {
              enabled: true,
              recipients: ["owner@example.com"],
            },
            discord: {
              enabled: true,
              has_webhook_url: true,
              message_template: "Old Discord",
            },
            webhook: {
              enabled: true,
              has_url: true,
              has_secret: true,
              timeout_seconds: 30,
              retry_attempts: 3,
            },
          },
        },
      },
    });
    expect(patchPayload).toMatchObject({
      json: {
        confirmation: {
          contact: null,
        },
      },
    });
    expect(patchPayload).toMatchObject({
      json: {
        confirmation: expect.not.objectContaining({
          show_response_summary: expect.anything(),
        }),
      },
    });
    expect(patchPayload).toMatchObject({
      json: {
        confirmation: expect.not.objectContaining({
          allow_edit_link: expect.anything(),
        }),
      },
    });
    expect(patchPayload).not.toMatchObject({
      json: { structure: expect.anything() },
    });
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "送信後設定を保存しました",
    );

    act(() => root.unmount());
  });

  it("shows a readable validation message before saving invalid settings", () => {
    const container = document.createElement("div");
    const root = renderSettings(container);

    setInputValue(
      container.querySelector<HTMLInputElement>("#post-submit-link-url"),
      "",
    );
    submit(
      container.querySelector<HTMLFormElement>("#form-post-submit-settings"),
    );

    expect(mocks.patchPostSubmitRequest).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("[{");
    expect(container.textContent).toContain("Invalid input");

    act(() => root.unmount());
  });
});
