import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileOutput, Loader2, Save } from "lucide-react";
import { type FC, type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  formDiffQueryKey,
  unpublishedChangesQueryKey,
} from "@/hooks/forms/form-structure-query-keys";
import { client, rpc } from "@/lib/api";

interface FormValidationOutputExportSettingsProps {
  formId: string;
}

function fetchValidationOutputExportSettings(formId: string) {
  return rpc(
    client.api.forms[":id"].structure["validation-output-export"].$get({
      param: { id: formId },
    }),
  );
}

type ValidationOutputExportSettingsResponse = Awaited<
  ReturnType<typeof fetchValidationOutputExportSettings>
>;
type ValidationOutputExportValueOption =
  ValidationOutputExportSettingsResponse["values"][number];

const EMPTY_VALUES: ValidationOutputExportValueOption[] = [];

function settingKey(
  value: Pick<ValidationOutputExportValueOption, "rule_id" | "output_key">,
) {
  return `${value.rule_id}:${value.output_key}`;
}

function groupValues(values: ValidationOutputExportValueOption[]) {
  const groups = new Map<string, ValidationOutputExportValueOption[]>();
  for (const value of values) {
    const key = value.rule_id;
    const group = groups.get(key);
    if (group) {
      group.push(value);
    } else {
      groups.set(key, [value]);
    }
  }
  return [...groups.values()];
}

interface ValidationOutputExportRuleGroupProps {
  group: ValidationOutputExportValueOption[];
  draft: Record<string, boolean>;
  disabled: boolean;
  onChange: (
    value: ValidationOutputExportValueOption,
    enabled: boolean,
  ) => void;
}

const ValidationOutputExportRuleGroup: FC<
  ValidationOutputExportRuleGroupProps
> = ({ group, draft, disabled, onChange }) => {
  const first = group[0];
  if (!first) return null;

  return (
    <div className="rounded-md border p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{first.rule_name}</h3>
        <p className="text-xs text-muted-foreground">
          {first.provider_name} / {first.rule_type}
        </p>
      </div>
      <div className="space-y-3">
        {group.map((value) => {
          const id = `validation-output-export-${value.rule_id}-${value.output_key}`;
          const checked = draft[settingKey(value)] ?? value.enabled;
          return (
            <div
              key={settingKey(value)}
              className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2"
            >
              <div className="min-w-0">
                <Label htmlFor={id} className="font-medium">
                  {value.label}
                </Label>
                <p className="break-all text-xs text-muted-foreground">
                  {value.output_key}
                  {value.source === "saved" ? " / 保存済み設定" : ""}
                </p>
              </div>
              <Switch
                id={id}
                aria-label={`${value.label} を出力する`}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(enabled) => onChange(value, enabled)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const FormValidationOutputExportSettings: FC<
  FormValidationOutputExportSettingsProps
> = ({ formId }) => {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [isDirty, setIsDirty] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["validationOutputExportSettings", formId],
    queryFn: () => fetchValidationOutputExportSettings(formId),
    enabled: !!formId,
  });

  const values = settingsQuery.data?.values ?? EMPTY_VALUES;
  const savedDraft = useMemo(
    () =>
      Object.fromEntries(
        values.map((value) => [settingKey(value), value.enabled]),
      ),
    [values],
  );
  const valueGroups = useMemo(() => groupValues(values), [values]);

  useEffect(() => {
    if (isDirty) return;
    setDraft(savedDraft);
  }, [isDirty, savedDraft]);

  const updateDraft = (
    value: ValidationOutputExportValueOption,
    enabled: boolean,
  ) => {
    setIsDirty(true);
    setDraft((current) => ({ ...current, [settingKey(value)]: enabled }));
  };

  const saveMutation = useMutation({
    mutationFn: async () =>
      rpc(
        client.api.forms[":id"].structure["validation-output-export"].$patch({
          param: { id: formId },
          json: {
            values: values.map((value) => ({
              rule_id: value.rule_id,
              provider_name: value.provider_name,
              rule_type: value.rule_type,
              output_key: value.output_key,
              enabled: draft[settingKey(value)] ?? value.enabled,
            })),
          },
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["validationOutputExportSettings", formId],
        }),
        queryClient.invalidateQueries({ queryKey: formDiffQueryKey(formId) }),
        queryClient.invalidateQueries({
          queryKey: unpublishedChangesQueryKey(formId),
        }),
      ]);
      setIsDirty(false);
      toast.success("検証結果の出力設定を保存しました");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "検証結果の出力設定の保存に失敗しました",
      );
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveMutation.mutate();
  };

  return (
    <section className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileOutput className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">検証結果の出力</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            今後のCSVとGoogle
            Sheets出力で使う検証結果の値をルールごとに選択します。
          </p>
        </div>
        <Button
          type="submit"
          form="validation-output-export-settings"
          disabled={
            saveMutation.isPending ||
            settingsQuery.isLoading ||
            values.length === 0
          }
          size="sm"
        >
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? "保存中..." : "保存"}
        </Button>
      </div>

      {settingsQuery.isError ? (
        <div
          className="space-y-2 rounded border border-destructive/30 bg-destructive/5 p-3"
          role="alert"
        >
          <p className="text-sm text-destructive">
            検証結果の出力設定を読み込めませんでした。
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void settingsQuery.refetch()}
          >
            再読み込み
          </Button>
        </div>
      ) : null}

      {settingsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          読み込み中…
        </div>
      ) : null}

      {!settingsQuery.isLoading &&
      !settingsQuery.isError &&
      values.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-5 text-sm text-muted-foreground">
          出力できる検証結果の値はまだありません。検証ルールを追加し、回答の検証が完了するとここで選択できます。
        </div>
      ) : null}

      <form
        id="validation-output-export-settings"
        className="space-y-4"
        onSubmit={handleSubmit}
      >
        {valueGroups.map((group) => (
          <ValidationOutputExportRuleGroup
            key={group[0]?.rule_id}
            group={group}
            draft={draft}
            disabled={saveMutation.isPending || settingsQuery.isLoading}
            onChange={updateDraft}
          />
        ))}
      </form>
    </section>
  );
};
