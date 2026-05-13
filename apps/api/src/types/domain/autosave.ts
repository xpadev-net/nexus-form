import { z } from "zod";
import {
  type FormResponses,
  FormResponsesSchema,
  isOtherResponse,
} from "../forms/public-form";

/**
 * 自動保存データのバージョン
 *
 * バージョン管理により、将来的なデータ構造の変更に対する互換性を保証します。
 * データ構造を変更する際は、バージョン番号をインクリメントし、
 * 適切なマイグレーション処理を実装してください。
 */
export const AUTOSAVE_VERSION = 1;

/**
 * 自動保存データの有効期限（デフォルト: 7日間）
 *
 * ミリ秒単位で定義されており、設定可能です。
 * 有効期限を過ぎたデータは無効として扱われます。
 */
export const DEFAULT_AUTOSAVE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7日間

/**
 * 自動保存データのzodスキーマ
 *
 * @property formId - フォームの一意識別子
 * @property respondentUuid - 回答者の一意識別子（プライバシー保護のためUUIDを使用）
 * @property responses - フォーム回答データ（質問ID -> 回答値のマップ）
 * @property timestamp - 保存日時（ISO 8601形式）
 * @property version - データ構造のバージョン番号
 * @property expiresAt - 有効期限（ISO 8601形式）
 */
export const AutosaveDataSchema = z.object({
  formId: z.string().min(1, "フォームIDは必須です"),
  respondentUuid: z.string().uuid("有効なUUIDである必要があります"),
  responses: FormResponsesSchema,
  timestamp: z.string().datetime("有効な日時形式で入力してください"),
  version: z
    .number()
    .int()
    .positive("バージョンは正の整数である必要があります"),
  expiresAt: z.string().datetime("有効な日時形式で入力してください"),
});

/**
 * 自動保存データの型定義
 */
export type AutosaveData = z.infer<typeof AutosaveDataSchema>;

/**
 * localStorage keyの接頭辞
 *
 * 自動保存データを識別するための接頭辞です。
 * 他のlocalStorageデータと区別するために使用されます。
 */
export const AUTOSAVE_KEY_PREFIX = "form_draft";

/**
 * localStorage keyを生成する
 *
 * @param formId - フォームの一意識別子
 * @param respondentUuid - 回答者の一意識別子
 * @returns localStorage key（形式: `form_draft_{formId}_{respondentUuid}`）
 */
export function generateAutosaveKey(
  formId: string,
  respondentUuid: string,
): string {
  // keyの一意性を保証するため、formIdとrespondentUuidを組み合わせる
  return `${AUTOSAVE_KEY_PREFIX}_${formId}_${respondentUuid}`;
}

/**
 * localStorage keyからフォームIDと回答者UUIDを抽出する
 *
 * @param key - localStorage key
 * @returns 抽出されたformIdとrespondentUuid、または無効なkeyの場合はnull
 */
export function parseAutosaveKey(
  key: string,
): { formId: string; respondentUuid: string } | null {
  if (!key.startsWith(`${AUTOSAVE_KEY_PREFIX}_`)) {
    return null;
  }

  const parts = key.slice(AUTOSAVE_KEY_PREFIX.length + 1).split("_");
  if (parts.length < 2) {
    return null;
  }

  // 最後の要素がrespondentUuid、それ以外がformId
  // UUIDは"-"で区切られた1つの文字列として扱われる
  const respondentUuid = parts[parts.length - 1];
  if (!respondentUuid) {
    return null;
  }
  const formId = parts.slice(0, -1).join("_");

  // UUIDの形式を検証（8-4-4-4-12のハイフン区切り）
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(respondentUuid)) {
    return null;
  }

  return { formId, respondentUuid };
}

/**
 * 自動保存データが有効期限内かどうかを判定する
 *
 * @param data - 自動保存データ
 * @param now - 現在時刻（デフォルト: 現在時刻）
 * @returns 有効期限内の場合はtrue、期限切れの場合はfalse
 */
export function isAutosaveDataValid(
  data: AutosaveData,
  now: Date = new Date(),
): boolean {
  const expiresAt = new Date(data.expiresAt);
  return now <= expiresAt;
}

/**
 * 新しい自動保存データを作成する
 *
 * @param formId - フォームの一意識別子
 * @param respondentUuid - 回答者の一意識別子
 * @param responses - フォーム回答データ
 * @param expiryMs - 有効期限（ミリ秒、デフォルト: DEFAULT_AUTOSAVE_EXPIRY_MS）
 * @returns 新しい自動保存データ
 */
export function createAutosaveData(
  formId: string,
  respondentUuid: string,
  responses: AutosaveData["responses"],
  expiryMs: number = DEFAULT_AUTOSAVE_EXPIRY_MS,
): AutosaveData {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryMs);

  return {
    formId,
    respondentUuid,
    responses,
    timestamp: now.toISOString(),
    version: AUTOSAVE_VERSION,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * 回答データが完全に空かどうかを判定する
 *
 * 以下のケースを空として判定します：
 * - 空文字列
 * - 空配列
 * - 空オブジェクト
 * - null / undefined
 *
 * 重要: "その他" (`{ type: "other", value: string }`) の形式のデータは、
 * `value` が空文字列であっても「その他を選択している」という意味のある回答として扱い、
 * 空ではないと判定します。
 *
 * @param responses - フォーム回答データ
 * @returns 意味のある回答が1つもない場合にtrue、そうでない場合はfalse
 */
export function isResponsesEmpty(responses: FormResponses): boolean {
  // 回答が存在しない場合は空
  if (!responses || typeof responses !== "object") {
    return true;
  }

  // すべての回答をチェック
  for (const [_questionId, value] of Object.entries(responses)) {
    // null または undefined の場合は空
    if (value === null || value === undefined) {
      continue;
    }

    // "その他" の形式の場合は、type が "other" であれば意味のある回答として扱う
    if (isOtherResponse(value)) {
      return false; // その他を選択している = 意味のある回答
    }

    // 文字列の場合
    if (typeof value === "string") {
      if (value.trim() !== "") {
        return false; // 空でない文字列
      }
    }
    // 数値の場合
    else if (typeof value === "number") {
      return false; // 数値は常に意味のある回答
    }
    // 配列の場合
    else if (Array.isArray(value)) {
      if (value.length > 0) {
        return false; // 空でない配列
      }
    }
    // オブジェクトの場合（その他以外）
    else if (typeof value === "object" && value !== null) {
      // オブジェクトに値があるかチェック
      const hasValues = Object.values(value).some((v) => {
        if (Array.isArray(v)) {
          return v.length > 0;
        }
        if (typeof v === "string") {
          return v.trim() !== "";
        }
        return v !== null && v !== undefined;
      });
      if (hasValues) {
        return false; // 値があるオブジェクト
      }
    }
  }

  // すべての回答が空だった場合
  return true;
}
