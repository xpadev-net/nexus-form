// @vitest-environment jsdom

import type { ReactNode, Ref } from "react";
import { act, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "@/lib/api";
import { NetworkError } from "@/lib/fetch-json";
import type { FormAppearance } from "@/types/validation/form";
import { PublicFormPage } from "./public-form-page";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type MockSubmitRequestData = {
  responses: {
    question_id: string;
    question_type: string;
    question_title: string;
    value?: string | number | boolean | null;
    values?: Array<string | number | boolean>;
    responses?: Record<string, string | string[]>;
    other_value?: string;
    other_values?: string[];
  }[];
  visitedQuestionIds: string[];
  completionTargetPageId?: string;
};

type PublicFormData = {
  form: {
    description: string | null;
    isPasswordProtected: boolean;
    passwordHint?: string;
    title: string;
  };
  plateContent: string | null;
  structure: {
    confirmation?: {
      title?: string;
      message?: string;
      supplemental_link?: { label: string; url: string };
      contact?: { label?: string; email?: string; url?: string };
      redirect_url?: string;
      show_response_summary?: boolean;
      show_response_id?: boolean;
      allow_edit_link?: boolean;
    };
    appearance?: FormAppearance;
    settings?: { require_fingerprint?: boolean };
  } | null;
};

let publicFormData: PublicFormData | undefined;
let publicFormIsPending: boolean;
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
const requiredValidationMock = vi.hoisted(() => ({
  findUnansweredRequired: vi.fn(),
}));
const formBodyMockState = vi.hoisted(() => ({
  submitData: {
    responses: [],
    visitedQuestionIds: [],
  } as MockSubmitRequestData,
  renderProps: [] as Array<{
    captchaReady?: boolean;
    description?: string;
    plateContent: string;
    submittedCompletionPageId?: string | null;
    title: string;
  }>,
}));
const hCaptchaMockState = vi.hoisted(() => ({
  onVerify: undefined as ((token: string) => void) | undefined,
  onExpire: undefined as (() => void) | undefined,
  reset: vi.fn(),
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

function sectionBranchingPlateContent(): string {
  return JSON.stringify([
    {
      type: "form_radio",
      blockId: "q-entity-type",
      validation: {
        required: true,
        options: [
          { id: "individual", label: "個人" },
          { id: "corporate", label: "法人" },
        ],
      },
      children: [{ type: "p", children: [{ text: "契約種別" }] }],
    },
    {
      type: "form_section_separator",
      blockId: "section-corporate",
      validation: {
        navigation_rules: [
          {
            id: "rule-corporate-branch",
            name: "法人の場合は追加情報へ",
            conditions: [
              {
                question_id: "q-entity-type",
                operator: "equals",
                value: "corporate",
              },
            ],
            condition_match: "all",
            action: {
              type: "jump_to_section",
              target_id: "section-corporate",
            },
            enabled: true,
            priority: 1,
          },
        ],
        default_action: { type: "submit" },
      },
      children: [{ type: "p", children: [{ text: "法人追加情報" }] }],
    },
    {
      type: "form_short_text",
      blockId: "q-company-name",
      validation: { required: true },
      children: [{ type: "p", children: [{ text: "法人名" }] }],
    },
  ]);
}

function completionTargetPlateContent(
  options: { answerableTarget?: boolean } = {},
): string {
  return JSON.stringify([
    {
      type: "form_radio",
      blockId: "q-plan",
      validation: {
        required: true,
        options: [{ id: "vip", label: "VIP" }],
      },
      children: [{ type: "p", children: [{ text: "プラン" }] }],
    },
    {
      type: "form_section_separator",
      blockId: "section-complete-vip",
      validation: {
        default_action: {
          type: "submit",
          target_id: "section-complete-vip",
        },
      },
      children: [{ type: "p", children: [{ text: "VIP 完了" }] }],
    },
    ...(options.answerableTarget
      ? [
          {
            type: "form_short_text",
            blockId: "q-completion-note",
            validation: { required: true },
            children: [{ type: "p", children: [{ text: "完了後の入力欄" }] }],
          },
        ]
      : [{ type: "p", children: [{ text: "VIP 向け完了メッセージ" }] }]),
  ]);
}

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
      data: publicFormIsPending ? undefined : publicFormData,
      error: publicFormIsPending
        ? null
        : publicFormData
          ? null
          : new RpcError("Not found", 404),
      isPending: publicFormIsPending,
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
    description,
    error,
    onSubmitRequest,
    plateContent,
    preSubmitSlot,
    submittedCompletionPageId,
    title,
  }: {
    captchaReady?: boolean;
    description?: string;
    error?: string | null;
    onSubmitRequest?: (data: MockSubmitRequestData) => void | Promise<void>;
    plateContent: string;
    preSubmitSlot?: ReactNode;
    submittedCompletionPageId?: string | null;
    title: string;
  }) => {
    formBodyMockState.renderProps.push({
      captchaReady,
      description,
      plateContent,
      submittedCompletionPageId,
      title,
    });
    return (
      <main
        data-captcha-ready={captchaReady ? "true" : "false"}
        data-testid="public-form-body"
      >
        {title}
        {description ? <p>{description}</p> : null}
        {preSubmitSlot}
        {error ? <p data-testid="form-error">{error}</p> : null}
        <button
          type="button"
          onClick={() => void onSubmitRequest?.(formBodyMockState.submitData)}
        >
          submit
        </button>
      </main>
    );
  },
}));

