import {
  extractQuestionsFromPlateContent,
  isCompletionTargetPage,
  type ResponseDataItem,
  resolvePageIndexByPageId,
  responsePayloadItemSchema,
  splitPlateContentIntoPages,
} from "@nexus-form/shared";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { z } from "zod";
import {
  FormResponseProvider,
  useFormResponse,
} from "@/contexts/form-response-context";
import {
  type FingerprintType,
  useFingerprint,
} from "@/hooks/fingerprint/use-fingerprint";
import { usePageTitle } from "@/hooks/use-page-title";
import { client, RpcError, rpc } from "@/lib/api";
import { getRuntimeBrandConfig } from "@/lib/brand-config";
import { findUnansweredRequired } from "@/lib/forms/find-unanswered-required";
import { decodePrefillData } from "@/lib/forms/prefill";
import { shouldRetryQuery } from "@/lib/query-retry";
import { sanitizeFormPlateContent } from "@/lib/rich-text";
import { getRuntimeConfigValue } from "@/lib/runtime-config";
import {
  fetchPublicSubmitTelemetryToken,
  type PublicSubmitTelemetryToken,
} from "@/lib/telemetry-token";
import { cn } from "@/lib/utils";
import {
  type FormAppearance,
  FormAppearanceSchema,
  type FormConfirmation,
  SafeConfirmationUrlSchema,
} from "@/types/validation/form";
import {
  FormAppearanceSurface,
  normalizeFormAppearance,
} from "./form-appearance-surface";
import { FormBody, type FormSubmitRequestData } from "./form-body";
import { FormNotFoundPage } from "./form-not-found-page";
import { HCaptchaWidget, type HCaptchaWidgetHandle } from "./hcaptcha-widget";
import { PasswordProtectionGate } from "./password-protection-gate";

const fetchPublicForm = (publicId: string) =>
  rpc(client.api.forms.public[":publicId"].$get({ param: { publicId } }));

const responsesSchema = z.array(responsePayloadItemSchema);
const formSecurityBypassToken = "form-security-dev-bypass";
const MAX_FINGERPRINTS_FOR_SUBMIT = 200;
const fingerprintExchangeVersion = 1;
const fingerprintTypeCode: Record<FingerprintType, number> = {
  browser: 1,
  fingerprintjs: 2,
  thumbmarkjs: 3,
};

const hasPublicSubmitTelemetryToken = (
  token: PublicSubmitTelemetryToken | undefined,
): token is PublicSubmitTelemetryToken =>
  Boolean(token?.v4Token || token?.v6Token);

type CollectedFingerprintComponent = {
  componentName: string;
  componentValueHash: string;
};

type CollectedFingerprintData = {
  fingerprintType: FingerprintType | string;
  components: CollectedFingerprintComponent[];
};

type ResponseSummaryItem = {
  questionId: string;
  title: string;
  value: string;
};

function isFormSecurityBypassEnabledForDevelopment(): boolean {
  const formSecurityBypassFlag = getRuntimeConfigValue(
    "formSecurityDevBypass",
    import.meta.env.VITE_FORM_SECURITY_DEV_BYPASS,
  );
  return import.meta.env.DEV && formSecurityBypassFlag === "true";
}

function isHCaptchaBypassEnabledForDevelopment(): boolean {
  return (
    isFormSecurityBypassEnabledForDevelopment() ||
    (import.meta.env.DEV && import.meta.env.VITE_DISABLE_HCAPTCHA === "true")
  );
}

const fingerprintTypePriority = (type: string, name: string): number => {
  if (type === "fingerprintjs" && name === "visitorId") return 300;
  if (type === "browser") return 250;
  if (type === "fingerprintjs") return 200;
  if (type === "thumbmarkjs") return 100;
  return 0;
};

