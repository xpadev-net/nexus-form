import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, CheckCircle2, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type SnapshotListItem,
  useSnapshots,
} from "@/hooks/forms/use-snapshots";
import { client, rpc } from "@/lib/api";
import { formatJapanLocaleDateTime } from "@/lib/formatters";

const entryFormSchema = z
  .object({
    triggerAt: z
      .string()
      .min(1, "日時を入力してください")
      .refine(
        (val) => new Date(val) > new Date(),
        "過去の日時は設定できません",
      ),
    action: z.enum(["PUBLISH", "UNPUBLISH", "SWITCH_SNAPSHOT"]),
    snapshotVersion: z.coerce.number().int().min(1).nullable(),
  })
  .refine(
    (data) => data.action !== "SWITCH_SNAPSHOT" || data.snapshotVersion != null,
    {
      message: "スナップショットを選択してください",
      path: ["snapshotVersion"],
    },
  );

type EntryFormData = z.infer<typeof entryFormSchema>;

type Snapshot = SnapshotListItem;

const ACTION_LABELS: Record<ScheduleEntry["action"], string> = {
  PUBLISH: "公開",
  UNPUBLISH: "非公開",
  SWITCH_SNAPSHOT: "スナップショット切替",
};

const ACTION_BADGE_VARIANTS: Record<
  ScheduleEntry["action"],
  "default" | "secondary" | "outline"
> = {
  PUBLISH: "default",
  UNPUBLISH: "secondary",
  SWITCH_SNAPSHOT: "outline",
};

function toLocalDatetimeString(isoString: string): string {
  const date = new Date(isoString);
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

function getSnapshotVersion(data: EntryFormData): number {
  if (data.snapshotVersion == null) {
    throw new Error("snapshotVersion is required");
  }
  return data.snapshotVersion;
}

interface EntryDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: EntryFormData) => Promise<void>;
  defaultValues?: Partial<EntryFormData>;
  snapshots: Snapshot[];
  title: string;
}

