import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Eye } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { FormStatusBadge } from "@/components/forms/form-status-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormResponseProvider } from "@/contexts/form-response-context";
import { useSnapshotContent } from "@/hooks/forms/use-snapshot-content";
import { useSnapshots } from "@/hooks/forms/use-snapshots";
import { usePageTitle } from "@/hooks/use-page-title";
import { client, rpc } from "@/lib/api";
import { formatJapanDate } from "@/lib/formatters";
import { decodePrefillData } from "@/lib/forms/prefill";
import { FormAppearanceSchema } from "@/types/validation/form";
import { formAppearanceStructureQueryKey } from "./form-appearance-settings";
import { FormAppearanceSurface } from "./form-appearance-surface";
import { FormBody } from "./form-body";

function PreviewLoadingStatus({ message }: { message: string }) {
  return (
    <section aria-busy="true" className="p-6" data-preview-loading="true">
      <p className="text-sm text-muted-foreground">{message}</p>
    </section>
  );
}

export function FormPreviewPage() {
  const { id } = useParams({ from: "/forms/preview/$id" });
  const { p: prefillParam } = useSearch({ from: "/forms/preview/$id" });
  const [selectedVersion, setSelectedVersion] = useState<"latest" | number>(
    "latest",
  );
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const prefilledAnswers = useMemo(() => {
    if (!prefillParam) return undefined;
    const decoded = decodePrefillData(prefillParam);
    if (!decoded) return undefined;
    return new Map(Object.entries(decoded));
  }, [prefillParam]);

  const formQuery = useQuery({
    queryKey: ["formDetail", id],
    queryFn: () => rpc(client.api.forms[":id"].$get({ param: { id } })),
  });

  const contentQuery = useQuery({
    queryKey: ["formContent", id],
    queryFn: () => rpc(client.api.forms[":id"].content.$get({ param: { id } })),
  });

  const structureQuery = useQuery({
    queryKey: formAppearanceStructureQueryKey(id),
    queryFn: () =>
      rpc(client.api.forms[":id"].structure.$get({ param: { id } })),
  });

  const { snapshotsQuery } = useSnapshots(id);
  const snapshots = snapshotsQuery.data?.snapshots ?? [];

  const snapshotContentQuery = useSnapshotContent(
    id,
    typeof selectedVersion === "number" ? selectedVersion : null,
  );

  const isLatestPreview = selectedVersion === "latest";
  const isLoading =
    formQuery.isLoading ||
    contentQuery.isLoading ||
    (isLatestPreview && structureQuery.isLoading);
  const error =
    formQuery.error ||
    contentQuery.error ||
    (isLatestPreview ? structureQuery.error : null);

  usePageTitle(
    formQuery.data?.form?.title
      ? `${formQuery.data.form.title} - プレビュー`
      : "プレビュー",
  );

  const resetPreviewStatus = useCallback(() => {
    setPreviewMessage(null);
    setPreviewError(null);
  }, []);

  const handlePreviewSubmit = useCallback(() => {
    setPreviewMessage("これはプレビューです。回答は保存されません。");
  }, []);

  if (isLoading) {
    return <PreviewLoadingStatus message="プレビューを準備しています。" />;
  }

  if (error) {
    return (
      <section className="p-6">
        <p className="text-sm text-destructive">
          {error instanceof Error
            ? error.message
            : "不明なエラーが発生しました"}
        </p>
      </section>
    );
  }

  const form = formQuery.data?.form;
  const snapshotError =
    typeof selectedVersion === "number" ? snapshotContentQuery.error : null;
  const plateContent =
    selectedVersion === "latest"
      ? (contentQuery.data?.plateContent ?? "[]")
      : (snapshotContentQuery.data?.plateContent ?? null);
  const latestAppearanceResult = FormAppearanceSchema.safeParse(
    structureQuery.data?.structure?.appearance ?? {},
  );
  const previewAppearance =
    selectedVersion === "latest" && latestAppearanceResult.success
      ? latestAppearanceResult.data
      : undefined;

  const isSnapshotLoading =
    typeof selectedVersion === "number" &&
    !snapshotContentQuery.isError &&
    (snapshotContentQuery.isPending || plateContent === null);

  return (
    <div>
      {/* プレビューバナー */}
      <div className="sticky top-0 z-50 border-b bg-amber-50 dark:bg-amber-950">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-2">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
              プレビュー表示中
            </span>
            {selectedVersion !== "latest" && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                (v{selectedVersion})
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {snapshotsQuery.error && (
              <p className="text-xs text-destructive">
                バージョン一覧の取得に失敗しました
              </p>
            )}
            {snapshots.length > 0 && (
              <Select
                value={String(selectedVersion)}
                onValueChange={(v) => {
                  resetPreviewStatus();
                  setSelectedVersion(v === "latest" ? "latest" : Number(v));
                }}
              >
                <SelectTrigger className="h-7 w-[200px] text-xs">
                  <SelectValue placeholder="バージョンを選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">最新の編集版</SelectItem>
                  {snapshots.map((s) => (
                    <SelectItem key={s.version} value={String(s.version)}>
                      v{s.version} - {formatJapanDate(s.publishedAt)}
                      {s.isActive ? " (公開中)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {form && <FormStatusBadge status={form.status} />}
            {form?.publicId && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                asChild
              >
                <Link
                  to="/forms/public/$publicId"
                  params={{ publicId: form.publicId }}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-1 h-3 w-3" />
                  公開フォーム
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
              <Link to="/forms/$id/edit" params={{ id }}>
                <ArrowLeft className="mr-1 h-3 w-3" />
                エディタに戻る
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* プレビュー本体 */}
      {isSnapshotLoading ? (
        <PreviewLoadingStatus message="選択したバージョンを準備しています。" />
      ) : snapshotError ? (
        <section className="p-6">
          <p className="text-sm text-destructive">
            {snapshotError instanceof Error
              ? snapshotError.message
              : "スナップショットの読み込みに失敗しました。"}
          </p>
        </section>
      ) : (
        <FormAppearanceSurface
          appearance={previewAppearance}
          className="min-h-[calc(100dvh-41px)]"
        >
          <FormResponseProvider
            key={String(selectedVersion)}
            initialAnswers={prefilledAnswers}
          >
            <FormBody
              title={form?.title ?? "フォームプレビュー"}
              description={form?.description ?? undefined}
              plateContent={plateContent ?? "[]"}
              mode="preview"
              appearance={previewAppearance}
              onSubmitRequest={handlePreviewSubmit}
              error={previewError}
              onErrorChange={setPreviewError}
              success={previewMessage}
            />
          </FormResponseProvider>
        </FormAppearanceSurface>
      )}
    </div>
  );
}