function buildFingerprintPayloadForSubmit(
  collectedFingerprints: CollectedFingerprintData[],
): { type: FingerprintType; name: string; value_hash: string }[] {
  const flat = collectedFingerprints.flatMap(
    ({ fingerprintType, components }) =>
      components.map((comp, index) => ({
        type: fingerprintType,
        name: comp.componentName,
        value_hash: comp.componentValueHash,
        priority:
          fingerprintTypePriority(fingerprintType, comp.componentName) +
          1_000 -
          index,
        sourceOrder: index,
      })),
  );

  return flat
    .sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.sourceOrder - b.sourceOrder;
    })
    .slice(0, MAX_FINGERPRINTS_FOR_SUBMIT)
    .map(({ type, name, value_hash }) => ({
      type: type as FingerprintType,
      name,
      value_hash,
    }));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function xorWithDerivedStream(
  payload: Uint8Array,
  seed: string,
): Promise<Uint8Array> {
  const output = new Uint8Array(payload.length);
  const encoder = new TextEncoder();
  let offset = 0;
  let counter = 0;
  while (offset < payload.length) {
    const block = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(`${seed}:${counter}`),
      ),
    );
    for (const byte of block) {
      if (offset >= payload.length) break;
      output[offset] = (payload[offset] ?? 0) ^ byte;
      offset += 1;
    }
    counter += 1;
  }
  return output;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function randomClientNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function buildFingerprintExchangeBlob(params: {
  challengeToken: string;
  exchangeNonce: string;
  clientNonce: string;
  challengeTokenHash: string;
  fieldMap: [string, string, string];
  componentOrder: number[];
  fingerprints: { type: FingerprintType; name: string; value_hash: string }[];
}): Promise<{ blob: string; digest: string }> {
  const [typeKey, nameKey, hashKey] = params.fieldMap;
  const orderIndex = new Map(
    params.componentOrder.map((code, index) => [code, index]),
  );
  const encodedEntries = params.fingerprints
    .map((fingerprint, index) => ({
      sortCode: fingerprintTypeCode[fingerprint.type],
      originalIndex: index,
      wire: {
        [typeKey]: fingerprintTypeCode[fingerprint.type],
        [nameKey]: fingerprint.name,
        [hashKey]: fingerprint.value_hash,
      } satisfies Record<string, string | number>,
    }))
    .sort((a, b) => {
      const left = orderIndex.get(a.sortCode) ?? Number.MAX_SAFE_INTEGER;
      const right = orderIndex.get(b.sortCode) ?? Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return a.originalIndex - b.originalIndex;
    })
    .map((entry) => entry.wire);
  const plaintext = new TextEncoder().encode(JSON.stringify(encodedEntries));
  const seed = [
    params.challengeToken,
    params.exchangeNonce,
    params.clientNonce,
  ].join("\0");
  const canonicalDetails = params.fingerprints
    .map((fingerprint) => [
      fingerprint.type,
      fingerprint.name,
      fingerprint.value_hash,
    ])
    .sort(([leftType, leftName], [rightType, rightName]) => {
      const typeOrder = String(leftType).localeCompare(String(rightType));
      if (typeOrder !== 0) return typeOrder;
      return String(leftName).localeCompare(String(rightName));
    });
  const digest = await sha256Hex(
    [
      "nexus-exchange-observation-v1",
      params.challengeTokenHash,
      params.exchangeNonce,
      params.clientNonce,
      JSON.stringify(canonicalDetails),
    ].join("\0"),
  );
  return {
    blob: base64UrlEncode(await xorWithDerivedStream(plaintext, seed)),
    digest,
  };
}

interface PublicFormPageState {
  isSubmitting: boolean;
  error: string | null;
  submitted: {
    responseId: string;
    confirmation: FormConfirmation;
    responseSummary: ResponseSummaryItem[];
    completionTargetPageId?: string;
  } | null;
  captchaToken: string | null;
  hasVerifiedPassword: boolean;
}

type PublicFormPageAction =
  | { type: "captcha-verified"; token: string }
  | { type: "captcha-expired" }
  | { type: "submit-start" }
  | {
      type: "submit-success";
      responseId: string;
      confirmation: FormConfirmation;
      responseSummary: ResponseSummaryItem[];
      completionTargetPageId?: string;
    }
  | { type: "submit-error"; message: string }
  | { type: "password-verified" }
  | { type: "set-error"; message: string | null };

const initialPublicFormPageState: PublicFormPageState = {
  isSubmitting: false,
  error: null,
  submitted: null,
  captchaToken: null,
  hasVerifiedPassword: false,
};

