import {
  isCompletionTargetPage,
  resolvePageIndexByPageId,
  splitPlateContentIntoPages,
} from "@nexus-form/shared";
import { useEffect } from "react";
import {
  type FormConfirmation,
  SafeConfirmationUrlSchema,
} from "@/types/validation/form";

export type ResponseSummaryItem = {
  questionId: string;
  title: string;
  value: string;
};

type ResponseSummarySourceItem = {
  question_id: string;
  question_title?: string;
  value?: unknown;
  values?: unknown[];
  responses?: Record<string, unknown>;
  other_value?: string;
  other_values?: string[];
};

function formatResponseValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "未回答";
  }
  return String(value);
}

function formatResponseSummaryValue(item: ResponseSummarySourceItem): string {
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

export function buildResponseSummary(
  items: ResponseSummarySourceItem[],
): ResponseSummaryItem[] {
  return items.map((item) => ({
    questionId: item.question_id,
    title: item.question_title?.trim() || item.question_id,
    value: formatResponseSummaryValue(item),
  }));
}

export function resolveValidCompletionTargetPageId(
  plateContent: unknown[],
  completionTargetPageId: string | undefined,
): string | undefined {
  if (!completionTargetPageId) return undefined;
  const pages = splitPlateContentIntoPages(plateContent);
  const pageIndex = resolvePageIndexByPageId(pages, completionTargetPageId);
  const page = pages[pageIndex];
  return page && isCompletionTargetPage(page) ? page.pageId : undefined;
}

function safeConfirmationUrl(value: string | undefined): string | undefined {
  const result = SafeConfirmationUrlSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function SubmitCompletion({
  responseId,
  confirmation,
  responseSummary,
  autoRedirect = true,
}: {
  responseId: string;
  confirmation: FormConfirmation;
  responseSummary: ResponseSummaryItem[];
  autoRedirect?: boolean;
}) {
  const redirectUrl = safeConfirmationUrl(confirmation.redirect_url);
  const supplementalLinkUrl = safeConfirmationUrl(
    confirmation.supplemental_link?.url,
  );
  const contactUrl = safeConfirmationUrl(confirmation.contact?.url);

  useEffect(() => {
    if (!autoRedirect || !redirectUrl) return;

    const redirectTimeout = window.setTimeout(() => {
      window.location.replace(redirectUrl);
    }, 1500);

    return () => window.clearTimeout(redirectTimeout);
  }, [autoRedirect, redirectUrl]);

  const contactHref = confirmation.contact?.email
    ? `mailto:${confirmation.contact.email}`
    : contactUrl;
  const contactLabel =
    confirmation.contact?.label ?? confirmation.contact?.email ?? contactUrl;

  return (
    <section className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="rounded-lg border bg-card p-6">
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
