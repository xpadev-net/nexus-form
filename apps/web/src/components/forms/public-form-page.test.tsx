// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "@/lib/api";
import { NetworkError } from "@/lib/fetch-json";
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
type RetryFn = (failureCount: number, error: unknown) => boolean;
let publicFormRetry: RetryFn | undefined;
const useFingerprintMockState = vi.hoisted(() => ({
  collect: vi.fn(),
  fingerprints: [] as {
    fingerprintType: string;
    components: { componentName: string; componentValueHash: string }[];
  }[],
}));
const verificationFailureMock = vi.fn();
const apiMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  submitPost: vi.fn(),
  telemetryPost: vi.fn(),
}));
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
  useSearch: () => ({}),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ retry }: { retry?: RetryFn }) => {
    publicFormRetry = retry;
    return {
      data: publicFormData,
      error: null,
      isPending: false,
      refetch: refetchFormMock,
    };
  },
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
    collect: useFingerprintMockState.collect,
    fingerprints: useFingerprintMockState.fingerprints,
  }),
}));

vi.mock("@/components/forms/form-body", () => ({
  FormBody: ({
    captchaReady,
    onSubmitRequest,
    preSubmitSlot,
    title,
  }: {
    captchaReady?: boolean;
    onSubmitRequest?: (data: {
      responses: [];
      visitedQuestionIds: [];
    }) => void | Promise<void>;
    preSubmitSlot?: ReactNode;
    title: string;
  }) => (
    <main
      data-captcha-ready={captchaReady ? "true" : "false"}
      data-testid="public-form-body"
    >
      {title}
      {preSubmitSlot}
      <button
        type="button"
        onClick={() =>
          void onSubmitRequest?.({ responses: [], visitedQuestionIds: [] })
        }
      >
        submit
      </button>
    </main>
  ),
}));

vi.mock("@/components/forms/form-not-found-page", () => ({
  FormNotFoundPage: () => <main data-testid="not-found" />,
}));

vi.mock("@/components/forms/hcaptcha-widget", () => ({
  HCaptchaWidget: () => <div data-testid="hcaptcha-widget" />,
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
        onClick={async () => {
          try {
            await onVerified?.();
          } catch (error: unknown) {
            verificationFailureMock(error);
          }
        }}
      >
        verify
      </button>
    </section>
  ),
}));

vi.mock("@/lib/api", () => ({
  client: {
    api: {
      forms: {
        public: {
          ":publicId": {
            $get: vi.fn(),
            submit: { $post: apiMocks.submitPost },
          },
        },
      },
      telemetry: {
        v4: { $post: apiMocks.telemetryPost },
      },
    },
  },
  RpcError: class RpcError extends Error {
    readonly details = null;
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "RpcError";
      this.status = status;
    }
  },
  rpc: apiMocks.rpc,
}));

vi.mock("@/lib/forms/find-unanswered-required", () => ({
  findUnansweredRequired: () => [],
}));

