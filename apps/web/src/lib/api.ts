import type { AppType } from "@nexus-form/api";
import { hc } from "hono/client";

export const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export function apiUrl(path: string): string {
  return new URL(path, baseUrl).toString();
}

export const client: ReturnType<typeof hc<AppType>> = hc<AppType>(baseUrl, {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, {
      ...init,
      credentials: "include",
    }),
});

/**
 * hono-rpc のレスポンスからエラーハンドリング付きで JSON を取得するヘルパー。
 * レスポンス型は hono-rpc の型推論により保証されるため、
 * フロントエンド側での Zod 検証は不要。
 *
 * エラーレスポンス（{ error: string }）は throw されるため、
 * 戻り値の型からは除外される。
 */
type JsonOf<T> = T extends { json(): infer R } ? Awaited<R> : never;
type SuccessOf<T> = Exclude<T, { error: unknown }>;

export class RpcError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RpcError";
    this.status = status;
  }
}

export async function rpc<T extends Response>(
  responseFn: Promise<T>,
): Promise<SuccessOf<JsonOf<T>>> {
  const response = await responseFn;
  if (!response.ok) {
    const json: unknown = await response.json().catch(() => null);
    const errorJson = json as
      | { error?: string; message?: string }
      | null
      | undefined;
    throw new RpcError(
      errorJson?.error ?? errorJson?.message ?? `HTTP ${response.status}`,
      response.status,
    );
  }
  return response.json() as Promise<SuccessOf<JsonOf<T>>>;
}
