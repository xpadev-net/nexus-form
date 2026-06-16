import type {
  ValidationProviderItem,
  ValidationProviderRuleItem,
} from "@nexus-form/shared";
import { extractQuestionsFromPlateContent } from "@nexus-form/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { type FC, useMemo, useState } from "react";
import { toast } from "sonner";
import { ExternalServiceValidationConfig } from "@/components/form/external-service-validation-config";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { client, rpc } from "@/lib/api";
import { useValidationProviders } from "@/lib/validation/validation-providers";

interface RuleDto {
  id: string;
  name: string;
  providerName: string;
  ruleType: string;
  referencedBlockIds: string[];
  configJson: Record<string, unknown>;
  orderIndex: number;
}

interface BlockOption {
  blockId: string;
  title: string;
}

const VALIDATION_RULE_PAGE_SIZE = 100;

async function fetchRules(formId: string): Promise<RuleDto[]> {
  const rules: RuleDto[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await rpc(
      client.api.forms[":id"]["validation-rules"].$get({
        param: { id: formId },
        query: {
          page: String(page),
          pageSize: String(VALIDATION_RULE_PAGE_SIZE),
        },
      }),
    );
    const pageRules = (res as { rules: RuleDto[] }).rules;
    rules.push(...pageRules);
    totalPages = res.pagination.totalPages;
    page++;
  } while (page <= totalPages);

  return rules;
}

interface Props {
  formId: string;
  plateContent: string;
}