describe("PublicFormPage password protection", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    publicFormData = lockedFormData;
    refetchResult = { data: unlockedFormData, error: null };
    useFingerprintMockState.collect = vi.fn().mockResolvedValue([]);
    useFingerprintMockState.fingerprints = [];
    verificationFailureMock.mockClear();
    refetchFormMock.mockClear();
    apiMocks.rpc.mockReset();
    apiMocks.submitPost.mockReset();
    apiMocks.telemetryPost.mockReset();
    publicFormRetry = undefined;
  });

  it("does not retry public form 4xx query failures", () => {
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    expect(publicFormRetry?.(0, new RpcError("Not found", 404))).toBe(false);
    expect(publicFormRetry?.(0, new RpcError("Forbidden", 403))).toBe(false);
    expect(publicFormRetry?.(2, new RpcError("Server error", 500))).toBe(true);
    expect(
      publicFormRetry?.(
        2,
        new NetworkError("Network request failed", new TypeError()),
      ),
    ).toBe(true);
    expect(
      publicFormRetry?.(
        3,
        new NetworkError("Network request failed", new TypeError()),
      ),
    ).toBe(false);
    expect(publicFormRetry?.(0, new Error("Unexpected parse failure"))).toBe(
      false,
    );
    expect(
      publicFormRetry?.(
        0,
        new TypeError("Cannot read properties of undefined"),
      ),
    ).toBe(false);

    act(() => root.unmount());
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
    expect(verificationFailureMock).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='password-gate']")).toBeNull();
    expect(
      container.querySelector("[data-testid='public-form-body']")?.textContent,
    ).toContain("Protected form");

    await act(async () => {
      root.unmount();
    });
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
    expect(verificationFailureMock).toHaveBeenCalledTimes(1);
    expect(verificationFailureMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ message: "Public form body is still locked" }),
    );
    expect(
      container.querySelector("[data-testid='password-gate']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='public-form-body']"),
    ).toBeNull();

    await act(async () => {
      root.unmount();
    });
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
    expect(verificationFailureMock).toHaveBeenCalledTimes(1);
    expect(verificationFailureMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ message: "refetch failed" }),
    );
    expect(
      container.querySelector("[data-testid='password-gate']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='public-form-body']"),
    ).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("caps mixed submitted fingerprints to the API maximum", async () => {
    vi.stubEnv("VITE_DISABLE_HCAPTCHA", "true");
    publicFormData = {
      form: {
        description: null,
        isPasswordProtected: false,
        title: "Public form",
      },
      plateContent: JSON.stringify([
        {
          id: "1",
          type: "form_short_text",
          blockId: "q1",
          children: [{ text: "Name" }],
        },
      ]),
      structure: { settings: { require_fingerprint: true } },
    };
    useFingerprintMockState.fingerprints = [
      {
        fingerprintType: "browser",
        components: [
          { componentName: "timezone", componentValueHash: "hash-timezone" },
          { componentName: "language", componentValueHash: "hash-language" },
          { componentName: "platform", componentValueHash: "hash-platform" },
          { componentName: "userAgent", componentValueHash: "hash-user-agent" },
        ],
      },
      {
        fingerprintType: "fingerprintjs",
        components: [
          { componentName: "visitorId", componentValueHash: "hash-visitor" },
          ...Array.from({ length: 95 }, (_, index) => ({
            componentName: `fingerprintjs-${index}`,
            componentValueHash: `hash-fpjs-${index.toString().padStart(3, "0")}`,
          })),
        ],
      },
      {
        fingerprintType: "thumbmarkjs",
        components: Array.from({ length: 130 }, (_, index) => ({
          componentName: `thumbmarkjs-${index}`,
          componentValueHash: `hash-thumb-${index.toString().padStart(3, "0")}`,
        })),
      },
    ];
    apiMocks.telemetryPost.mockReturnValue("telemetry-request");
    apiMocks.submitPost.mockReturnValue("submit-request");
    apiMocks.rpc.mockImplementation(async (request) =>
      request === "telemetry-request"
        ? { token: "telemetry-token" }
        : { response: { id: "response-1" } },
    );

    const container = document.createElement("div");
    const root = renderPublicForm(container);

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(apiMocks.submitPost).toHaveBeenCalledWith({
      param: { publicId: "public-1" },
      json: expect.objectContaining({
        responses: [],
        captchaToken: "form-security-dev-bypass",
        telemetry: { v4Token: "telemetry-token" },
        fingerprints: expect.any(Array),
      }),
    });

    const submitArgs = apiMocks.submitPost.mock.calls[0]?.[0];
    const submittedFingerprints = submitArgs?.json.fingerprints as {
      name: string;
      type: string;
      value_hash: string;
    }[];
    expect(submittedFingerprints.length).toBe(200);
    expect(submittedFingerprints).toEqual(
      expect.arrayContaining([
        {
          name: "visitorId",
          type: "fingerprintjs",
          value_hash: "hash-visitor",
        },
        { name: "timezone", type: "browser", value_hash: "hash-timezone" },
        {
          name: "thumbmarkjs-0",
          type: "thumbmarkjs",
          value_hash: "hash-thumb-000",
        },
      ]),
    );
    expect(
      submittedFingerprints.every((fingerprint) =>
        Boolean(fingerprint.value_hash),
      ),
    ).toBe(true);
    expect(
      submittedFingerprints.some(
        (fingerprint) => fingerprint.name === "thumbmarkjs-99",
      ),
    ).toBe(true);
    expect(
      submittedFingerprints.some(
        (fingerprint) => fingerprint.name === "thumbmarkjs-100",
      ),
    ).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("skips hCaptcha UI and marks captcha ready when disabled for development", async () => {
    vi.stubEnv("VITE_DISABLE_HCAPTCHA", "true");
    publicFormData = {
      form: {
        description: null,
        isPasswordProtected: false,
        title: "Public form",
      },
      plateContent: "[]",
      structure: { settings: { require_fingerprint: false } },
    };
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    const formBody = container.querySelector(
      "[data-testid='public-form-body']",
    );
    expect(formBody?.getAttribute("data-captcha-ready")).toBe("true");
    expect(
      container.querySelector("[data-testid='hcaptcha-widget']"),
    ).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the legacy hCaptcha flag scoped to captcha-only bypass during submit", async () => {
    vi.stubEnv("VITE_DISABLE_HCAPTCHA", "true");
    publicFormData = {
      form: {
        description: null,
        isPasswordProtected: false,
        title: "Public form",
      },
      plateContent: JSON.stringify([
        {
          id: "1",
          type: "form_short_text",
          blockId: "q1",
          children: [{ text: "Name" }],
        },
      ]),
      structure: { settings: { require_fingerprint: false } },
    };
    apiMocks.telemetryPost.mockReturnValue("telemetry-request");
    apiMocks.submitPost.mockReturnValue("submit-request");
    apiMocks.rpc.mockImplementation(async (request) =>
      request === "telemetry-request"
        ? { token: "telemetry-token" }
        : { response: { id: "response-1" } },
    );
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(apiMocks.telemetryPost).toHaveBeenCalledTimes(1);
    expect(apiMocks.submitPost).toHaveBeenCalledWith({
      param: { publicId: "public-1" },
      json: {
        responses: [],
        captchaToken: "form-security-dev-bypass",
        telemetry: { v4Token: "telemetry-token" },
        fingerprints: [],
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("skips hCaptcha UI and marks captcha ready with the form security development bypass", async () => {
    vi.stubEnv("VITE_FORM_SECURITY_DEV_BYPASS", "true");
    publicFormData = {
      form: {
        description: null,
        isPasswordProtected: false,
        title: "Public form",
      },
      plateContent: "[]",
      structure: { settings: { require_fingerprint: true } },
    };
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    const formBody = container.querySelector(
      "[data-testid='public-form-body']",
    );
    expect(formBody?.getAttribute("data-captcha-ready")).toBe("true");
    expect(
      container.querySelector("[data-testid='hcaptcha-widget']"),
    ).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
