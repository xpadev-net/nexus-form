import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { client, RpcError, rpc } from "@/lib/api";
import { FormNotFoundPage } from "./form-not-found-page";

const sharedFormSchema = z.object({
  form: z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
  }),
  role: z.enum(["EDITOR", "VIEWER"]),
  share_link: z.object({
    expires_at: z.string().nullable().optional(),
  }),
});

export function SharedFormPage() {
  const { token } = useParams({ from: "/forms/shared/$token" });
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<z.infer<typeof sharedFormSchema> | null>(
    null,
  );

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const result = await rpc(
          client.api.forms.shared[":token"].$get({ param: { token } }),
        );

        if (active) {
          setData(result);
        }
      } catch (loadError) {
        if (active) {
          if (loadError instanceof RpcError && loadError.status === 404) {
            setNotFound(true);
          } else {
            setError(
              loadError instanceof Error
                ? loadError.message
                : "不明なエラーが発生しました",
            );
          }
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [token]);

  if (isLoading) {
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
