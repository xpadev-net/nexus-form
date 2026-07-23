import {
  parseValidationOutputValuesFromMetadata,
  type ValidationOutputValue,
} from "@nexus-form/shared";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  HelpCircle,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useValidationResults } from "@/hooks/forms/use-validation-results";

interface ValidationResultListProps {
  formId: string;
  responseId: string;
}

type StatusConfig = {
  icon: typeof CheckCircle2;
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
};

const STATUS_CONFIG: Record<string, StatusConfig> = {
  COMPLETED: { icon: CheckCircle2, label: "完了", variant: "default" },
  FAILED: { icon: XCircle, label: "失敗", variant: "destructive" },
  PENDING: { icon: Clock, label: "待機中", variant: "secondary" },
  PROCESSING: { icon: Loader2, label: "処理中", variant: "outline" },
  MISSING: { icon: HelpCircle, label: "参照欠落", variant: "outline" },
};

const DEFAULT_CONFIG: StatusConfig = {
  icon: Clock,
  label: "待機中",
  variant: "secondary",
};

type ValidationItem = {
  id: string;
  rule_id: string;
  rule_name: string;
  provider_name: string;
  rule_type: string;
  referenced_block_id: string;
  referenced_block_label: string | null;
  referenced_block_missing: boolean;
  service: string | null;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "MISSING" | null;
  success: boolean | null;
  error_message: string | null;
  error_code?: string | null;
  output_values?: ValidationOutputValue[];
  metadata?: unknown;
};

function groupByRule(items: ValidationItem[]): Array<{
  ruleId: string;
  ruleName: string;
  providerName: string;
  ruleType: string;
  items: ValidationItem[];
}> {
  const map = new Map<string, ValidationItem[]>();
  const order: string[] = [];
  for (const item of items) {
    const list = map.get(item.rule_id);
    if (list) {
      list.push(item);
    } else {
      map.set(item.rule_id, [item]);
      order.push(item.rule_id);
    }
  }
  return order.flatMap((ruleId) => {
    const list = map.get(ruleId);
    const head = list?.[0];
    if (!list || !head) return [];
    return [
      {
        ruleId,
        ruleName: head.rule_name,
        providerName: head.provider_name,
        ruleType: head.rule_type,
        items: list,
      },
    ];
  });
}

export function ValidationResultList({
  formId,
  responseId,
}: ValidationResultListProps) {
  const {
    validations,
    validationResultsQuery,
    retryResponseValidationMutation,
    cancelValidationMutation,
  } = useValidationResults(formId, responseId);

  const groups = groupByRule(validations as ValidationItem[]);

  const handleRetry = () => {
    retryResponseValidationMutation.mutate(undefined, {
      onSuccess: () => toast.success("再検証を開始しました"),
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : "再検証に失敗しました",
        ),
    });
  };

  const handleCancel = (validationResultId: string) => {
    cancelValidationMutation.mutate(validationResultId, {
      onSuccess: () => toast.success("検証をキャンセルしました"),
      onError: (error) => {
        toast.error(
          error instanceof Error ? error.message : "キャンセルに失敗しました",
        );
        void validationResultsQuery.refetch();
      },
    });
  };

  return (
    <div className="space-y-4 rounded border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">バリデーション結果</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRetry}
          disabled={retryResponseValidationMutation.isPending}
        >
          {retryResponseValidationMutation.isPending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
          )}
          再検証
        </Button>
      </div>

      {validationResultsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          バリデーション結果はありません。
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.ruleId} className="rounded border">
              <div className="border-b px-3 py-2">
                <div className="text-sm font-medium">{group.ruleName}</div>
                <div className="text-xs text-muted-foreground">
                  {group.providerName} / {group.ruleType}
                </div>
              </div>
              <ul className="divide-y">
                {group.items.map((result) => {
                  const config =
                    STATUS_CONFIG[result.status ?? "PENDING"] ?? DEFAULT_CONFIG;
                  const Icon = config.icon;
                  const isMissing = result.status === "MISSING";
                  const canCancel =
                    result.status === "PENDING" ||
                    result.status === "PROCESSING";

                  const outputValues =
                    result.output_values && result.output_values.length > 0
                      ? result.output_values
                      : parseValidationOutputValuesFromMetadata(
                          result.metadata,
                        );

                  return (
                    <li key={result.id} className="space-y-2 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Icon
                            className={`h-4 w-4 shrink-0 ${
                              result.status === "PROCESSING"
                                ? "animate-spin"
                                : ""
                            }`}
                          />
                          <span className="text-sm font-medium">
                            {result.referenced_block_label ??
                              result.referenced_block_id}
                          </span>
                          <Badge variant={config.variant}>{config.label}</Badge>
                          {result.success === true ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-300 bg-emerald-50/50 text-emerald-700"
                            >
                              成功
                            </Badge>
                          ) : result.success === false ? (
                            <Badge
                              variant="outline"
                              className="border-red-300 bg-red-50/50 text-red-700"
                            >
                              失敗
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1">
                          {!isMissing && canCancel ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => handleCancel(result.id)}
                              disabled={cancelValidationMutation.isPending}
                            >
                              キャンセル
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      {result.error_message ? (
                        <div
                          className="flex items-start gap-1.5 rounded-md border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive"
                          data-testid={`validation-error-${result.id}`}
                        >
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <div className="break-all">
                            {result.error_code && (
                              <span className="mr-1 font-semibold">
                                [{result.error_code}]
                              </span>
                            )}
                            <span>{result.error_message}</span>
                          </div>
                        </div>
                      ) : null}

                      {outputValues.length > 0 ? (
                        <div
                          className="space-y-1.5 rounded-md border bg-muted/40 p-2.5 text-xs"
                          data-testid={`validation-custom-fields-${result.id}`}
                        >
                          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                            カスタムフィールド
                          </div>
                          <div className="grid gap-1.5 sm:grid-cols-2">
                            {outputValues.map((output) => (
                              <div
                                key={output.key}
                                className="flex items-baseline justify-between gap-2 rounded border border-border/50 bg-background/60 px-2 py-1"
                              >
                                <span className="shrink-0 font-medium text-muted-foreground">
                                  {output.label || output.key}
                                </span>
                                <span className="break-all font-mono text-foreground text-right">
                                  {output.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
