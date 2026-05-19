// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicFormPage } from "./public-form-page";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type PublicFormData = {
  form: {
    description: string | null;
    isPasswordProtected: boolean;
    passwordHint?: string;
    title: string;
  };
  plateContent: string | null;
  structure: { settings?: { require_fingerprint?: boolean } } | null;
};

let publicFormData: PublicFormData;
let refetchResult: { data?: PublicFormData; error: Error | null };
const refetchFormMock = vi.fn(async () => {
  if (refetchResult.data) {
    publicFormData = refetchResult.data;
  }
  return refetchResult;
});

const lockedFormData: PublicFormData = {
  form: {
    description: null,
    isPasswordProtected: true,
    passwordHint: "pet name",
    title: "Protected form",
  },
  plateContent: null,
  structure: null,
};

const unlockedFormData: PublicFormData = {
  form: {
    description: "visible after verification",
    isPasswordProtected: true,
    passwordHint: "pet name",
    title: "Protected form",
  },
  plateContent: "[]",
  structure: { settings: { require_fingerprint: false } },
};

function renderPublicForm(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<PublicFormPage />);
  });
  return root;
}

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ publicId: "public-1" }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: publicFormData,
    error: null,
    isPending: false,
    refetch: refetchFormMock,
  }),
}));

vi.mock("@/contexts/form-response-context", () => ({
  FormResponseProvider: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  useFormResponse: () => ({
    answers: {},
    clearAnswers: vi.fn(),
  }),
}));

vi.mock("@/hooks/fingerprint/use-fingerprint", () => ({
  useFingerprint: () => ({
    collect: vi.fn(),
    fingerprint: null,
  }),
}));

vi.mock("@/components/forms/form-body", () => ({
  FormBody: ({ title }: { title: string }) => (
    <main data-testid="public-form-body">{title}</main>
  ),
}));

vi.mock("@/components/forms/form-not-found-page", () => ({
  FormNotFoundPage: () => <main data-testid="not-found" />,
}));

vi.mock("@/components/forms/hcaptcha-widget", () => ({
  HCaptchaWidget: () => null,
}));

vi.mock("@/components/forms/password-protection-gate", () => ({
  PasswordProtectionGate: ({
    onVerified,
    passwordHint,
  }: {
    onVerified?: () => void | Promise<void>;
    passwordHint?: string;
  }) => (
    <section data-testid="password-gate">
      <p>{passwordHint}</p>
      <button
        type="button"
        onClick={() =>
          void Promise.resolve(onVerified?.()).catch(() => undefined)
        }
      >
        verify
      </button>
    </section>
  ),
}));

vi.mock("@/lib/api", () => ({
  client: {},
  RpcError: class RpcError extends Error {
    status = 500;
  },
  rpc: vi.fn(),
}));

vi.mock("@/lib/forms/find-unanswered-required", () => ({
  findUnansweredRequired: () => [],
}));

describe("PublicFormPage password protection", () => {
  beforeEach(() => {
    publicFormData = lockedFormData;
    refetchResult = { data: unlockedFormData, error: null };
    refetchFormMock.mockClear();
  });

  it("shows the password gate while protected body fields are locked, then renders the form after verification", async () => {
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    expect(
      container.querySelector("[data-testid='password-gate']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='public-form-body']"),
    ).toBeNull();
    expect(container.textContent).toContain("pet name");

    const verifyButton = container.querySelector("button");
    expect(verifyButton).not.toBeNull();

    await act(async () => {
      verifyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(refetchFormMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid='password-gate']")).toBeNull();
    expect(
      container.querySelector("[data-testid='public-form-body']")?.textContent,
    ).toBe("Protected form");

    act(() => root.unmount());
  });

  it("keeps the password gate when verification refetch still returns locked body fields", async () => {
    refetchResult = { data: lockedFormData, error: null };
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(refetchFormMock).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector("[data-testid='password-gate']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='public-form-body']"),
    ).toBeNull();

    act(() => root.unmount());
  });

  it("keeps the password gate when verification refetch fails", async () => {
    refetchResult = { error: new Error("refetch failed") };
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(refetchFormMock).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector("[data-testid='password-gate']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='public-form-body']"),
    ).toBeNull();

    act(() => root.unmount());
  });
});
