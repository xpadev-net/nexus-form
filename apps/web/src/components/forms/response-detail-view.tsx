import { AlertCircle, FileText, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { useValidationResults } from "@/hooks/forms/use-validation-results";
import { ResponseDisplay } from "./response-display";
import { ValidationResultList } from "./validation-result-list";

const ResponseDetailItemSchema = z
  .object({
    question_id: z.string().min(1),
    question_type: z.string().optional(),
    question_title: z.string().optional(),
    value: z.unknown().optional(),
    values: z.array(z.unknown()).optional(),
    responses: z.record(z.string(), z.unknown()).optional(),
    display_value: z.unknown().optional(),
    display_values: z.array(z.unknown()).optional(),
    other_value: z.unknown().optional(),
    other_values: z.array(z.unknown()).optional(),
  })
  .passthrough();

type ResponseDetailItem = z.infer<typeof ResponseDetailItemSchema>;
type ResponseField = { label: string; value: string };

interface ResponseDetailViewProps {
  formId: string;
  responseId: string;
  fields?: { label: string; value: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEncryptedValue(value: Record<string, unknown>): boolean {
  return (
    value.encrypted === true ||
    (typeof value.ciphertext === "string" &&
      (typeof value.iv === "string" || typeof value.tag === "string"))
  );
}

function formatResponseValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "未回答";
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "未回答";
    return value.map(formatResponseValue).join(", ");
  }
  if (isRecord(value)) {
    if (isEncryptedValue(value)) {
      return "暗号化済みの回答";
    }
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function formatResponseItemValue(item: ResponseDetailItem): string {
  const parts: string[] = [];

  if ("display_value" in item) {
    parts.push(formatResponseValue(item.display_value));
  } else if (Array.isArray(item.display_values)) {
    parts.push(formatResponseValue(item.display_values));
  } else if (item.responses && Object.keys(item.responses).length > 0) {
    parts.push(
      ...Object.entries(item.responses).map(
        ([rowId, rowValue]) => `${rowId}: ${formatResponseValue(rowValue)}`,
      ),
    );
  } else if (Array.isArray(item.values)) {
    parts.push(formatResponseValue(item.values));
  } else if ("value" in item) {
    parts.push(formatResponseValue(item.value));
  }

  if (
    "other_value" in item &&
    item.other_value !== undefined &&
    item.other_value !== null &&
    item.other_value !== ""
  ) {
    parts.push(`その他: ${formatResponseValue(item.other_value)}`);
  }
  if (item.other_values && item.other_values.length > 0) {
    parts.push(`その他: ${formatResponseValue(item.other_values)}`);
  }

  return parts.length > 0 ? parts.join("\n") : "未回答";
}

function parseResponseFields(responseDataJson: string | null): ResponseField[] {
  if (!responseDataJson) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseDataJson);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((item) => {
    const result = ResponseDetailItemSchema.safeParse(item);
    if (!result.success) return [];
    return [
      {
        label: result.data.question_title
          ? `${result.data.question_title} (${result.data.question_id})`
          : `未設定の質問 (${result.data.question_id})`,
        value: formatResponseItemValue(result.data),
      },
    ];
  });
}

function formatUniquenessScore(score: unknown): string | null {
  return typeof score === "number" && Number.isFinite(score)
    ? score.toFixed(4)
    : null;
}

export function ResponseDetailView({
  formId,
  responseId,
  fields,
}: ResponseDetailViewProps) {
  const { validationResultsQuery } = useValidationResults(formId, responseId);
  const uniquenessScore = formatUniquenessScore(
    validationResultsQuery.data?.response?.uniquenessScore,
  );
  const responseFields = useMemo(
    () =>
      fields ??
      parseResponseFields(
        validationResultsQuery.data?.response?.responseDataJson ?? null,
      ),
    [fields, validationResultsQuery.data?.response?.responseDataJson],
  );

  return (
    <div className="space-y-4 rounded border p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FileText className="h-4 w-4" />
          回答詳細
        </h2>
        <Badge variant="outline">{responseId}</Badge>
      </div>

      {validationResultsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          読み込み中...
        </div>
      ) : validationResultsQuery.isError ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          回答の取得に失敗しました
        </div>
      ) : (
        <>
          {uniquenessScore && (
            <div className="grid gap-3 sm:grid-cols-2">
              <ResponseDisplay
                label="ユニーク度スコア"
                value={uniquenessScore}
              />
            </div>
          )}

          {responseFields.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {responseFields.map((field) => (
                <ResponseDisplay
                  key={field.label}
                  label={field.label}
                  value={field.value}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              回答内容はありません。
            </p>
          )}

          <ValidationResultList formId={formId} responseId={responseId} />
        </>
      )}
    </div>
  );
}
