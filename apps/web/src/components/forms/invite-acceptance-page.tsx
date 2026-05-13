import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { client, RpcError, rpc } from "@/lib/api";
import { FormNotFoundPage } from "./form-not-found-page";

const invitationSchema = z.object({
  invitation: z.object({
    id: z.string(),
    formId: z.string(),
    formTitle: z.string(),
    email: z.string().email(),
    role: z.enum(["OWNER", "EDITOR", "VIEWER"]),
    status: z.string(),
    message: z.string().nullable().optional(),
    expiresAt: z.string(),
  }),
});

const _acceptSchema = z.object({
  permission: z.object({
    form_id: z.string(),
    role: z.enum(["OWNER", "EDITOR", "VIEWER"]),
  }),
});

export function InviteAcceptancePage() {
  const navigate = useNavigate();
  const { token } = useParams({ from: "/forms/invites/$token" });
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [data, setData] = useState<z.infer<typeof invitationSchema> | null>(
    null,
  );

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await rpc(
          client.api.forms.invites[":token"].$get({ param: { token } }),
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

  const handleAccept = async () => {
    try {
      setIsAccepting(true);
      setError(null);
      setSuccess(null);

      const result = await rpc(
        client.api.forms.invites[":token"].accept.$post({ param: { token } }),
      );

      setSuccess("招待を承諾しました。フォーム編集へ移動します。");
      void navigate({
        to: "/forms/$id/edit",
        params: { id: result.permission.form_id },
      });
    } catch (acceptError) {
      setError(
        acceptError instanceof Error
          ? acceptError.message
          : "不明なエラーが発生しました",
      );
    } finally {
      setIsAccepting(false);
    }
  };

  if (isLoading) {
    return <section className="p-6">読み込み中...</section>;
  }

  if (notFound) {
    return (
      <FormNotFoundPage
        title="招待リンクが無効です"
        description="この招待は存在しないか、すでに無効になっています。"
      />
    );
  }

  return (
    <section className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">フォーム招待</h1>
      <p className="text-sm">フォーム: {data?.invitation.formTitle ?? "-"}</p>
      <p className="text-sm">権限: {data?.invitation.role ?? "-"}</p>
      <p className="text-xs text-muted-foreground">
        有効期限: {data?.invitation.expiresAt ?? "-"}
      </p>
      <button
        type="button"
        onClick={() => void handleAccept()}
        disabled={isAccepting}
        className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-60"
      >
        {isAccepting ? "承諾中..." : "招待を承諾"}
      </button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-600">{success}</p> : null}
    </section>
  );
}
