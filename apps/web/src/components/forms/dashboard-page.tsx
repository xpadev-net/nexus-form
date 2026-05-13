import { useMemo } from "react";
import { FormList } from "@/components/forms/form-list";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useForms } from "@/hooks/forms/use-forms";

export function DashboardPage() {
  const { createFormMutation } = useForms();

  const createButtonLabel = useMemo(() => {
    if (createFormMutation.isPending) {
      return "作成中...";
    }
    return "新規フォームを作成";
  }, [createFormMutation.isPending]);

  return (
    <section className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-card-foreground">
            ホーム
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            フォームの一覧表示と新規作成ができます。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={createFormMutation.isPending}
          onClick={() =>
            createFormMutation.mutate({
              title: "Untitled Form",
            })
          }
        >
          {createFormMutation.isPending ? <Spinner /> : null}
          {createButtonLabel}
        </Button>
      </div>

      <FormList />

      {createFormMutation.isError ? (
        <p className="mt-4 text-sm text-destructive">
          フォームの作成に失敗しました。時間を置いて再度お試しください。
        </p>
      ) : null}
    </section>
  );
}
