import { type FormEvent, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useSignIn } from "@/hooks/auth/use-auth";
import { client } from "@/lib/api";

const invitationRequestSchema = z.object({
  code: z.string().min(1),
});

const invitationResponseSchema = z
  .object({
    ok: z.boolean(),
    message: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

interface InvitationCodeFormProps {
  isLoading?: boolean;
}

export function InvitationCodeForm({
  isLoading = false,
}: InvitationCodeFormProps) {
  const [invitationCode, setInvitationCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");
  const { signInWithDiscord } = useSignIn();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = invitationCode.trim();
    if (!code) {
      return;
    }

    setIsVerifying(true);
    setError("");

    try {
      const payload = invitationRequestSchema.parse({ code });
      const response = await client.api["auth-ext"][
        "signin-with-invitation"
      ].$post({
        json: payload,
      });
      const responseJson = await response.json();
      const data = invitationResponseSchema.parse(responseJson);

      if (!response.ok || !data.ok) {
        setError(data.error ?? "招待コードの検証に失敗しました");
        return;
      }

      await signInWithDiscord();
    } catch (submissionError) {
      console.error("Invitation code verification failed", submissionError);
      setError(
        submissionError instanceof TypeError
          ? "ネットワーク接続に失敗しました。通信環境をご確認ください。"
          : "招待コードの確認に失敗しました。",
      );
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="invitation-code" className="text-sm font-medium">
          招待コード
        </label>
        <input
          id="invitation-code"
          type="text"
          placeholder="招待コードを入力してください"
          value={invitationCode}
          onChange={(event) => setInvitationCode(event.target.value)}
          required
          disabled={isLoading || isVerifying}
          className="w-full rounded border bg-background px-3 py-2 text-sm"
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
      <Button
        type="submit"
        variant="outline"
        className="w-full"
        disabled={isLoading || isVerifying || !invitationCode.trim()}
      >
        {isVerifying
          ? "確認中..."
          : isLoading
            ? "サインイン中..."
            : "Discordでサインイン"}
      </Button>
    </form>
  );
}
