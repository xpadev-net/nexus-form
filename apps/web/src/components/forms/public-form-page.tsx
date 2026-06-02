import {
  extractQuestionsFromPlateContent,
  responsePayloadItemSchema,
} from "@nexus-form/shared";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
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
import { findUnansweredRequired } from "@/lib/forms/find-unanswered-required";
import { decodePrefillData } from "@/lib/forms/prefill";
import { shouldRetryQuery } from "@/lib/query-retry";
import { sanitizeFormPlateContent } from "@/lib/rich-text";
import { getRuntimeConfigValue } from "@/lib/runtime-config";
import {
  FormAppearanceSchema,
  type FormConfirmation,
  FormConfirmationSchema,
} from "@/types/validation/form";
import { FormBody, type FormSubmitRequestData } from "./form-body";
import { FormNotFoundPage } from "./form-not-found-page";
import { HCaptchaWidget, type HCaptchaWidgetHandle } from "./hcaptcha-widget";
import { PasswordProtectionGate } from "./password-protection-gate";

const fetchPublicForm = (publicId: string) =>
  rpc(client.api.forms.public[":publicId"].$get({ param: { publicId } }));

const responsesSchema = z.array(responsePayloadItemSchema);
const formSecurityBypassToken = "form-security-dev-bypass";
const MAX_FINGERPRINTS_FOR_SUBMIT = 200;

type CollectedFingerprintComponent = {
  componentName: string;
  componentValueHash: string;
};

type CollectedFingerprintData = {
  fingerprintType: FingerprintType | string;
  components: CollectedFingerprintComponent[];
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

interface PublicFormPageState {
  isSubmitting: boolean;
  error: string | null;
  submitted: {
    responseId: string;
    confirmation: FormConfirmation;
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

function PublicSubmitCompletion({
  responseId,
  confirmation,
}: {
  responseId: string;
  confirmation: FormConfirmation;
}) {
  useEffect(() => {
    const redirectUrl = confirmation.redirect_url;
    if (!redirectUrl) return;

    const redirectTimeout = window.setTimeout(() => {
      window.location.replace(redirectUrl);
    }, 1500);

    return () => window.clearTimeout(redirectTimeout);
  }, [confirmation.redirect_url]);

  const contactHref = confirmation.contact?.email
    ? `mailto:${confirmation.contact.email}`
    : confirmation.contact?.url;
  const contactLabel =
    confirmation.contact?.label ??
    confirmation.contact?.email ??
    confirmation.contact?.url;

  return (
    <section className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="rounded-lg border bg-card p-6">
        <div className="space-y-3">
          <p className="text-sm font-medium text-emerald-600">送信完了</p>
          <h1 className="text-2xl font-semibold">{confirmation.title}</h1>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {confirmation.message}
          </p>
          <dl className="rounded-md bg-muted/40 px-4 py-3 text-sm">
            <dt className="font-medium">回答 ID</dt>
            <dd className="mt-1 font-mono text-muted-foreground">
              {responseId}
            </dd>
          </dl>
          <div className="flex flex-wrap gap-3">
            {confirmation.supplemental_link ? (
              <a
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                href={confirmation.supplemental_link.url}
                rel="noreferrer"
                target="_blank"
              >
                {confirmation.supplemental_link.label}
              </a>
            ) : null}
            {confirmation.redirect_url ? (
              <a
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                href={confirmation.redirect_url}
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
  const requireFingerprint =
    formData?.structure?.settings?.require_fingerprint !== false;
  const formSecurityBypassEnabled = isFormSecurityBypassEnabledForDevelopment();
  const hCaptchaBypassEnabled = isHCaptchaBypassEnabledForDevelopment();
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

        // フィンガープリントの収集（設定で要求されている場合のみ）
        let collectedFp = fingerprints;
        if (
          requireFingerprint &&
          !formSecurityBypassEnabled &&
          collectedFp.length === 0
        ) {
          collectedFp = await collectFingerprints();
        }

        const fingerprintsPayload =
          requireFingerprint && !formSecurityBypassEnabled
            ? buildFingerprintPayloadForSubmit(collectedFp)
            : [];

        if (
          requireFingerprint &&
          !formSecurityBypassEnabled &&
          fingerprintsPayload.length === 0
        ) {
          throw new Error(
            "フィンガープリントの収集に失敗しました。ページを再読み込みしてください。",
          );
        }

        // テレメトリトークンの取得
        const telemetryToken = formSecurityBypassEnabled
          ? formSecurityBypassToken
          : (await rpc(client.api.telemetry.v4.$post())).token;

        // 回答の送信
        const submitResult = await rpc(
          client.api.forms.public[":publicId"].submit.$post({
            param: { publicId },
            json: {
              responses: parsedInput.data,
              captchaToken,
              telemetry: { v4Token: telemetryToken },
              fingerprints: fingerprintsPayload,
            },
          }),
        );

        const responseId = submitResult.responseId ?? submitResult.response?.id;
        if (!responseId) {
          throw new Error("回答 ID を取得できませんでした。");
        }
        const confirmation = FormConfirmationSchema.parse(
          submitResult.confirmation,
        );
        dispatch({ type: "submit-success", responseId, confirmation });
        clearAnswers();

        // hCaptchaをリセット（再送信時に再度認証が必要）
        captchaRef.current?.reset();
      } catch (submitError) {
        submitLockRef.current = false;
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
      requireFingerprint,
      collectFingerprints,
      publicId,
      clearAnswers,
    ],
  );

  if (isLoading) {
    return <section className="p-6">読み込み中...</section>;
  }

  if (notFound) {
    return <FormNotFoundPage />;
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
    return (
      <PublicSubmitCompletion
        responseId={state.submitted.responseId}
        confirmation={state.submitted.confirmation}
      />
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
      <section className="p-6">読み込み中...</section>
    </PasswordProtectionGate>
  ) : (
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
  );
}