function publicFormPageReducer(
  state: PublicFormPageState,
  action: PublicFormPageAction,
): PublicFormPageState {
  switch (action.type) {
    case "captcha-verified":
      if (state.submitted) return state;
      return { ...state, captchaToken: action.token };
    case "captcha-expired":
      if (state.submitted) return state;
      return { ...state, captchaToken: null };
    case "submit-start":
      if (state.submitted) return state;
      return { ...state, isSubmitting: true, error: null };
    case "submit-success":
      return {
        ...state,
        isSubmitting: false,
        submitted: {
          responseId: action.responseId,
          confirmation: action.confirmation,
          responseSummary: action.responseSummary,
          completionTargetPageId: action.completionTargetPageId,
        },
        captchaToken: null,
        error: null,
      };
    case "submit-error":
      if (state.submitted) return state;
      return { ...state, isSubmitting: false, error: action.message };
    case "password-verified":
      return { ...state, hasVerifiedPassword: true };
    case "set-error":
      if (state.submitted) return state;
      return { ...state, error: action.message };
  }
}

function formatResponseValue(value: ResponseDataItem["value"]): string {
  if (value === null || value === undefined || value === "") {
    return "未回答";
  }
  return String(value);
}

function formatResponseSummaryValue(item: ResponseDataItem): string {
  const values: string[] = [];
  if (item.value !== undefined) {
    values.push(formatResponseValue(item.value));
  }
  if (item.values && item.values.length > 0) {
    values.push(item.values.map((value) => String(value)).join(", "));
  }
  if (item.responses && Object.keys(item.responses).length > 0) {
    values.push(
      Object.entries(item.responses)
        .map(([rowId, value]) => {
          const formattedValue = Array.isArray(value)
            ? value.join(", ")
            : value;
          return `${rowId}: ${formattedValue}`;
        })
        .join(" / "),
    );
  }
  if (item.other_value) {
    values.push(`その他: ${item.other_value}`);
  }
  if (item.other_values && item.other_values.length > 0) {
    values.push(`その他: ${item.other_values.join(", ")}`);
  }
  return values.join(" / ") || "未回答";
}

function buildResponseSummary(
  items: ResponseDataItem[],
): ResponseSummaryItem[] {
  return items.map((item) => ({
    questionId: item.question_id,
    title: item.question_title?.trim() || item.question_id,
    value: formatResponseSummaryValue(item),
  }));
}

function resolveValidCompletionTargetPageId(
  plateContent: unknown[],
  completionTargetPageId: string | undefined,
): string | undefined {
  if (!completionTargetPageId) return undefined;
  const pages = splitPlateContentIntoPages(plateContent);
  const pageIndex = resolvePageIndexByPageId(pages, completionTargetPageId);
  const page = pages[pageIndex];
  return page && isCompletionTargetPage(page) ? page.pageId : undefined;
}

function PublicFormLoadingStatus({ message }: { message: string }) {
  return (
    <section aria-busy="true" className="p-6" data-public-form-loading="true">
      <p className="text-sm text-muted-foreground">{message}</p>
    </section>
  );
}

function publicFormLegalLinksWidthClass(
  width: FormAppearance["layout"]["width"],
): string {
  switch (width) {
    case "full":
      return "max-w-none";
    case "compact":
      return "max-w-2xl";
    case "medium":
      return "max-w-3xl";
  }
}

function PublicFormLegalLinks({
  appearance: appearanceProp,
}: {
  appearance?: FormAppearance;
}): ReactElement | null {
  const { termsUrl, privacyUrl } = useMemo(() => getRuntimeBrandConfig(), []);
  if (!termsUrl && !privacyUrl) return null;

  const appearance = normalizeFormAppearance(appearanceProp);
  const isCentered = appearance.layout.alignment === "center";

  return (
    <nav
      aria-label="ブランドの法的リンク"
      className={cn(
        "w-full px-6 pt-1 pb-6 text-xs text-muted-foreground",
        publicFormLegalLinksWidthClass(appearance.layout.width),
        isCentered ? "mx-auto text-center" : "mr-auto text-left",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-2",
          isCentered ? "justify-center" : "justify-start",
        )}
      >
        {termsUrl && (
          <a
            href={termsUrl}
            className="transition-colors underline-offset-4 hover:text-foreground hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            利用規約
          </a>
        )}
        {termsUrl && privacyUrl && <span className="text-border">|</span>}
        {privacyUrl && (
          <a
            href={privacyUrl}
            className="transition-colors underline-offset-4 hover:text-foreground hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            プライバシーポリシー
          </a>
        )}
      </div>
    </nav>
  );
}

