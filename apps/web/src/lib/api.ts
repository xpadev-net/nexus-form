import type { AppType } from "@nexus-form/api";
import { hc } from "hono/client";
import { throwFetchFailure } from "./fetch-json";
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

/**
 * Reads the shared-editor token from the current browser URL.
 *
 * @returns The current `shareToken` search parameter, or null outside the browser
 *   and when the URL has no shared-editor token.
 */
export function getShareTokenFromCurrentUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("shareToken");
}

/**
 * Adds a shared-editor token to an EventSource-compatible URL.
 *
 * @returns The original URL when no token is provided or active, otherwise an
 *   absolute URL with the `shareToken` search parameter set.
 */
export function withShareTokenSearchParam(
  url: string,
  shareToken = getShareTokenFromCurrentUrl(),
): string {
  if (!shareToken) return url;

  const nextUrl = new URL(url, window.location.origin);
  nextUrl.searchParams.set("shareToken", shareToken);
  return nextUrl.toString();
}

/**
 * Builds an Authorization header for APIs that can send custom headers.
 *
 * @returns A Bearer authorization header when a shared-editor token is active,
 *   otherwise an empty object suitable for header spreading.
 */
export function getShareTokenAuthorizationHeader():
  | { Authorization: string }
  | Record<string, never> {
  const shareToken = getShareTokenFromCurrentUrl();
  return shareToken ? { Authorization: `Bearer ${shareToken}` } : {};
}

function shouldAttachShareToken(input: RequestInfo | URL): boolean {
  if (typeof window === "undefined") return false;
  const url =
    input instanceof Request
      ? new URL(input.url)
      : new URL(String(input), baseUrl);
  return url.pathname.startsWith("/api/forms/");
}

function withShareTokenAuthHeader(
  input: RequestInfo | URL,
  init?: RequestInit,
): Headers | undefined {
  const shareToken = getShareTokenFromCurrentUrl();
  if (!shareToken || !shouldAttachShareToken(input)) {
    return init?.headers ? new Headers(init.headers) : undefined;
  }

  const headers = new Headers(input instanceof Request ? input.headers : {});
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  if (!headers.has("authorization")) {
    headers.set("Authorization", `Bearer ${shareToken}`);
  }
  return headers;
}

export const client: ReturnType<typeof hc<AppType>> = hc<AppType>(baseUrl, {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await fetch(input, {
        ...init,
        headers: withShareTokenAuthHeader(input, init),
        credentials: "include",
      });
    } catch (error) {
      throwFetchFailure(error);
    }
  },
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
