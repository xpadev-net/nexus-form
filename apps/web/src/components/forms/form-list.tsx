import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { useMemo, useState } from "react";
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

export const FormList = () => {
  const { formsQuery } = useForms();
  const [searchTerm, setSearchTerm] = useState("");
  const [status, setStatus] = useState<FormFilterStatus>("all");
  const forms = formsQuery.data?.forms ?? [];

  const hasArchivedForms = useMemo(
    () => forms.some((item) => normalizeFormStatus(item.status) === "archived"),
    [forms],
  );
  const shouldShowArchiveFilterHint =
    status === "all" && searchTerm === "" && hasArchivedForms;

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
              <Button
                variant="outline"
                className="flex h-auto w-full items-center justify-between gap-2 whitespace-normal p-3 text-left font-normal"
                asChild
              >
                <Link to="/forms/$id/edit" params={{ id: item.id }}>
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
                  <span className="shrink-0 rounded border px-3 py-1 text-sm font-medium">
                    開く
                  </span>
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};
