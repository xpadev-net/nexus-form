import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Laptop, Palette, Save, Smartphone } from "lucide-react";
import { type FC, type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { FormResponseProvider } from "@/contexts/form-response-context";
import {
  formDiffQueryKey,
  unpublishedChangesQueryKey,
} from "@/hooks/forms/form-structure-query-keys";
import { client, rpc } from "@/lib/api";
import { brandConfig } from "@/lib/brand-config";
import { cn } from "@/lib/utils";
import {
  type FormAppearance,
  FormAppearanceSchema,
  type FormLayout,
  FormLayoutSchema,
  type FormTheme,
} from "@/types/validation/form";
import {
  expandHexColor,
  FormAppearanceSurface,
  formAppearanceContrastWarnings,
} from "./form-appearance-surface";
import { FormBody } from "./form-body";

export const formAppearanceStructureQueryKey = (formId: string) =>
  ["formStructure", "appearance", formId] as const;

type PreviewViewport = "mobile" | "desktop";

interface FormAppearanceSettingsProps {
  formId: string;
  formTitle: string;
  formDescription?: string;
  plateContent: string;
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parseAppearance(value: unknown): FormAppearance {
  const result = FormAppearanceSchema.safeParse(value ?? {});
  return result.success ? result.data : FormAppearanceSchema.parse({});
}

const ColorField: FC<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ id, label, value, onChange }) => (
  <div className="space-y-2">
    <Label htmlFor={id}>{label}</Label>
    <div className="flex gap-2">
      <Input
        id={id}
        type="color"
        value={expandHexColor(value) ?? brandConfig.primaryColor}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-14 p-1"
      />
      <Input
        aria-label={`${label} HEX 値`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={brandConfig.primaryColor}
        className="font-mono"
      />
    </div>
  </div>
);

export const FormAppearanceSettings: FC<FormAppearanceSettingsProps> = ({
  formId,
  formTitle,
  formDescription,
  plateContent,
}) => {
  const queryClient = useQueryClient();
  const [draftAppearance, setDraftAppearance] = useState<FormAppearance>(() =>
    FormAppearanceSchema.parse({}),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [previewViewport, setPreviewViewport] =
    useState<PreviewViewport>("desktop");

  const structureQuery = useQuery({
    queryKey: formAppearanceStructureQueryKey(formId),
    queryFn: () =>
      rpc(client.api.forms[":id"].structure.$get({ param: { id: formId } })),
    enabled: !!formId,
  });

  const savedAppearance = useMemo(
    () => parseAppearance(structureQuery.data?.structure?.appearance),
    [structureQuery.data],
  );

  useEffect(() => {
    if (isDirty) return;
    setDraftAppearance(savedAppearance);
  }, [isDirty, savedAppearance]);

  const updateTheme = <Key extends keyof FormTheme>(
    key: Key,
    value: FormTheme[Key],
  ) => {
    setIsDirty(true);
    setDraftAppearance((current) => ({
      ...current,
      theme: { ...current.theme, [key]: value },
    }));
  };

  const updateLayout = <Key extends keyof FormLayout>(
    key: Key,
    value: FormLayout[Key],
  ) => {
    setIsDirty(true);
    setDraftAppearance((current) => ({
      ...current,
      layout: { ...current.layout, [key]: value },
    }));
  };

  const saveMutation = useMutation({
    mutationFn: async (appearance: FormAppearance) => {
      const parsed = FormAppearanceSchema.parse(appearance);
      return rpc(
        client.api.forms[":id"].structure.appearance.$patch({
          param: { id: formId },
          json: {
            appearance: parsed,
          },
        }),
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: formAppearanceStructureQueryKey(formId),
        }),
        queryClient.invalidateQueries({ queryKey: formDiffQueryKey(formId) }),
        queryClient.invalidateQueries({
          queryKey: unpublishedChangesQueryKey(formId),
        }),
      ]);
      setIsDirty(false);
      toast.success("外観設定を保存しました");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "外観設定の保存に失敗しました",
      );
    },
  });

  const warnings = formAppearanceContrastWarnings(draftAppearance);
  const publishStatusMessage = !structureQuery.data
    ? "保存済みの外観を読み込み中です。"
    : isDirty
      ? "未保存の変更はライブプレビューだけに反映中です。公開フォームへ反映するには保存後に公開 snapshot を更新してください。"
      : "保存済みの外観がライブプレビューに反映されています。次回公開時に公開 snapshot へ含まれます。";
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveMutation.mutate(draftAppearance);
  };

  return (
    <section className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">外観</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            質問番号、テーマ、ブランド、余白とレイアウトをまとめて調整します。
            未保存の変更は右側のライブプレビューに即時反映され、保存済みの外観は
            次回公開時に回答者向け snapshot へ反映されます。
          </p>
        </div>
        <Button
          type="submit"
          form="form-appearance-settings"
          disabled={saveMutation.isPending || !structureQuery.data}
          size="sm"
        >
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? "保存中..." : "保存"}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <form
          id="form-appearance-settings"
          className="space-y-5"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-3 rounded-md bg-muted/30 p-4 text-sm sm:grid-cols-2">
            <div>
              <p className="font-medium">テーマとブランド</p>
              <p className="mt-1 text-muted-foreground">
                テーマ色、アクセント色、背景色、ブランド名、ロゴ、カバー画像を設定します。
              </p>
            </div>
            <div>
              <p className="font-medium">レイアウトと質問番号</p>
              <p className="mt-1 text-muted-foreground">
                フォーム幅、配置、余白、Q1/Q2 の質問番号表示を設定します。
              </p>
            </div>
          </div>

          <div className="rounded-md bg-muted/30 p-4 text-sm">
            <p className="font-medium">反映ステータス</p>
            <p className="mt-1 text-muted-foreground" aria-live="polite">
              {publishStatusMessage}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <ColorField
              id="appearance-primary-color"
              label="テーマ色"
              value={draftAppearance.theme.primary_color}
              onChange={(value) => updateTheme("primary_color", value)}
            />
            <ColorField
              id="appearance-accent-color"
              label="アクセント色"
              value={draftAppearance.theme.accent_color}
              onChange={(value) => updateTheme("accent_color", value)}
            />
            <ColorField
              id="appearance-background-color"
              label="背景色"
              value={draftAppearance.theme.background_color}
              onChange={(value) => updateTheme("background_color", value)}
            />
          </div>

          {warnings.length > 0 ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>配色の警告</AlertTitle>
              <AlertDescription>
                {warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
                <p>
                  回答者に読みづらくなる可能性があるため、公開前に背景色との差を広げてください。
                </p>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="appearance-brand-name">ブランド名</Label>
              <Input
                id="appearance-brand-name"
                value={draftAppearance.theme.brand_name ?? ""}
                onChange={(event) =>
                  updateTheme(
                    "brand_name",
                    emptyToUndefined(event.target.value),
                  )
                }
                placeholder="Nexus Form"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appearance-font-family">フォント</Label>
              <NativeSelect
                id="appearance-font-family"
                value={draftAppearance.theme.font_family}
                onChange={(event) =>
                  updateTheme("font_family", event.target.value)
                }
                className="w-full"
              >
                <NativeSelectOption value="Inter">Inter</NativeSelectOption>
                <NativeSelectOption value="system-ui">
                  System UI
                </NativeSelectOption>
                <NativeSelectOption value="serif">Serif</NativeSelectOption>
                <NativeSelectOption value="monospace">
                  Monospace
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="appearance-logo-url">ロゴ URL</Label>
              <Input
                id="appearance-logo-url"
                type="url"
                value={draftAppearance.theme.logo_url ?? ""}
                onChange={(event) =>
                  updateTheme("logo_url", emptyToUndefined(event.target.value))
                }
                placeholder="https://example.com/logo.png"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appearance-cover-image-url">カバー画像 URL</Label>
              <Input
                id="appearance-cover-image-url"
                type="url"
                value={draftAppearance.theme.cover_image_url ?? ""}
                onChange={(event) =>
                  updateTheme(
                    "cover_image_url",
                    emptyToUndefined(event.target.value),
                  )
                }
                placeholder="https://example.com/cover.jpg"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="appearance-width">幅</Label>
              <NativeSelect
                id="appearance-width"
                value={draftAppearance.layout.width}
                onChange={(event) => {
                  const result = FormLayoutSchema.shape.width.safeParse(
                    event.target.value,
                  );
                  if (result.success) updateLayout("width", result.data);
                }}
                className="w-full"
              >
                <NativeSelectOption value="compact">
                  コンパクト
                </NativeSelectOption>
                <NativeSelectOption value="medium">標準</NativeSelectOption>
                <NativeSelectOption value="full">全幅</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="appearance-alignment">配置</Label>
              <NativeSelect
                id="appearance-alignment"
                value={draftAppearance.layout.alignment}
                onChange={(event) => {
                  const result = FormLayoutSchema.shape.alignment.safeParse(
                    event.target.value,
                  );
                  if (result.success) updateLayout("alignment", result.data);
                }}
                className="w-full"
              >
                <NativeSelectOption value="center">中央</NativeSelectOption>
                <NativeSelectOption value="left">左寄せ</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="appearance-spacing">余白</Label>
              <NativeSelect
                id="appearance-spacing"
                value={draftAppearance.layout.spacing}
                onChange={(event) => {
                  const result = FormLayoutSchema.shape.spacing.safeParse(
                    event.target.value,
                  );
                  if (result.success) updateLayout("spacing", result.data);
                }}
                className="w-full"
              >
                <NativeSelectOption value="compact">少なめ</NativeSelectOption>
                <NativeSelectOption value="comfortable">
                  標準
                </NativeSelectOption>
                <NativeSelectOption value="spacious">広め</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label htmlFor="appearance-question-numbers">質問番号</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                公開フォームとプレビューに Q1, Q2 の番号を表示します。
              </p>
            </div>
            <Switch
              id="appearance-question-numbers"
              checked={draftAppearance.layout.show_question_numbers}
              onCheckedChange={(checked) =>
                updateLayout("show_question_numbers", checked)
              }
            />
          </div>

          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            保存済みの外観は次回公開時に `structure.appearance` として公開
            snapshot に含まれます。未保存の入力、プレビューの mobile / desktop
            表示幅切替は snapshot には含まれません。
          </div>
        </form>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">ライブプレビュー</p>
            <div className="flex rounded-md border p-1">
              <Button
                type="button"
                variant={previewViewport === "mobile" ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label="モバイル幅でプレビュー"
                onClick={() => setPreviewViewport("mobile")}
              >
                <Smartphone className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant={previewViewport === "desktop" ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label="デスクトップ幅でプレビュー"
                onClick={() => setPreviewViewport("desktop")}
              >
                <Laptop className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <FormAppearanceSurface
            appearance={draftAppearance}
            className={cn(
              "overflow-hidden rounded-lg border",
              previewViewport === "mobile" ? "mx-auto max-w-[390px]" : "w-full",
            )}
            data-preview-viewport={previewViewport}
          >
            <FormResponseProvider>
              <FormBody
                title={formTitle}
                description={formDescription}
                plateContent={plateContent}
                mode="preview"
                appearance={draftAppearance}
                success="これはプレビューです。回答は保存されません。"
              />
            </FormResponseProvider>
          </FormAppearanceSurface>
        </div>
      </div>
    </section>
  );
};
