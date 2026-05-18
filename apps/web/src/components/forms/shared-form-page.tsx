import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { client, RpcError, rpc } from "@/lib/api";
import { FormNotFoundPage } from "./form-not-found-page";

export function SharedFormPage() {
  const { token } = useParams({ from: "/forms/shared/$token" });
  const sharedFormQuery = useQuery({
    queryKey: ["sharedForm", token],
    queryFn: () =>
      rpc(client.api.forms.shared[":token"].$get({ param: { token } })),
    retry: false,
  });
  const notFound =
    sharedFormQuery.error instanceof RpcError &&
    sharedFormQuery.error.status === 404;
  const error =
    sharedFormQuery.isError && !notFound
      ? sharedFormQuery.error instanceof Error
        ? sharedFormQuery.error.message
        : "不明なエラーが発生しました"
      : null;
  const data = sharedFormQuery.data;

  if (sharedFormQuery.isLoading) {
    return <section className="p-6">読み込み中...</section>;
  }

  if (notFound) {
    return (
      <FormNotFoundPage
        title="共有リンクが無効です"
        description="このリンクは存在しないか、有効期限が切れています。"
      />
    );
  }

  if (error || !data) {
    return (
      <section className="p-6">
        <p className="text-sm text-destructive">
          {error ?? "不明なエラーが発生しました"}
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{data.form.title}</h1>
      <p className="text-sm text-muted-foreground">
        {data.form.description ?? "説明はありません"}
      </p>
      <p className="text-sm">共有ロール: {data.role}</p>
      <Link
        to="/forms/$id/edit"
        params={{ id: data.form.id }}
        className="inline-block rounded-md border px-4 py-2 text-sm hover:bg-accent"
      >
        フォーム編集ページへ
      </Link>
    </section>
  );
}
