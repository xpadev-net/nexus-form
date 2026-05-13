import { CheckCircle, Loader2, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ExternalServiceValidationResult } from "@/types/domain/validation";

interface ValidationResultDisplayProps {
  validation: ExternalServiceValidationResult;
}

export function ValidationResultDisplay({
  validation,
}: ValidationResultDisplayProps) {
  // 検証中の状態
  if (validation.status === "PENDING" || validation.status === "PROCESSING") {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">検証中...</span>
      </div>
    );
  }

  // 検証失敗（エラー）状態
  if (validation.status === "FAILED") {
    return (
      <Alert variant="destructive">
        <AlertTitle>検証エラー</AlertTitle>
        <AlertDescription>
          {validation.error_message || "不明なエラーが発生しました"}
          <p className="mt-2 text-sm">
            {validation.attempt_count}回試行しましたが失敗しました
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  // 完了状態（成功 or 失敗）
  if (validation.status === "COMPLETED") {
    const { metadata } = validation;

    // 検証結果がnullの場合（まだ確定していない）
    if (validation.success === null) {
      return (
        <Alert variant="destructive">
          <AlertTitle>検証エラー</AlertTitle>
          <AlertDescription>検証結果が取得できませんでした</AlertDescription>
        </Alert>
      );
    }

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {validation.success ? (
            <CheckCircle className="h-5 w-5 text-green-500" />
          ) : (
            <XCircle className="h-5 w-5 text-red-500" />
          )}
          <span className="font-medium">
            {validation.service}検証: {validation.success ? "成功" : "失敗"}
          </span>
        </div>

        {metadata && (
          <div className="space-y-1 pl-6 text-sm">
            {typeof metadata.username === "string" && metadata.username && (
              <p>ユーザー名: {metadata.username}</p>
            )}
            {typeof metadata.display_name === "string" &&
              metadata.display_name && <p>表示名: {metadata.display_name}</p>}
            {typeof metadata.guild_member === "boolean" && (
              <p>
                サーバーメンバー: {metadata.guild_member ? "はい" : "いいえ"}
              </p>
            )}
            {Array.isArray(metadata.roles) && metadata.roles.length > 0 && (
              <p>
                ロール:{" "}
                {(metadata.roles as unknown[])
                  .filter(
                    (role: unknown): role is string => typeof role === "string",
                  )
                  .join(", ")}
              </p>
            )}
            {validation.last_attempt_at && (
              <p className="text-muted-foreground">
                確認日時:{" "}
                {new Date(validation.last_attempt_at).toLocaleString("ja-JP")}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // その他の状態（想定外）
  return null;
}
