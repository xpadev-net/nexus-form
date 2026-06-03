import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArchiveRestore, FileText, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FormFilterBar,
  type FormFilterStatus,
} from "@/components/forms/form-filter-bar";
import { FormStatusBadge } from "@/components/forms/form-status-badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useForms } from "@/hooks/forms/use-forms";
import { client, rpc } from "@/lib/api";

const normalizeFormStatus = (
  status: unknown,
): Exclude<FormFilterStatus, "all"> => {
  if (status === "PUBLISHED") {
    return "published";
  }
  if (status === "UNPUBLISHED") {
    return "unpublished";
  }
  if (status === "ARCHIVED") {
    return "archived";
  }
  return "draft";
};

type FormsQueryCache = {
  forms: Array<{ id: string; status: unknown } & Record<string, unknown>>;
};

export const FormList = () => {
  const { formsQuery } = useForms();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [status, setStatus] = useState<FormFilterStatus>("all");
  const [restoringFormId, setRestoringFormId] = useState<string | null>(null);
  const forms = formsQuery.data?.forms ?? [];

  const hasArchivedForms = useMemo(
    () => forms.some((item) => normalizeFormStatus(item.status) === "archived"),
    [forms],
  );
  const archivedCount = useMemo(
    () =>
      forms.filter((item) => normalizeFormStatus(item.status) === "archived")
        .length,
    [forms],
  );
  const shouldShowArchiveFilterHint =
    status === "all" && searchTerm === "" && hasArchivedForms;

  const unarchiveMutation = useMutation({
    mutationFn: (formId: string) =>
      rpc(client.api.forms[":id"].unarchive.$post({ param: { id: formId } })),
    onMutate: (formId) => {
      setRestoringFormId(formId);
    },
    onSettled: () => {
      setRestoringFormId(null);
    },
    onSuccess: (_data, formId) => {
      queryClient.setQueryData<FormsQueryCache>(["forms"], (current) => {
        if (!current?.forms) return current;
        return {
          ...current,
          forms: current.forms.map((form) =>
            form.id === formId ? { ...form, status: "DRAFT" } : form,
          ),
        };
      });
      void queryClient.invalidateQueries({ queryKey: ["forms"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "アーカイブ解除に失敗しました",
      );
    },
  });

  const filteredForms = useMemo(() => {
    return forms.filter((item) => {
      const currentStatus = normalizeFormStatus(item.status);
      const matchesStatus =
        status === "all"
          ? currentStatus !== "archived"
          : currentStatus === status;
      const matchesSearch = item.title
        .toLowerCase()
        .includes(searchTerm.toLowerCase());
      return matchesStatus && matchesSearch;
    });
  }, [forms, searchTerm, status]);

  if (formsQuery.isLoading) {
    return (
      <div className="py-4 text-sm text-muted-foreground">
        フォームを読み込み中...
      </div>
    );
  }

  if (formsQuery.isError) {
    return (
      <div className="py-4 text-sm text-destructive">
        フォームの読み込みに失敗しました
      </div>
    );
  }

  return (
    <>
      <FormFilterBar
        searchTerm={searchTerm}
        status={status}
        onSearchTermChange={setSearchTerm}
        onStatusChange={setStatus}
      />
      {archivedCount > 0 && status !== "archived" ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            アーカイブ済みフォームが {archivedCount} 件あります
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setStatus("archived")}
          >
            <ArchiveRestore className="mr-1 h-3.5 w-3.5" />
            アーカイブを表示
          </Button>
        </div>
      ) : null}
      {filteredForms.length === 0 ? (
        <Empty className="mt-2 border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>
              {forms.length === 0
                ? "フォームがまだありません"
                : shouldShowArchiveFilterHint
                  ? "表示できるフォームがありません"
                  : "条件に一致するフォームがありません"}
            </EmptyTitle>
            <EmptyDescription>
              {forms.length === 0
                ? "「新規フォームを作成」ボタンから最初のフォームを作りましょう。"
                : shouldShowArchiveFilterHint
                  ? "アーカイブされたフォームはアーカイブフィルターから確認できます。"
                  : "検索条件やフィルターを変更してみてください。"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-2">
          {filteredForms.map((item) => (
            <li key={item.id}>
              <div className="flex flex-col gap-2 rounded border p-3 sm:flex-row sm:items-center sm:justify-between">
                <Link
                  to="/forms/$id/edit"
                  params={{ id: item.id }}
                  className="min-w-0 flex-1 space-y-1 text-left"
                >
                  <div className="space-y-1">
                    <p>{item.title}</p>
                    <FormStatusBadge
                      status={
                        typeof item.status === "string"
                          ? item.status
                          : undefined
                      }
                    />
                  </div>
                </Link>
                <div className="flex shrink-0 gap-2">
                  {status === "archived" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => unarchiveMutation.mutate(item.id)}
                      disabled={unarchiveMutation.isPending}
                    >
                      {unarchiveMutation.isPending &&
                      restoringFormId === item.id ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ArchiveRestore className="mr-1 h-3.5 w-3.5" />
                      )}
                      復元
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/forms/$id/edit" params={{ id: item.id }}>
                      開く
                    </Link>
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};
