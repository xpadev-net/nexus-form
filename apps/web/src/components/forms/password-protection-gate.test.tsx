// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordProtectionGate } from "./password-protection-gate";

const apiMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  verifyPasswordPost: vi.fn(),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/lib/api", () => ({
  client: {
    api: {
      forms: {
        public: {
          ":publicId": {
            "verify-password": {
              $post: apiMocks.verifyPasswordPost,
            },
          },
        },
      },
    },
  },
  rpc: apiMocks.rpc,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderGate(container: HTMLElement, onVerified = vi.fn()): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <PasswordProtectionGate
        publicId="public-1"
        passwordHint="pet name"
        onVerified={onVerified}
      >
        <main data-testid="protected-body">回答フォーム</main>
      </PasswordProtectionGate>,
    );
  });
  return root;
}

function setPassword(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLInputElement>(
    "input[type='password']",
  );
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

async function submit(container: HTMLElement) {
  const form = container.querySelector("form");
  expect(form).not.toBeNull();
  await act(async () => {
    form?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("PasswordProtectionGate", () => {
  beforeEach(() => {
    apiMocks.rpc.mockReset();
    apiMocks.verifyPasswordPost.mockReset();
    apiMocks.verifyPasswordPost.mockReturnValue("verify-request");
  });

  it("shows the password hint and keeps the body hidden for wrong passwords", async () => {
    apiMocks.rpc.mockResolvedValueOnce({ valid: false });
    const onVerified = vi.fn();
    const container = document.createElement("div");
    const root = renderGate(container, onVerified);

    expect(container.textContent).toContain("pet name");
    expect(
      container.querySelector("[data-testid='protected-body']"),
    ).toBeNull();

    setPassword(container, "wrong-password");
    await submit(container);

    expect(apiMocks.verifyPasswordPost).toHaveBeenCalledWith({
      param: { publicId: "public-1" },
      json: { password: "wrong-password" },
    });
    expect(container.textContent).toContain("パスワードが正しくありません");
    expect(
      container.querySelector("[data-testid='protected-body']"),
    ).toBeNull();
    expect(onVerified).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("renders children only after a correct password and successful refetch callback", async () => {
    apiMocks.rpc.mockResolvedValueOnce({ valid: true });
    const onVerified = vi.fn().mockResolvedValue(undefined);
    const container = document.createElement("div");
    const root = renderGate(container, onVerified);

    setPassword(container, "correct-password");
    await submit(container);

    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector("[data-testid='protected-body']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("回答フォーム");

    act(() => {
      root.unmount();
    });
  });
});