export const FormValidationRulesPage: FC<Props> = ({
  formId,
  plateContent,
}) => {
  const queryClient = useQueryClient();
  const rulesQuery = useQuery({
    queryKey: ["validationRules", formId],
    queryFn: () => fetchRules(formId),
  });
  const providersQuery = useValidationProviders();

  const blocks = useMemo<BlockOption[]>(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(plateContent);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return extractQuestionsFromPlateContent(parsed).reduce<BlockOption[]>(
      (options, q) => {
        if (q.type !== "short_text") {
          return options;
        }

        options.push({
          blockId: q.blockId,
          title: q.title.trim() || "（タイトル未設定）",
        });
        return options;
      },
      [],
    );
  }, [plateContent]);

  const createMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      providerName: string;
      ruleType: string;
      referencedBlockIds: string[];
      configJson: Record<string, unknown>;
    }) =>
      rpc(
        client.api.forms[":id"]["validation-rules"].$post({
          param: { id: formId },
          json: payload,
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["validationRules", formId] });
    },
    onError: (error: Error) => {
      toast.error(error.message ?? "ルールの作成に失敗しました");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (input: {
      ruleId: string;
      payload: Partial<{
        name: string;
        providerName: string;
        ruleType: string;
        referencedBlockIds: string[];
        configJson: Record<string, unknown>;
      }>;
    }) =>
      rpc(
        client.api.forms[":id"]["validation-rules"][":ruleId"].$put({
          param: { id: formId, ruleId: input.ruleId },
          json: input.payload,
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["validationRules", formId] });
    },
    onError: (error: Error) => {
      toast.error(error.message ?? "ルールの更新に失敗しました");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ruleId: string) =>
      rpc(
        client.api.forms[":id"]["validation-rules"][":ruleId"].$delete({
          param: { id: formId, ruleId },
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["validationRules", formId] });
    },
    onError: (error: Error) => {
      toast.error(error.message ?? "ルールの削除に失敗しました");
    },
  });

  const providers = providersQuery.data?.data ?? [];
  const rules = rulesQuery.data ?? [];
  const providersErrorMessage =
    providersQuery.error instanceof Error
      ? providersQuery.error.message
      : "検証プロバイダー一覧を読み込めませんでした。";
  const rulesErrorMessage =
    rulesQuery.error instanceof Error
      ? rulesQuery.error.message
      : "検証ルール一覧を読み込めませんでした。";

  const handleCreate = () => {
    const firstProvider = providers[0];
    const firstRule = firstProvider?.rules[0];
    const firstBlock = blocks[0];
    if (!firstProvider || !firstRule || !firstBlock) {
      toast.error(
        "ルールを追加するにはテキスト入力ブロックと有効なプロバイダーが必要です",
      );
      return;
    }
    createMutation.mutate({
      name: "新しい検証ルール",
      providerName: firstProvider.name,
      ruleType: firstRule.name,
      referencedBlockIds: [firstBlock.blockId],
      configJson: {},
    });
  };

  if (rulesQuery.isLoading || providersQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        読み込み中…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">外部サービス検証ルール</h2>
          <Button
            onClick={handleCreate}
            disabled={
              createMutation.isPending ||
              blocks.length === 0 ||
              providers.length === 0
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            ルール追加
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          フォーム送信時に実行する検証ルールを設定します。各ルールは選択したブロックを参照し、選択したプロバイダーで検証されます。
        </p>
      </header>

      {providersQuery.isError ? (
        <div
          className="space-y-2 rounded border border-destructive/30 bg-destructive/5 p-3"
          role="alert"
        >
          <p className="text-sm text-destructive">{providersErrorMessage}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="validation-providers-query-retry"
            onClick={() => void providersQuery.refetch()}
          >
            再読み込み
          </Button>
        </div>
      ) : rulesQuery.isError ? (
        <div
          className="space-y-2 rounded border border-destructive/30 bg-destructive/5 p-3"
          role="alert"
        >
          <p className="text-sm text-destructive">{rulesErrorMessage}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="validation-rules-query-retry"
            onClick={() => void rulesQuery.refetch()}
          >
            再読み込み
          </Button>
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          検証ルールはまだありません。「ルール追加」から作成してください。
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <ValidationRuleCard
              key={rule.id}
              rule={rule}
              providers={providers}
              blocks={blocks}
              formId={formId}
              onUpdate={(payload) =>
                updateMutation.mutate({ ruleId: rule.id, payload })
              }
              onDelete={() => deleteMutation.mutate(rule.id)}
              busy={updateMutation.isPending || deleteMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface RuleCardProps {
  rule: RuleDto;
  providers: ValidationProviderItem[];
  blocks: BlockOption[];
  formId: string;
  onUpdate: (
    payload: Partial<{
      name: string;
      providerName: string;
      ruleType: string;
      referencedBlockIds: string[];
      configJson: Record<string, unknown>;
    }>,
  ) => void;
  onDelete: () => void;
  busy: boolean;
}

const ValidationRuleCard: FC<RuleCardProps> = ({
  rule,
  providers,
  blocks,
  formId,
  onUpdate,
  onDelete,
  busy,
}) => {
  const [name, setName] = useState(rule.name);
  const provider = providers.find((p) => p.name === rule.providerName);
  const providerRules = provider?.rules ?? [];
  const availableBlockIds = useMemo(
    () => new Set(blocks.map((block) => block.blockId)),
    [blocks],
  );
  const missingReferencedBlockIds = useMemo(
    () =>
      rule.referencedBlockIds.reduce<string[]>((missingIds, id) => {
        if (!availableBlockIds.has(id)) {
          missingIds.push(id);
        }
        return missingIds;
      }, []),
    [availableBlockIds, rule.referencedBlockIds],
  );

  const handleProviderChange = (providerName: string) => {
    const target = providers.find((p) => p.name === providerName);
    const firstRule = target?.rules[0];
    onUpdate({
      providerName,
      ruleType: firstRule?.name ?? "",
      configJson: {},
    });
  };

  const handleRuleTypeChange = (ruleType: string) => {
    onUpdate({ ruleType, configJson: {} });
  };

  const toggleReferenced = (blockId: string, checked: boolean) => {
    const next = checked
      ? [...new Set([...rule.referencedBlockIds, blockId])]
      : rule.referencedBlockIds.filter((id) => id !== blockId);
    if (next.length === 0) {
      toast.error("少なくとも 1 つの参照ブロックを選択してください");
      return;
    }
    onUpdate({ referencedBlockIds: next });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <Label htmlFor={`rule-name-${rule.id}`}>ルール名</Label>
          <Input
            id={`rule-name-${rule.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name !== rule.name) {
                onUpdate({ name: name.trim() });
              }
            }}
            placeholder="例: Discord メンバー検証"
            disabled={busy}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={busy}
          aria-label="ルールを削除"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>プロバイダー</Label>
            <Select
              value={rule.providerName}
              onValueChange={handleProviderChange}
              disabled={busy}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>検証種別</Label>
            <Select
              value={rule.ruleType}
              onValueChange={handleRuleTypeChange}
              disabled={busy || providerRules.length === 0}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerRules.map((r: ValidationProviderRuleItem) => (
                  <SelectItem key={r.name} value={r.name}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>参照ブロック（テキスト入力）</Label>
          {blocks.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              テキスト入力ブロックがありません。エディタでブロックを追加してください。
            </p>
          ) : (
            <div className="space-y-1.5 rounded-md border p-2">
              {blocks.map((block) => {
                const checked = rule.referencedBlockIds.includes(block.blockId);
                const checkboxId = `rule-${rule.id}-block-${block.blockId}`;
                return (
                  <div
                    key={block.blockId}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={checked}
                      onCheckedChange={(value) =>
                        toggleReferenced(block.blockId, value === true)
                      }
                      disabled={busy}
                    />
                    <Label htmlFor={checkboxId} className="font-normal">
                      {block.title}
                    </Label>
                  </div>
                );
              })}
              {missingReferencedBlockIds.map((id) => (
                <p
                  key={id}
                  className="rounded-sm bg-destructive/10 px-2 py-1 text-xs text-destructive"
                >
                  参照ブロックが見つかりません（削除された可能性があります）。検証時に
                  missing として扱われます。
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t pt-4">
          <Label>プロバイダー設定</Label>
          <ExternalServiceValidationConfig
            providerName={rule.providerName}
            ruleType={rule.ruleType}
            providers={providers}
            config={rule.configJson}
            disabled={busy}
            formId={formId}
            idPrefix={`rule-${rule.id}-config`}
            onChange={(nextConfig) => onUpdate({ configJson: nextConfig })}
          />
        </div>
      </CardContent>
    </Card>
  );
};
