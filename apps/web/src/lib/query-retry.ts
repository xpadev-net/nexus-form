import { RpcError } from "./api";

const MAX_QUERY_RETRIES = 3;

/**
 * Decides whether a TanStack Query request should retry.
 *
 * Used by the route provider defaults, PublicFormPage, and FormEditorPage so
 * query retry behavior stays consistent across form loading screens.
 *
 * @param failureCount - The number of failed attempts already reported by TanStack Query.
 * @param error - The thrown query error.
 * @returns `false` for `RpcError` 400-499 responses, otherwise `true` while
 *   `failureCount` is less than `MAX_QUERY_RETRIES`.
 */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (error instanceof RpcError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < MAX_QUERY_RETRIES;
}
