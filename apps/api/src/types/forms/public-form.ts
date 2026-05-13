import { z } from "zod";
import { ResponseData } from "../domain/response";

// 質問タイプごとの回答値型
export type TextResponseValue = string;
export type NumberResponseValue = number;
export type ArrayResponseValue = string[];
export type GridResponseValue = Record<string, string>;
export type CheckboxGridResponseValue = Record<string, string[]>;

// "その他"の値の型定義
export type OtherResponseValue = {
  type: "other";
  value: string;
};

// 質問の回答値の型定義（統合版）
export type QuestionResponseValue =
  | TextResponseValue
  | NumberResponseValue
  | ArrayResponseValue
  | GridResponseValue
  | CheckboxGridResponseValue
  | OtherResponseValue;

// フォーム回答の型定義
export type FormResponses = Record<string, QuestionResponseValue>;

// FormResponsesのzodスキーマ
export const FormResponsesSchema = z.record(
  z.string(),
  z.union([
    z.string(),
    z.number(),
    z.array(z.string()),
    z.record(z.string(), z.string()),
    z.record(z.string(), z.array(z.string())),
    z.object({
      type: z.literal("other"),
      value: z.string(),
    }),
  ]),
);

// 公開フォーム送信リクエストの型定義
export const PublicFormSubmissionSchema = z.object({
  formId: z.string().min(1, "フォームIDは必須です"),
  responses: z.array(ResponseData), // 配列形式のみ
  submittedAt: z.string().datetime("有効な日時形式で入力してください"),
  captchaToken: z.string().min(1, "hCaptchaトークンは必須です"),
  telemetry: z
    .object({
      v4Token: z.string().optional(),
      v6Token: z.string().optional(),
    })
    .refine(
      (data) => data.v4Token || data.v6Token,
      "IPv4またはIPv6のテレメトリトークンが少なくとも1つ必要です",
    ),
  fingerprints: z
    .array(
      z.object({
        type: z.enum(["fingerprintjs", "thumbmarkjs"]),
        name: z.string(),
        value_hash: z.string(),
      }),
    )
    .nonempty("フィンガープリントは必須です")
    .refine(
      (arr) => {
        const types = new Set(arr.map((a) => a.type));
        return types.has("fingerprintjs") && types.has("thumbmarkjs");
      },
      { message: "fingerprintjs と thumbmarkjs が必須です" },
    ),
});

export type PublicFormSubmission = z.infer<typeof PublicFormSubmissionSchema>;

// 型ガード関数
export function isTextResponse(value: QuestionResponseValue): value is string {
  return typeof value === "string";
}

export function isNumberResponse(
  value: QuestionResponseValue,
): value is number {
  return typeof value === "number";
}

export function isArrayResponse(
  value: QuestionResponseValue,
): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function isGridResponse(
  value: QuestionResponseValue,
): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

export function isCheckboxGridResponse(
  value: QuestionResponseValue,
): value is Record<string, string[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => Array.isArray(v))
  );
}

export function isOtherResponse(
  value: QuestionResponseValue,
): value is OtherResponseValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "other" &&
    "value" in value &&
    typeof value.value === "string"
  );
}
