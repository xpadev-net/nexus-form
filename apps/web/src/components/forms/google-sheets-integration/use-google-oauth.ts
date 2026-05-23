import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { apiUrl, baseUrl } from "@/lib/api";
import { logError } from "@/lib/logger";
import { isRecord } from "@/lib/type-guards";

interface GoogleOAuthMessage {
  source: "google-oauth";
  status: "success" | "error";
  message?: string;
  state?: string | null;
}

const isGoogleOAuthMessage = (value: unknown): value is GoogleOAuthMessage => {
  if (!isRecord(value)) return false;
  return (
    value.source === "google-oauth" &&
    (value.status === "success" || value.status === "error")
  );
};

export interface UseGoogleOAuthOptions {
  queryClient: QueryClient;
  authorizePath?: string;
}

export function useGoogleOAuth({
  queryClient,
  authorizePath = "/api/integrations/google/authorize",
}: UseGoogleOAuthOptions) {
  const authWindowRef = useRef<Window | null>(null);
  const popupIntervalRef = useRef<number | null>(null);

  const invalidateGoogleQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["google-connection"] });
    void queryClient.invalidateQueries({ queryKey: ["spreadsheets"] });
  }, [queryClient]);

  const handleConnect = useCallback(async () => {
    try {
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      const authorizeUrl = new URL(apiUrl(authorizePath));
      authorizeUrl.searchParams.set("app_origin", window.location.origin);

      const authWindow = window.open(
        authorizeUrl.toString(),
        "GoogleAuth",
        `width=${width},height=${height},left=${left},top=${top}`,
      );

      if (!authWindow) {
        toast.error(
          "ポップアップを開けませんでした。ブラウザ設定を確認してください。",
        );
        return;
      }

      authWindowRef.current = authWindow;

      if (popupIntervalRef.current) {
        window.clearInterval(popupIntervalRef.current);
        popupIntervalRef.current = null;
      }

      popupIntervalRef.current = window.setInterval(() => {
        if (!authWindowRef.current || authWindowRef.current.closed) {
          if (popupIntervalRef.current) {
            window.clearInterval(popupIntervalRef.current);
            popupIntervalRef.current = null;
          }
          invalidateGoogleQueries();
        }
      }, 1000);
    } catch (error) {
      logError("Failed to start OAuth:", "ui", { error: error });
      toast.error("認証の開始に失敗しました");
    }
  }, [authorizePath, invalidateGoogleQueries]);

  useEffect(() => {
    const allowedMessageOrigins = new Set([
      window.location.origin,
      new URL(baseUrl).origin,
    ]);

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!allowedMessageOrigins.has(event.origin)) return;
      if (event.source !== authWindowRef.current) return;
      if (!isGoogleOAuthMessage(event.data)) return;

      if (popupIntervalRef.current) {
        window.clearInterval(popupIntervalRef.current);
        popupIntervalRef.current = null;
      }

      if (authWindowRef.current && !authWindowRef.current.closed) {
        authWindowRef.current.close();
      }
      authWindowRef.current = null;

      if (event.data.status === "success") {
        toast.success("Googleアカウントに接続しました");
        invalidateGoogleQueries();
        return;
      }

      toast.error(
        event.data.message ?? "Google連携に失敗しました。再度お試しください。",
      );
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
      if (popupIntervalRef.current) {
        window.clearInterval(popupIntervalRef.current);
        popupIntervalRef.current = null;
      }
      if (authWindowRef.current && !authWindowRef.current.closed) {
        authWindowRef.current.close();
      }
      authWindowRef.current = null;
    };
  }, [invalidateGoogleQueries]);

  return { handleConnect };
}
