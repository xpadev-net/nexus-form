import { RpcError } from "./api";
import { HttpError } from "./fetch-json";

const MAX_QUERY_RETRIES = 3;

function getErrorStatus(error: unknown): number | undefined {
  if (error instanceof RpcError || error instanceof HttpError) {
    return error.status;
  }

  return undefined;
}

/**
 * Decides whether a TanStack Query request should retry.
 *
 * Used by the route provider defaults, PublicFormPage, and FormEditorPage so
 * query retry behavior stays consistent across form loading screens.
 *
 * @param failureCount - The number of failed attempts already reported by TanStack Query.
 * @param error - The thrown query error.
 * @returns `false` for errors with HTTP 400-499 status, otherwise `true` while
 *   `failureCount` is less than `MAX_QUERY_RETRIES`.
 */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  const status = getErrorStatus(error);
  // R15-M6 intentionally treats every 4xx, including 429, as immediately
  // visible client/API feedback instead of applying the shared retry loop.
  if (status !== undefined && status >= 400 && status < 500) {
    return false;
  }
  return failureCount < MAX_QUERY_RETRIES;
}
