"use client";

import { type FC, type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { client, rpc } from "@/lib/api";

interface PasswordProtectionGateProps {
  publicId: string;
  children: ReactNode;
}

export const PasswordProtectionGate: FC<PasswordProtectionGateProps> = ({
  publicId,
  children,
}) => {
  const [password, setPassword] = useState("");
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (verified) {
    return <>{children}</>;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const result = await rpc(
        client.api.forms.public[":publicId"]["verify-password"].$post({
          param: { publicId },
          json: { password },
        }),
      );
      if (result.valid) {
        setVerified(true);
      } else {
        setError("パスワードが正しくありません");
      }
    } catch {
      setError("パスワードの検証に失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <div className="w-full max-w-md rounded-lg bg-card p-8 shadow-md">
        <h2 className="mb-2 text-center text-xl font-semibold text-foreground">
          パスワード保護
        </h2>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          このフォームにアクセスするにはパスワードが必要です
        </p>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="パスワードを入力"
            className="mb-4 w-full rounded-md border border-input px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            disabled={isLoading}
          />
          {error ? (
            <p className="mb-4 text-sm text-destructive">{error}</p>
          ) : null}
          <Button
            type="submit"
            disabled={isLoading || !password}
            className="w-full"
          >
            {isLoading ? "検証中..." : "送信"}
          </Button>
        </form>
      </div>
    </div>
  );
};
