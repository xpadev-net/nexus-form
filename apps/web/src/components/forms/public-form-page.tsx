import {
  extractQuestionsFromPlateContent,
  responsePayloadItemSchema,
} from "@nexus-form/shared";
import { useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  FormResponseProvider,
  useFormResponse,
} from "@/contexts/form-response-context";
import { useFingerprint } from "@/hooks/fingerprint/use-fingerprint";
import { client, RpcError, rpc } from "@/lib/api";
import { findUnansweredRequired } from "@/lib/forms/find-unanswered-required";
import { FormBody, type FormSubmitRequestData } from "./form-body";
import { FormNotFoundPage } from "./form-not-found-page";
import { HCaptchaWidget, type HCaptchaWidgetHandle } from "./hcaptcha-widget";

const fetchPublicForm = (publicId: string) =>
  rpc(client.api.forms.public[":publicId"].$get({ param: { publicId } }));

type PublicFormData = Awaited<ReturnType<typeof fetchPublicForm>>;

const responsesSchema = z.array(responsePayloadItemSchema);

export function PublicFormPage() {
  return (
    <FormResponseProvider>
      <PublicFormPageInner />
    </FormResponseProvider>
  );
}

function PublicFormPageInner() {
  const { publicId } = useParams({ from: "/forms/public/$publicId" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formData, setFormData] = useState<PublicFormData | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const { answers, clearAnswers } = useFormResponse();

  const captchaRef = useRef<HCaptchaWidgetHandle>(null);
  const { fingerprint, collect: collectFingerprint } = useFingerprint({
    autoCollect: true,
  });

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await fetchPublicForm(publicId);

        if (active) {
          setFormData(result);
        }
      } catch (loadError) {
        if (active) {
          if (loadError instanceof RpcError && loadError.status === 404) {
            setNotFound(true);
          } else {
            setError(
              loadError instanceof Error
                ? loadError.message
                : "不明なエラーが発生しました",
            );
          }
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [publicId]);

  const handleCaptchaVerify = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  const handleCaptchaExpire = useCallback(() => {
    setCaptchaToken(null);
  }, []);

  const handleSubmitRequest = useCallback(
    async (data: FormSubmitRequestData) => {
      try {
        setIsSubmitting(true);
        setError(null);
        setSuccess(null);

        // Re-validate unanswered required questions from visited pages
        let parsedContent: unknown[];
        try {
          const raw: unknown = JSON.parse(formData?.plateContent ?? "[]");
          if (!Array.isArray(raw)) {
            throw new SyntaxError("not an array");
          }
          parsedContent = raw;
        } catch {
          throw new Error(
            "フォームデータの解析に失敗しました。ページを再読み込みしてください。",
          );
        }
        const allQuestions = extractQuestionsFromPlateContent(parsedContent);
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
        if (!captchaToken) {
          throw new Error(
            "セキュリティ確認が完了していません。hCaptchaを完了してください。",
          );
        }

        // フィンガープリントの収集（未収集の場合のみ）
        let fpData = fingerprint;
        if (!fpData) {
          fpData = await collectFingerprint();
        }

        const fingerprints = (fpData?.components ?? []).map((comp) => ({
          type: "browser" as const,
          name: comp.componentName,
          value_hash: comp.componentValueHash,
        }));

        if (fingerprints.length === 0) {
          throw new Error(
            "フィンガープリントの収集に失敗しました。ページを再読み込みしてください。",
          );
        }

        // テレメトリトークンの取得
        const telemetryResult = await rpc(client.api.telemetry.v4.$post());
        if (!telemetryResult.success) {
          throw new Error("テレメトリトークンの取得に失敗しました");
        }

        // 回答の送信
        const submitResult = await rpc(
          client.api.forms.public[":publicId"].submit.$post({
            param: { publicId },
            json: {
              responses: parsedInput.data,
              captchaToken,
              telemetry: { v4Token: telemetryResult.token },
              fingerprints,
            },
          }),
        );

        setSuccess(`回答を送信しました（ID: ${submitResult.response?.id}）`);
        clearAnswers();

        // hCaptchaをリセット（再送信時に再度認証が必要）
        captchaRef.current?.reset();
        setCaptchaToken(null);
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "不明なエラーが発生しました",
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      formData?.plateContent,
      answers,
      captchaToken,
      fingerprint,
      collectFingerprint,
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
    return (
      <section className="p-6">
        <p className="text-sm text-destructive">
          {error ?? "不明なエラーが発生しました"}
        </p>
      </section>
    );
  }

  return (
    <FormBody
      title={formData.form.title ?? "公開フォーム"}
      description={formData.form.description ?? undefined}
      plateContent={formData.plateContent ?? "[]"}
      mode="public"
      onSubmitRequest={(data) => void handleSubmitRequest(data)}
      preSubmitSlot={
        <HCaptchaWidget
          ref={captchaRef}
          onVerify={handleCaptchaVerify}
          onExpire={handleCaptchaExpire}
        />
      }
      isSubmitting={isSubmitting}
      captchaReady={!!captchaToken}
      error={error}
      success={success}
      onErrorChange={setError}
    />
  );
}
