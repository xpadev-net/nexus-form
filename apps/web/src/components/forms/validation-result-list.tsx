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
                  return (
                    <li
                      key={result.id}
                      className="flex items-center justify-between gap-2 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Icon
                          className={`h-4 w-4 shrink-0 ${
                            result.status === "PROCESSING" ? "animate-spin" : ""
                          }`}
                        />
                        <span className="text-sm">
                          {result.referenced_block_label ??
                            result.referenced_block_id}
                        </span>
                        <Badge variant={config.variant}>{config.label}</Badge>
                        {result.success === true ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-300 text-emerald-700"
                          >
                            成功
                          </Badge>
                        ) : result.success === false ? (
                          <Badge
                            variant="outline"
                            className="border-red-300 text-red-700"
                          >
                            失敗
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        {result.error_message ? (
                          <span
                            className="text-xs text-destructive"
                            title={result.error_message}
                          >
                            <AlertCircle className="h-3.5 w-3.5" />
                          </span>
                        ) : null}
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