function PublicFormAppearanceShell({
  appearance,
  children,
}: {
  appearance?: FormAppearance;
  children: ReactNode;
}): ReactElement {
  return (
    <FormAppearanceSurface
      appearance={appearance}
      className="flex min-h-dvh flex-col"
    >
      <div className="flex-1">{children}</div>
      <PublicFormLegalLinks appearance={appearance} />
    </FormAppearanceSurface>
  );
}

function safeConfirmationUrl(value: string | undefined): string | undefined {
  const result = SafeConfirmationUrlSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function PublicSubmitCompletion({
  responseId,
  confirmation,
  responseSummary,
}: {
  responseId: string;
  confirmation: FormConfirmation;
  responseSummary: ResponseSummaryItem[];
}) {
  const redirectUrl = safeConfirmationUrl(confirmation.redirect_url);
  const supplementalLinkUrl = safeConfirmationUrl(
    confirmation.supplemental_link?.url,
  );
  const contactUrl = safeConfirmationUrl(confirmation.contact?.url);

  useEffect(() => {
    if (!redirectUrl) return;

    const redirectTimeout = window.setTimeout(() => {
      window.location.replace(redirectUrl);
    }, 1500);

    return () => window.clearTimeout(redirectTimeout);
  }, [redirectUrl]);

  const contactHref = confirmation.contact?.email
    ? `mailto:${confirmation.contact.email}`
    : contactUrl;
  const contactLabel =
    confirmation.contact?.label ?? confirmation.contact?.email ?? contactUrl;

  return (
    <section className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="rounded-lg border bg-card p-6 text-card-foreground">
        <div className="space-y-3">
          <p className="text-sm font-medium text-emerald-600">送信完了</p>
          <h1 className="text-2xl font-semibold">{confirmation.title}</h1>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {confirmation.message}
          </p>
          {confirmation.show_response_id !== false ? (
            <dl className="rounded-md bg-muted/40 px-4 py-3 text-sm">
              <dt className="font-medium">回答 ID</dt>
              <dd className="mt-1 font-mono text-muted-foreground">
                {responseId}
              </dd>
            </dl>
          ) : null}
          {confirmation.show_response_summary ? (
            <section
              aria-label="回答サマリー"
              className="rounded-md bg-muted/40 px-4 py-3 text-sm"
            >
              <h2 className="font-medium">回答サマリー</h2>
              {responseSummary.length > 0 ? (
                <dl className="mt-3 space-y-3">
                  {responseSummary.map((item) => (
                    <div key={item.questionId}>
                      <dt className="font-medium">{item.title}</dt>
                      <dd className="mt-1 whitespace-pre-wrap text-muted-foreground">
                        {item.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-2 text-muted-foreground">
                  回答内容はありません。
                </p>
              )}
            </section>
          ) : null}
          {/* TODO: render an edit URL here when public response editing is available. */}
          <div className="flex flex-wrap gap-3">
            {confirmation.supplemental_link && supplementalLinkUrl ? (
              <a
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                href={supplementalLinkUrl}
                rel="noreferrer"
                target="_blank"
              >
                {confirmation.supplemental_link.label}
              </a>
            ) : null}
            {redirectUrl ? (
              <a
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                href={redirectUrl}
              >
                今すぐ移動
              </a>
            ) : null}
            {contactHref && contactLabel ? (
              <a
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                href={contactHref}
                rel="noreferrer"
                target={
                  contactHref.startsWith("mailto:") ? undefined : "_blank"
                }
              >
                {contactLabel}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export function PublicFormPage() {
  const { p: prefillParam } = useSearch({
    from: "/forms/public/$publicId",
  });
  const initialAnswers = useMemo(() => {
    if (!prefillParam) return undefined;
    const decoded = decodePrefillData(prefillParam);
    if (!decoded) return undefined;
    return new Map(Object.entries(decoded));
  }, [prefillParam]);

  return (
    <FormResponseProvider initialAnswers={initialAnswers}>
      <PublicFormPageInner />
    </FormResponseProvider>
  );
}

function PublicFormPageInner() {
  const { publicId } = useParams({ from: "/forms/public/$publicId" });
  const [state, dispatch] = useReducer(
    publicFormPageReducer,
    initialPublicFormPageState,
  );
  const { answers, clearAnswers } = useFormResponse();

  const captchaRef = useRef<HCaptchaWidgetHandle>(null);
  const submitLockRef = useRef(false);
  const publicSubmitTelemetryTokenStaleRef = useRef(false);
  const { fingerprints, collect: collectFingerprints } = useFingerprint({
    autoCollect: false,
  });

  const {
    data: formData,
    isPending: isLoading,
    error: fetchError,
    refetch: refetchForm,
  } = useQuery({
    queryKey: ["publicForm", publicId],
    queryFn: () => fetchPublicForm(publicId),
    retry: shouldRetryQuery,
  });

  usePageTitle(formData?.form?.title ?? "公開フォーム");

  const notFound = fetchError instanceof RpcError && fetchError.status === 404;
  const requireSecurityCheck = true;
  const formSecurityBypassEnabled = isFormSecurityBypassEnabledForDevelopment();
  const hCaptchaBypassEnabled = isHCaptchaBypassEnabledForDevelopment();
  const publicFormBodyReady = Boolean(
    formData?.plateContent !== null && formData?.structure !== null,
  );
  const shouldLoadPublicSubmitTelemetryToken =
    Boolean(formData) && publicFormBodyReady && !formSecurityBypassEnabled;
  const {
    data: publicSubmitTelemetryToken,
    error: publicSubmitTelemetryTokenError,
    isFetching: isPublicSubmitTelemetryTokenFetching,
    isPending: isPublicSubmitTelemetryTokenPending,
    refetch: refetchPublicSubmitTelemetryToken,
  } = useQuery({
    queryKey: ["publicSubmitTelemetryToken", publicId],
    queryFn: fetchPublicSubmitTelemetryToken,
    enabled: shouldLoadPublicSubmitTelemetryToken,
    retry: false,
  });
  const appearanceResult = FormAppearanceSchema.safeParse(
    formData?.structure?.appearance ?? {},
  );
  const appearance = appearanceResult.success
    ? appearanceResult.data
    : undefined;

  const handleCaptchaVerify = useCallback((token: string) => {
    dispatch({ type: "captcha-verified", token });
  }, []);

  const handleCaptchaExpire = useCallback(() => {
    dispatch({ type: "captcha-expired" });
  }, []);

  const handleSubmitRequest = useCallback(
    async (data: FormSubmitRequestData) => {
      if (submitLockRef.current || state.submitted) return;
      submitLockRef.current = true;
      let submittedWithTelemetryToken = false;
      try {
        dispatch({ type: "submit-start" });

        // Re-validate unanswered required questions from visited pages
        let parsedContent: unknown[];
        try {
          const raw: unknown = JSON.parse(formData?.plateContent ?? "[]");
          if (!Array.isArray(raw)) {
            throw new SyntaxError("not an array");
          }
          parsedContent = sanitizeFormPlateContent(raw);
        } catch {
          throw new Error(
            "フォームデータの解析に失敗しました。ページを再読み込みしてください。",
          );
        }
        const allQuestions = extractQuestionsFromPlateContent(parsedContent);
        if (allQuestions.length === 0) {
          throw new Error("このフォームには質問がありません。");
        }
        const visitedIds = new Set(data.visitedQuestionIds);
        const submittableQuestions = allQuestions.filter(
          (q) => visitedIds.has(q.blockId) && q.type !== "section_separator",
        );
        const unanswered = findUnansweredRequired(
          submittableQuestions,
          answers,
        );
        if (unanswered.length > 0) {
          const names = unanswered
            .map((q) => q.title || "無題の質問")
            .join("、");
          throw new Error(`必須項目が未入力です: ${names}`);
        }

        const parsedInput = responsesSchema.safeParse(data.responses);
        if (!parsedInput.success) {
          throw new Error("回答データの形式が不正です");
        }

        // hCaptchaトークンの確認
        const captchaToken = hCaptchaBypassEnabled
          ? formSecurityBypassToken
          : state.captchaToken;
        if (!captchaToken) {
          throw new Error(
            "セキュリティ確認が完了していません。hCaptchaを完了してください。",
          );
        }

        // セキュリティ確認
        let collectedFp = fingerprints;
        if (
          requireSecurityCheck &&
          !formSecurityBypassEnabled &&
          collectedFp.length === 0
        ) {
          collectedFp = await collectFingerprints();
        }

        const fingerprintsPayload =
          requireSecurityCheck && !formSecurityBypassEnabled
            ? buildFingerprintPayloadForSubmit(collectedFp)
            : [];

        if (
          requireSecurityCheck &&
          !formSecurityBypassEnabled &&
          fingerprintsPayload.length === 0
        ) {
          throw new Error(
            "セキュリティ確認に失敗しました。ページを再読み込みしてください。",
          );
        }

        let securityVerificationToken: string | undefined;
        if (requireSecurityCheck && !formSecurityBypassEnabled) {
          const exchangeOpen = await rpc(
            client.api.forms.public[":publicId"].exchange.open.$post({
              param: { publicId },
            }),
          );
          if (
            exchangeOpen.v !== fingerprintExchangeVersion ||
            exchangeOpen.m.length !== 3
          ) {
            throw new Error(
              "セキュリティ確認の初期化に失敗しました。ページを再読み込みしてください。",
            );
          }
          const clientNonce = randomClientNonce();
          const challengeTokenHash = await sha256Hex(
            `fingerprint-exchange-token:${exchangeOpen.r}`,
          );
          const { blob, digest } = await buildFingerprintExchangeBlob({
            challengeToken: exchangeOpen.r,
            challengeTokenHash,
            exchangeNonce: exchangeOpen.n,
            clientNonce,
            fieldMap: [exchangeOpen.m[0], exchangeOpen.m[1], exchangeOpen.m[2]],
            componentOrder: exchangeOpen.o,
            fingerprints: fingerprintsPayload,
          });
          const exchangeClose = await rpc(
            client.api.forms.public[":publicId"].exchange.close.$post({
              param: { publicId },
              json: {
                r: exchangeOpen.r,
                v: fingerprintExchangeVersion,
                n: clientNonce,
                b: blob,
                d: digest,
              },
            }),
          );
          securityVerificationToken = exchangeClose.t;
        }

        // ページ読み込み時に取得済みのテレメトリトークンを使用する
        const telemetryToken = formSecurityBypassEnabled
          ? { v4Token: formSecurityBypassToken }
          : publicSubmitTelemetryToken;
        if (
          !formSecurityBypassEnabled &&
          publicSubmitTelemetryTokenStaleRef.current
        ) {
          if (
            publicSubmitTelemetryTokenError instanceof Error &&
            !isPublicSubmitTelemetryTokenFetching
          ) {
            throw new Error(
              "テレメトリトークンの再取得に失敗しました。ページを再読み込みしてください。",
            );
          }
          throw new Error(
            "テレメトリトークンを再取得中です。しばらく待ってから再度送信してください。",
          );
        }
        if (!hasPublicSubmitTelemetryToken(telemetryToken)) {
          if (publicSubmitTelemetryTokenError instanceof Error) {
            void refetchPublicSubmitTelemetryToken();
            throw publicSubmitTelemetryTokenError;
          }
          throw new Error(
            isPublicSubmitTelemetryTokenPending
              ? "テレメトリトークンを取得中です。しばらく待ってから再度送信してください。"
              : "テレメトリトークンを取得できませんでした。ページを再読み込みしてください。",
          );
        }

        // 回答の送信
        submittedWithTelemetryToken = true;
        const submitResult = await rpc(
          client.api.forms.public[":publicId"].submit.$post({
            param: { publicId },
            json: {
              responses: parsedInput.data,
              captchaToken,
              telemetry: telemetryToken,
              securityVerificationToken,
            },
          }),
        );

        const responseId = submitResult.responseId ?? submitResult.response?.id;
        if (!responseId) {
          throw new Error("回答 ID を取得できませんでした。");
        }
        const confirmation = submitResult.confirmation;
        dispatch({
          type: "submit-success",
          responseId,
          confirmation,
          responseSummary: buildResponseSummary(parsedInput.data),
          completionTargetPageId: resolveValidCompletionTargetPageId(
            parsedContent,
            data.completionTargetPageId,
          ),
        });
        clearAnswers();

        // hCaptchaをリセット（再送信時に再度認証が必要）
        captchaRef.current?.reset();
      } catch (submitError) {
        submitLockRef.current = false;
        if (!hCaptchaBypassEnabled) {
          dispatch({ type: "captcha-expired" });
          captchaRef.current?.reset();
        }
        if (!formSecurityBypassEnabled && submittedWithTelemetryToken) {
          publicSubmitTelemetryTokenStaleRef.current = true;
          void refetchPublicSubmitTelemetryToken().then((result) => {
            if (
              result.status === "success" &&
              hasPublicSubmitTelemetryToken(result.data)
            ) {
              publicSubmitTelemetryTokenStaleRef.current = false;
            }
          });
        }
        dispatch({
          type: "submit-error",
          message:
            submitError instanceof Error
              ? submitError.message
              : "不明なエラーが発生しました",
        });
      }
    },
    [
      formData?.plateContent,
      answers,
      state.captchaToken,
      state.submitted,
      formSecurityBypassEnabled,
      hCaptchaBypassEnabled,
      fingerprints,
      publicSubmitTelemetryToken,
      refetchPublicSubmitTelemetryToken,
      publicId,
      collectFingerprints,
      publicSubmitTelemetryTokenError,
      isPublicSubmitTelemetryTokenPending,
      isPublicSubmitTelemetryTokenFetching,
      clearAnswers,
    ],
  );

  if (isLoading) {
    return <PublicFormLoadingStatus message="フォームを準備しています。" />;
  }

  if (notFound) {
    return (
      <FormNotFoundPage description="このフォームは存在しないか、現在公開されていません。公開 URL が再生成された可能性もあります。最新の URL をフォーム管理者に確認してください。" />
    );
  }

  if (!formData) {
    const fetchErrorMessage =
      fetchError instanceof Error
        ? fetchError.message
        : "不明なエラーが発生しました";
    return (
      <section className="p-6">
        <p className="text-sm text-destructive">{fetchErrorMessage}</p>
      </section>
    );
  }

  if (state.submitted) {
    if (state.submitted.completionTargetPageId) {
      return (
        <PublicFormAppearanceShell appearance={appearance}>
          <FormBody
            title={formData.form.title ?? "公開フォーム"}
            description={formData.form.description ?? undefined}
            plateContent={formData.plateContent ?? "[]"}
            mode="public"
            appearance={appearance}
            captchaReady={true}
            submittedCompletionPageId={state.submitted.completionTargetPageId}
          />
        </PublicFormAppearanceShell>
      );
    }

    return (
      <PublicFormAppearanceShell appearance={appearance}>
        <PublicSubmitCompletion
          responseId={state.submitted.responseId}
          confirmation={state.submitted.confirmation}
          responseSummary={state.submitted.responseSummary}
        />
      </PublicFormAppearanceShell>
    );
  }

  return formData.form.isPasswordProtected === true &&
    !state.hasVerifiedPassword &&
    (formData.plateContent === null || formData.structure === null) ? (
    <PasswordProtectionGate
      publicId={publicId}
      passwordHint={formData.form.passwordHint}
      onVerified={async (): Promise<void> => {
        const result = await refetchForm();
        if (result.error) throw result.error;
        if (
          !result.data ||
          result.data.plateContent === null ||
          result.data.structure === null
        ) {
          throw new Error("Public form body is still locked");
        }
        dispatch({ type: "password-verified" });
      }}
    >
      <PublicFormLoadingStatus message="フォーム本文を復元しています。" />
    </PasswordProtectionGate>
  ) : (
    <PublicFormAppearanceShell appearance={appearance}>
      <FormBody
        title={formData.form.title ?? "公開フォーム"}
        description={formData.form.description ?? undefined}
        plateContent={formData.plateContent ?? "[]"}
        mode="public"
        appearance={appearance}
        onSubmitRequest={(data) => void handleSubmitRequest(data)}
        preSubmitSlot={
          hCaptchaBypassEnabled ? null : (
            <HCaptchaWidget
              ref={captchaRef}
              onVerify={handleCaptchaVerify}
              onExpire={handleCaptchaExpire}
            />
          )
        }
        isSubmitting={state.isSubmitting}
        captchaReady={hCaptchaBypassEnabled || !!state.captchaToken}
        error={state.error}
        success={null}
        onErrorChange={(message) => dispatch({ type: "set-error", message })}
      />
    </PublicFormAppearanceShell>
  );
}