function EntryDialog({
  open,
  onClose,
  onSubmit,
  defaultValues,
  snapshots,
  title,
}: EntryDialogProps) {
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<EntryFormData>({
    resolver: zodResolver(entryFormSchema),
    defaultValues: {
      triggerAt: "",
      action: "PUBLISH",
      snapshotVersion: null,
      ...defaultValues,
    },
  });

  const watchedAction = form.watch("action");

  const handleSubmit = useCallback(
    async (data: EntryFormData) => {
      setIsLoading(true);
      try {
        await onSubmit(data);
        form.reset();
        onClose();
      } catch {
        // エラーは呼び出し元で toast 表示済み
      } finally {
        setIsLoading(false);
      }
    },
    [onSubmit, onClose, form],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="triggerAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>実行日時</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="action"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>操作</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      if (v !== "SWITCH_SNAPSHOT") {
                        form.setValue("snapshotVersion", null);
                      }
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="PUBLISH">公開</SelectItem>
                      <SelectItem value="UNPUBLISH">非公開</SelectItem>
                      <SelectItem value="SWITCH_SNAPSHOT">
                        スナップショット切替
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {watchedAction === "SWITCH_SNAPSHOT" && (
              <FormField
                control={form.control}
                name="snapshotVersion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>スナップショット</FormLabel>
                    <Select
                      value={field.value != null ? String(field.value) : ""}
                      onValueChange={(v) =>
                        field.onChange(v ? Number(v) : null)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="バージョンを選択" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {snapshots.map((s) => (
                          <SelectItem key={s.version} value={String(s.version)}>
                            v{s.version}
                            {s.isActive ? " (現在)" : ""}
                            {s.changeLog ? ` — ${s.changeLog}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isLoading}
              >
                キャンセル
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "保存中..." : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

interface ScheduleManagerProps {
  formId: string;
}

const SCHEDULE_PAGE_SIZE = 100;

async function fetchSchedulePage(formId: string, page: number) {
  return rpc(
    client.api.forms[":id"].schedule.$get({
      param: { id: formId },
      query: { page: String(page), pageSize: String(SCHEDULE_PAGE_SIZE) },
    }),
  );
}

type ScheduleEntry = Awaited<
  ReturnType<typeof fetchSchedulePage>
>["schedules"][number];

async function fetchAllSchedules(formId: string): Promise<{
  schedules: ScheduleEntry[];
}> {
  const schedules: ScheduleEntry[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await fetchSchedulePage(formId, page);
    schedules.push(...res.schedules);
    totalPages = res.pagination.totalPages;
    page++;
  } while (page <= totalPages);

  return { schedules };
}

export function ScheduleManager({ formId }: ScheduleManagerProps) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ScheduleEntry | null>(null);
  const { snapshotsQuery } = useSnapshots(formId);

  const schedulesQuery = useQuery({
    queryKey: ["formSchedules", formId],
    queryFn: () => fetchAllSchedules(formId),
    enabled: !!formId,
  });

  const schedules = schedulesQuery.data?.schedules ?? [];
  const snapshots: Snapshot[] = snapshotsQuery.data?.snapshots ?? [];
  const schedulesErrorMessage =
    schedulesQuery.error instanceof Error
      ? schedulesQuery.error.message
      : "スケジュールを読み込めませんでした。";
  const snapshotsErrorMessage =
    snapshotsQuery.error instanceof Error
      ? snapshotsQuery.error.message
      : "スナップショットを読み込めませんでした。";

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["formSchedules", formId],
    });
  }, [queryClient, formId]);

  const handleAdd = useCallback(
    async (data: EntryFormData) => {
      try {
        await rpc(
          client.api.forms[":id"].schedule.$post({
            param: { id: formId },
            json:
              data.action === "SWITCH_SNAPSHOT"
                ? {
                    triggerAt: new Date(data.triggerAt).toISOString(),
                    action: "SWITCH_SNAPSHOT",
                    snapshotVersion: getSnapshotVersion(data),
                  }
                : {
                    triggerAt: new Date(data.triggerAt).toISOString(),
                    action: data.action,
                  },
          }),
        );
        toast.success("スケジュールを追加しました");
        invalidate();
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "スケジュールの追加に失敗しました",
        );
        throw err;
      }
    },
    [formId, invalidate],
  );

  const handleEdit = useCallback(
    async (data: EntryFormData) => {
      if (!editTarget) return;
      try {
        await rpc(
          client.api.forms[":id"].schedule[":scheduleId"].$put({
            param: { id: formId, scheduleId: editTarget.id },
            json:
              data.action === "SWITCH_SNAPSHOT"
                ? {
                    triggerAt: new Date(data.triggerAt).toISOString(),
                    action: "SWITCH_SNAPSHOT",
                    snapshotVersion: getSnapshotVersion(data),
                  }
                : {
                    triggerAt: new Date(data.triggerAt).toISOString(),
                    action: data.action,
                    snapshotVersion: null,
                  },
          }),
        );
        toast.success("スケジュールを更新しました");
        invalidate();
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "スケジュールの更新に失敗しました",
        );
        throw err;
      }
    },
    [formId, editTarget, invalidate],
  );

  const handleDelete = useCallback(
    async (entry: ScheduleEntry) => {
      try {
        await rpc(
          client.api.forms[":id"].schedule[":scheduleId"].$delete({
            param: { id: formId, scheduleId: entry.id },
          }),
        );
        toast.success("スケジュールを削除しました");
        invalidate();
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "スケジュールの削除に失敗しました",
        );
      }
    },
    [formId, invalidate],
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Calendar className="h-4 w-4" />
          スケジュール
        </h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAddOpen(true)}
          className="gap-1"
          disabled={snapshotsQuery.isError}
        >
          <Plus className="h-3.5 w-3.5" />
          追加
        </Button>
      </div>

      {snapshotsQuery.isError ? (
        <div className="space-y-2 rounded border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">{snapshotsErrorMessage}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="schedule-snapshots-query-retry"
            onClick={() => void snapshotsQuery.refetch()}
          >
            再読み込み
          </Button>
        </div>
      ) : null}

      {schedulesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : schedulesQuery.isError ? (
        <div className="space-y-2 rounded border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">{schedulesErrorMessage}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="schedule-query-retry"
            onClick={() => void schedulesQuery.refetch()}
          >
            再読み込み
          </Button>
        </div>
      ) : schedules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          スケジュールが設定されていません。「追加」から操作を登録できます。
        </p>
      ) : (
        <ul className="space-y-2">
          {schedules.map((entry) => (
            <li
              key={entry.id}
              className={`flex items-center gap-3 rounded border px-3 py-2 text-sm ${
                entry.processedAt ? "opacity-50" : ""
              }`}
            >
              {entry.processedAt && (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
              )}
              <span className="min-w-0 flex-1 font-mono text-xs">
                {formatJapanLocaleDateTime(entry.triggerAt)}
              </span>
              <Badge variant={ACTION_BADGE_VARIANTS[entry.action]}>
                {ACTION_LABELS[entry.action]}
                {entry.action === "SWITCH_SNAPSHOT" &&
                  entry.snapshotVersion != null &&
                  ` v${entry.snapshotVersion}`}
              </Badge>
              {!entry.processedAt && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setEditTarget(entry)}
                    aria-label="編集"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => void handleDelete(entry)}
                    aria-label="削除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <EntryDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={handleAdd}
        snapshots={snapshots}
        title="スケジュールを追加"
      />

      {editTarget && (
        <EntryDialog
          open={true}
          onClose={() => setEditTarget(null)}
          onSubmit={handleEdit}
          snapshots={snapshots}
          title="スケジュールを編集"
          defaultValues={{
            triggerAt: toLocalDatetimeString(editTarget.triggerAt),
            action: editTarget.action,
            snapshotVersion: editTarget.snapshotVersion,
          }}
        />
      )}
    </section>
  );
}