vi.mock("@/components/forms/form-not-found-page", () => ({
  FormNotFoundPage: ({
    description,
    title = "フォームが見つかりません",
  }: {
    description?: string;
    title?: string;
  }) => (
    <main data-testid="not-found">
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </main>
  ),
}));

vi.mock("@/components/forms/hcaptcha-widget", () => ({
  HCaptchaWidget: ({
    onExpire,
    onVerify,
    ref,
  }: {
    onExpire?: () => void;
    onVerify: (token: string) => void;
    ref?: Ref<{ reset: () => void }>;
  }) => {
    hCaptchaMockState.onExpire = onExpire;
    hCaptchaMockState.onVerify = onVerify;
    useImperativeHandle(ref, () => ({ reset: hCaptchaMockState.reset }), []);
    return <div data-testid="hcaptcha-widget" />;
  },
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
  findUnansweredRequired: requiredValidationMock.findUnansweredRequired,
}));

describe("PublicFormPage", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    window.__NEXUS_FORM_CONFIG__ = undefined;
    publicFormData = lockedFormData;
    publicFormIsPending = false;
    refetchResult = { data: unlockedFormData, error: null };
    useFingerprintMockState.collect = vi.fn().mockResolvedValue([]);
    useFingerprintMockState.fingerprints = [];
    verificationFailureMock.mockClear();
    refetchFormMock.mockClear();
    apiMocks.rpc.mockReset();
    apiMocks.submitPost.mockReset();
    apiMocks.telemetryPost.mockReset();
    requiredValidationMock.findUnansweredRequired.mockReset();
    requiredValidationMock.findUnansweredRequired.mockReturnValue([]);
    formBodyMockState.submitData = { responses: [], visitedQuestionIds: [] };
    formBodyMockState.renderProps.length = 0;
    hCaptchaMockState.onVerify = undefined;
    hCaptchaMockState.onExpire = undefined;
    hCaptchaMockState.reset.mockClear();
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

  it("unmounts the public loading status after a slow query resolves to a long multipage grid form", async () => {
    const longDescription = Array.from(
      { length: 8 },
      (_, index) => `長い説明文の段落 ${index + 1}`,
    ).join("。");
    const multipageGridContent = JSON.stringify([
      {
        type: "form_long_text",
        blockId: "long-answer",
        validation: { required: true },
        children: [{ type: "p", children: [{ text: "長文回答" }] }],
      },
      {
        type: "form_section_separator",
        blockId: "next-page",
        children: [{ type: "p", children: [{ text: "詳細ページ" }] }],
      },
      {
        type: "form_choice_grid",
        blockId: "grid-answer",
        validation: {
          required: true,
          rows: [{ id: "row-1", label: "Row 1" }],
          columns: [{ id: "col-1", label: "Column 1" }],
        },
        children: [{ type: "p", children: [{ text: "Grid question" }] }],
      },
    ]);
    publicFormIsPending = true;
    publicFormData = undefined;

    const container = document.createElement("div");
    const root = renderPublicForm(container);

    expect(
      container.querySelector("[data-public-form-loading='true']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='public-form-body']"),
    ).toBeNull();
    expect(container.textContent).toContain("フォームを準備しています。");
    expect(container.textContent).not.toContain("読み込み中...");

    publicFormIsPending = false;
    publicFormData = {
      form: {
        description: longDescription,
        isPasswordProtected: false,
        title: "公開中のフォーム",
      },
      plateContent: multipageGridContent,
      structure: { settings: { require_fingerprint: false } },
    };

    await act(async () => {
      root.render(<PublicFormPage />);
    });

    expect(
      container.querySelector("[data-public-form-loading='true']"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='public-form-body']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("公開中のフォーム");
    expect(container.textContent).toContain(longDescription);
    expect(container.textContent).not.toContain("読み込み中...");
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(formBodyMockState.renderProps.at(-1)).toMatchObject({
      description: longDescription,
      plateContent: multipageGridContent,
      title: "公開中のフォーム",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("wraps the public form body in the shared appearance surface", () => {
    publicFormData = {
      form: {
        description: "Dark appearance",
        isPasswordProtected: false,
        title: "公開中のフォーム",
      },
      plateContent: "[]",
      structure: {
        appearance: {
          theme: {
            primary_color: "#93c5fd",
            accent_color: "#bbf7d0",
            background_color: "#111827",
            font_family: "Inter",
          },
          layout: {
            width: "medium",
            alignment: "center",
            spacing: "comfortable",
            show_progress_bar: true,
            progress_position: "top",
            show_question_numbers: false,
          },
        },
        settings: { require_fingerprint: false },
      },
    };
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    const surface = container.querySelector<HTMLElement>(
      "[data-form-appearance-surface='true']",
    );
    expect(surface).not.toBeNull();
    expect(surface?.style.getPropertyValue("--background")).toBe("#111827");
    expect(surface?.style.getPropertyValue("--foreground")).toBe("white");
    expect(surface?.style.getPropertyValue("--card")).toBe("#242a38");
    expect(surface?.style.getPropertyValue("--card-foreground")).toBe("white");
    expect(surface?.style.getPropertyValue("--primary")).toBe("#93c5fd");
    expect(surface?.style.getPropertyValue("--accent")).toBe("#bbf7d0");

    act(() => root.unmount());
  });

  it("explains that a 404 public URL may have been regenerated", () => {
    publicFormData = undefined;
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    expect(container.querySelector("[data-testid='not-found']")).not.toBeNull();
    expect(container.textContent).toContain("フォームが見つかりません");
    expect(container.textContent).toContain(
      "公開 URL が再生成された可能性もあります。",
    );
    expect(container.textContent).toContain(
      "最新の URL をフォーム管理者に確認してください。",
    );
    expect(container.textContent).not.toContain("public-1");

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
        : {
            confirmation: {
              title: "ご回答ありがとうございます",
              message: "回答を受け付けました。ご協力ありがとうございました。",
            },
            response: { id: "response-1" },
            responseId: "response-1",
          },
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
        : {
            confirmation: {
              title: "ご回答ありがとうございます",
              message: "回答を受け付けました。ご協力ありがとうございました。",
            },
            response: { id: "response-1" },
            responseId: "response-1",
          },
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

  it("uses the dedicated runtime telemetry v4 host when requesting the submit token", async () => {
    vi.stubEnv("VITE_DISABLE_HCAPTCHA", "true");
    window.__NEXUS_FORM_CONFIG__ = {
      telemetryV4Host: "ipv4.runtime.example",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: "runtime-host-token" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
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
    apiMocks.submitPost.mockReturnValue("submit-request");
    apiMocks.rpc.mockImplementation(async (request) => {
      expect(request).toBe("submit-request");
      return {
        confirmation: {
          title: "ご回答ありがとうございます",
          message: "回答を受け付けました。ご協力ありがとうございました。",
        },
        response: { id: "response-1" },
        responseId: "response-1",
      };
    });
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ipv4.runtime.example/api/telemetry/v4",
      {
        credentials: "omit",
        headers: { Accept: "application/json" },
        method: "POST",
        signal: expect.any(AbortSignal),
      },
    );
    expect(apiMocks.telemetryPost).not.toHaveBeenCalled();
    expect(apiMocks.submitPost).toHaveBeenCalledWith({
      param: { publicId: "public-1" },
      json: {
        responses: [],
        captchaToken: "form-security-dev-bypass",
        telemetry: { v4Token: "runtime-host-token" },
        fingerprints: [],
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("uses the dedicated runtime telemetry v6 host when no v4 host is configured", async () => {
    vi.stubEnv("VITE_DISABLE_HCAPTCHA", "true");
    window.__NEXUS_FORM_CONFIG__ = {
      telemetryV6Host: "ipv6.runtime.example",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: "runtime-v6-host-token" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
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
    apiMocks.submitPost.mockReturnValue("submit-request");
    apiMocks.rpc.mockImplementation(async (request) => {
      expect(request).toBe("submit-request");
      return {
        confirmation: {
          title: "ご回答ありがとうございます",
          message: "回答を受け付けました。ご協力ありがとうございました。",
        },
        response: { id: "response-1" },
        responseId: "response-1",
      };
    });
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ipv6.runtime.example/api/telemetry/v6",
      {
        credentials: "omit",
        headers: { Accept: "application/json" },
        method: "POST",
        signal: expect.any(AbortSignal),
      },
    );
    expect(apiMocks.telemetryPost).not.toHaveBeenCalled();
    expect(apiMocks.submitPost).toHaveBeenCalledWith({
      param: { publicId: "public-1" },
      json: {
        responses: [],
        captchaToken: "form-security-dev-bypass",
        telemetry: { v6Token: "runtime-v6-host-token" },
        fingerprints: [],
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("stops public submit when the configured telemetry host fails", async () => {
    vi.stubEnv("VITE_DISABLE_HCAPTCHA", "true");
    window.__NEXUS_FORM_CONFIG__ = {
      telemetryV4Host: "ipv4.runtime.example",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
        }),
      ),
    );
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
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(apiMocks.telemetryPost).not.toHaveBeenCalled();
    expect(apiMocks.submitPost).not.toHaveBeenCalled();
    expect(container.textContent).toContain("rate limited");

    await act(async () => {
      root.unmount();
    });
  });

  it("resets hCaptcha after a failed submit so a retried response cannot reuse the consumed token", async () => {
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
    formBodyMockState.submitData = {
      responses: [
        {
          question_id: "q1",
          question_type: "form_short_text",
          question_title: "Name",
          value: "Alice",
        },
      ],
      visitedQuestionIds: ["q1"],
    };
    apiMocks.telemetryPost.mockReturnValue("telemetry-request");
    apiMocks.submitPost.mockReturnValue("submit-request");
    apiMocks.rpc.mockImplementation(async (request) => {
      if (request === "telemetry-request") {
        return { token: "telemetry-token" };
      }
      throw new RpcError("回答データの検証に失敗しました", 400);
    });

    const container = document.createElement("div");
    const root = renderPublicForm(container);

    await act(async () => {
      hCaptchaMockState.onVerify?.("first-captcha-token");
    });
    expect(
      container
        .querySelector("[data-testid='public-form-body']")
        ?.getAttribute("data-captcha-ready"),
    ).toBe("true");

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(apiMocks.submitPost).toHaveBeenCalledTimes(1);
    expect(apiMocks.submitPost).toHaveBeenLastCalledWith({
      param: { publicId: "public-1" },
      json: expect.objectContaining({
        captchaToken: "first-captcha-token",
      }),
    });
    expect(hCaptchaMockState.reset).toHaveBeenCalledTimes(1);
    expect(
      container
        .querySelector("[data-testid='public-form-body']")
        ?.getAttribute("data-captcha-ready"),
    ).toBe("false");

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(apiMocks.submitPost).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      "セキュリティ確認が完了していません。hCaptchaを完了してください。",
    );
    expect(hCaptchaMockState.reset).toHaveBeenCalledTimes(2);

    await act(async () => {
      hCaptchaMockState.onVerify?.("second-captcha-token");
    });
    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(apiMocks.submitPost).toHaveBeenCalledTimes(2);
    expect(apiMocks.submitPost).toHaveBeenLastCalledWith({
      param: { publicId: "public-1" },
      json: expect.objectContaining({
        captchaToken: "second-captcha-token",
      }),
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("does not reset hCaptcha state after a failed submit when the development bypass is enabled", async () => {
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
    apiMocks.rpc.mockImplementation(async (request) => {
      if (request === "telemetry-request") {
        return { token: "telemetry-token" };
      }
      throw new RpcError("回答データの検証に失敗しました", 400);
    });

    const container = document.createElement("div");
    const root = renderPublicForm(container);

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(hCaptchaMockState.reset).not.toHaveBeenCalled();
    expect(
      container
        .querySelector("[data-testid='public-form-body']")
        ?.getAttribute("data-captcha-ready"),
    ).toBe("true");
    expect(apiMocks.submitPost).toHaveBeenCalledWith({
      param: { publicId: "public-1" },
      json: expect.objectContaining({
        captchaToken: "form-security-dev-bypass",
      }),
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

  it("switches to a completion screen with confirmation details and removes the submit UI after success", async () => {
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
      structure: {
        appearance: {
          theme: {
            primary_color: "#93c5fd",
            accent_color: "#bbf7d0",
            background_color: "#111827",
            font_family: "Inter",
          },
          layout: {
            width: "medium",
            alignment: "center",
            spacing: "comfortable",
            show_progress_bar: true,
            progress_position: "top",
            show_question_numbers: false,
          },
        },
        confirmation: {
          title: "送信ありがとうございます",
          message: "受付が完了しました。",
          supplemental_link: {
            label: "次の手順",
            url: "https://example.com/next",
          },
          contact: { label: "問い合わせ", email: "help@example.com" },
          redirect_url: "https://example.com/done",
          show_response_summary: true,
          show_response_id: false,
          allow_edit_link: true,
        },
        settings: { require_fingerprint: false },
      },
    };
    formBodyMockState.submitData = {
      responses: [
        {
          question_id: "q1",
          question_type: "form_short_text",
          question_title: "Name",
          value: "Alice",
        },
      ],
      visitedQuestionIds: ["q1"],
    };
    apiMocks.telemetryPost.mockReturnValue("telemetry-request");
    apiMocks.submitPost.mockReturnValue("submit-request");
    apiMocks.rpc.mockImplementation(async (request) =>
      request === "telemetry-request"
        ? { token: "telemetry-token" }
        : {
            confirmation: publicFormData?.structure?.confirmation,
            response: null,
            responseId: "response-123",
          },
    );
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector("[data-testid='public-form-body']"),
    ).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("送信完了");
    expect(container.textContent).toContain("送信ありがとうございます");
    expect(container.textContent).toContain("受付が完了しました。");
    expect(container.textContent).not.toContain("回答 ID");
    expect(container.textContent).not.toContain("response-123");
    expect(container.textContent).toContain("回答サマリー");
    expect(container.textContent).toContain("Name");
    expect(container.textContent).toContain("Alice");
    expect(container.textContent).toContain("次の手順");
    expect(container.textContent).toContain("問い合わせ");
    expect(container.textContent).not.toContain("回答を送信");
    const surface = container.querySelector<HTMLElement>(
      "[data-form-appearance-surface='true']",
    );
    expect(surface?.style.getPropertyValue("--background")).toBe("#111827");
    expect(surface?.style.getPropertyValue("--card")).toBe("#242a38");
    expect(
      container
        .querySelector(".bg-card")
        ?.classList.contains("text-card-foreground"),
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll("a")).map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual([
      "https://example.com/next",
      "https://example.com/done",
      "mailto:help@example.com",
    ]);
    expect(apiMocks.submitPost).toHaveBeenCalledWith({
      param: { publicId: "public-1" },
      json: expect.objectContaining({
        responses: [
          {
            question_id: "q1",
            question_type: "form_short_text",
            question_title: "Name",
            value: "Alice",
          },
        ],
      }),
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("switches to the completion target section after API submit success", async () => {
    vi.stubEnv("VITE_DISABLE_HCAPTCHA", "true");
    publicFormData = {
      form: {
        description: null,
        isPasswordProtected: false,
        title: "Public form",
      },
      plateContent: completionTargetPlateContent(),
      structure: { settings: { require_fingerprint: false } },
    };
    formBodyMockState.submitData = {
      completionTargetPageId: "section-complete-vip",
      responses: [
        {
          question_id: "q-plan",
          question_type: "radio",
          question_title: "プラン",
          value: "vip",
        },
      ],
      visitedQuestionIds: ["q-plan"],
    };
    apiMocks.telemetryPost.mockReturnValue("telemetry-request");
    apiMocks.submitPost.mockReturnValue("submit-request");
    apiMocks.rpc.mockImplementation(async (request) =>
      request === "telemetry-request"
        ? { token: "telemetry-token" }
        : {
            confirmation: {
              title: "送信ありがとうございます",
              message: "受付が完了しました。",
            },
            response: null,
            responseId: "response-target",
          },
    );
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector("[data-testid='public-form-body']"),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("送信完了");
    expect(formBodyMockState.renderProps.at(-1)).toEqual(
      expect.objectContaining({
        plateContent: publicFormData.plateContent,
        submittedCompletionPageId: "section-complete-vip",
        title: "Public form",
      }),
    );
    expect(apiMocks.submitPost).toHaveBeenCalledWith({
      param: { publicId: "public-1" },
      json: expect.not.objectContaining({
        completionTargetPageId: "section-complete-vip",
      }),
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("falls back to the legacy confirmation screen when the submit target is not inputless", async () => {
    vi.stubEnv("VITE_DISABLE_HCAPTCHA", "true");
    publicFormData = {
      form: {
        description: null,
        isPasswordProtected: false,
        title: "Public form",
      },
      plateContent: completionTargetPlateContent({ answerableTarget: true }),
      structure: { settings: { require_fingerprint: false } },
    };
    formBodyMockState.submitData = {
      completionTargetPageId: "section-complete-vip",
      responses: [
        {
          question_id: "q-plan",
          question_type: "radio",
          question_title: "プラン",
          value: "vip",
        },
      ],
      visitedQuestionIds: ["q-plan"],
    };
    apiMocks.telemetryPost.mockReturnValue("telemetry-request");
    apiMocks.submitPost.mockReturnValue("submit-request");
    apiMocks.rpc.mockImplementation(async (request) =>
      request === "telemetry-request"
        ? { token: "telemetry-token" }
        : {
            confirmation: {
              title: "送信ありがとうございます",
              message: "受付が完了しました。",
            },
            response: null,
            responseId: "response-fallback",
          },
    );
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector("[data-testid='public-form-body']"),
    ).toBeNull();
    expect(container.textContent).toContain("送信完了");
    expect(container.textContent).toContain("送信ありがとうございます");
    expect(
      formBodyMockState.renderProps.some(
        (props) => props.submittedCompletionPageId === "section-complete-vip",
      ),
    ).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("does not render or follow unsafe confirmation URLs after success", async () => {
    vi.stubEnv("VITE_DISABLE_HCAPTCHA", "true");
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
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
    formBodyMockState.submitData = {
      responses: [
        {
          question_id: "q1",
          question_type: "form_short_text",
          question_title: "Name",
          value: "Alice",
        },
      ],
      visitedQuestionIds: ["q1"],
    };
    apiMocks.telemetryPost.mockReturnValue("telemetry-request");
    apiMocks.submitPost.mockReturnValue("submit-request");
    apiMocks.rpc.mockImplementation(async (request) =>
      request === "telemetry-request"
        ? { token: "telemetry-token" }
        : {
            confirmation: {
              title: "送信ありがとうございます",
              message: "受付が完了しました。",
              supplemental_link: {
                label: "危険な補足リンク",
                url: "javascript:alert(1)",
              },
              contact: {
                label: "危険な問い合わせリンク",
                url: "data:text/html,<script>alert(1)</script>",
              },
              redirect_url: "ftp://example.com/done",
            },
            response: null,
            responseId: "response-unsafe",
          },
    );
    const container = document.createElement("div");
    const root = renderPublicForm(container);

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("送信ありがとうございます");
    expect(container.textContent).not.toContain("危険な補足リンク");
    expect(container.textContent).not.toContain("今すぐ移動");
    expect(container.textContent).not.toContain("危険な問い合わせリンク");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    setTimeoutSpy.mockRestore();
  });

  it("submits only visited branch answers from a section-branching public form", async () => {
    vi.stubEnv("VITE_DISABLE_HCAPTCHA", "true");
    publicFormData = {
      form: {
        description: null,
        isPasswordProtected: false,
        title: "S28 section branching form",
      },
      plateContent: sectionBranchingPlateContent(),
      structure: { settings: { require_fingerprint: false } },
    };
    formBodyMockState.submitData = {
      responses: [
        {
          question_id: "q-entity-type",
          question_type: "radio",
          question_title: "契約種別",
          value: "individual",
        },
      ],
      visitedQuestionIds: ["q-entity-type"],
    };
    apiMocks.telemetryPost.mockReturnValue("telemetry-request");
    apiMocks.submitPost.mockReturnValue("submit-request");
    apiMocks.rpc.mockImplementation(async (request) =>
      request === "telemetry-request"
        ? { token: "telemetry-token" }
        : {
            confirmation: {
              title: "ご回答ありがとうございます",
              message: "回答を受け付けました。ご協力ありがとうございました。",
            },
            response: { id: "response-individual" },
            responseId: "response-individual",
          },
    );

    const container = document.createElement("div");
    const root = renderPublicForm(container);

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(requiredValidationMock.findUnansweredRequired).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          blockId: "q-entity-type",
          title: "契約種別",
        }),
      ],
      expect.anything(),
    );
    expect(apiMocks.submitPost).toHaveBeenCalledWith({
      param: { publicId: "public-1" },
      json: expect.objectContaining({
        responses: [
          {
            question_id: "q-entity-type",
            question_type: "radio",
            question_title: "契約種別",
            value: "individual",
          },
        ],
      }),
    });
    const submitArgs = apiMocks.submitPost.mock.calls[0]?.[0];
    expect(submitArgs?.json.responses).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ question_id: "q-company-name" }),
      ]),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps double-clicks from sending twice or reviving required errors after success", async () => {
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
        : {
            confirmation: {
              title: "ご回答ありがとうございます",
              message: "回答を受け付けました。ご協力ありがとうございました。",
            },
            response: { id: "response-locked" },
            responseId: "response-locked",
          },
    );
    const container = document.createElement("div");
    const root = renderPublicForm(container);
    const submitButton = container.querySelector("button");

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    requiredValidationMock.findUnansweredRequired.mockReturnValue([
      { blockId: "q1", title: "Name", type: "short_text" },
    ]);

    expect(apiMocks.telemetryPost).toHaveBeenCalledTimes(1);
    expect(apiMocks.submitPost).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector("[data-testid='public-form-body']"),
    ).toBeNull();
    expect(container.textContent).toContain("response-locked");
    expect(container.textContent).not.toContain("必須項目が未入力です");

    await act(async () => {
      root.unmount();
    });
  });
});
