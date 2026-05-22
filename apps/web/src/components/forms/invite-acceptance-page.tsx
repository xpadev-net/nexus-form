import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { client, RpcError, rpc } from "@/lib/api";
import { FormNotFoundPage } from "./form-not-found-page";

export function InviteAcceptancePage() {
  const navigate = useNavigate();
  const { token } = useParams({ from: "/forms/invites/$token" });
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const invitationQuery = useQuery({
    queryKey: ["formInvite", token],
    queryFn: () =>
      rpc(client.api.forms.invites[":token"].$get({ param: { token } })),
    retry: false,
    staleTime: Infinity,
  });
  const notFound =
    invitationQuery.error instanceof RpcError &&
    invitationQuery.error.status === 404;
  const loadErrorMessage =
    invitationQuery.isError && !notFound
      ? invitationQuery.error instanceof Error
        ? invitationQuery.error.message
        : "不明なエラーが発生しました"
      : null;
  const data = invitationQuery.data;

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

  if (invitationQuery.isLoading) {
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
      <Button
        type="button"
        variant="outline"
        onClick={() => void handleAccept()}
        disabled={isAccepting}
      >
        {isAccepting ? "承諾中..." : "招待を承諾"}
      </Button>
      {error || loadErrorMessage ? (
        <p className="text-sm text-destructive">{error ?? loadErrorMessage}</p>
      ) : null}
      {success ? <p className="text-sm text-emerald-600">{success}</p> : null}
    </section>
  );
}
