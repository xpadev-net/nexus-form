import type { AppType } from "@nexus-form/api";
import { hc } from "hono/client";
import { getRuntimeConfigValue } from "./runtime-config";

export const baseUrl = getRuntimeConfigValue(
  "apiUrl",
  import.meta.env.VITE_API_URL,
  "http://localhost:3001",
);

/**
 * Returns an absolute API URL, preserving absolute inputs and normalizing
 * relative paths against the configured `baseUrl`.
 *
 * @param path - Absolute URL or API path to resolve.
 * @returns Absolute URL string for use with browser fetch APIs.
 */
export function apiUrl(path: string): string {
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(path)) {
    return path;
  }
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
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
  readonly details: Record<string, unknown> | null;

  constructor(
    message: string,
    status: number,
    details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "RpcError";
    this.status = status;
    this.details = details;
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
    const details =
      json !== null && typeof json === "object" && !Array.isArray(json)
        ? (json as Record<string, unknown>)
        : null;
    throw new RpcError(
      errorJson?.error ?? errorJson?.message ?? `HTTP ${response.status}`,
      response.status,
      details,
    );
  }
  return response.json() as Promise<SuccessOf<JsonOf<T>>>;
}
