import { RpcError } from "./api";
import { HttpError, NetworkError } from "./fetch-json";

const MAX_QUERY_RETRIES = 3;

function getHttpErrorStatus(error: unknown): number | null {
  if (error instanceof RpcError || error instanceof HttpError) {
    return error.status;
  }
  return null;
}

function isRetryableHttpStatus(status: number): boolean {
  return status >= 500 && status < 600;
}

function isRetryableNetworkError(error: unknown): boolean {
  return error instanceof NetworkError;
}

/**
 * Decides whether a TanStack Query request should retry.
 *
 * Used by the route provider defaults, PublicFormPage, and FormEditorPage so
 * query retry behavior stays consistent across form loading screens.
 *
 * @param failureCount - The number of failed attempts already reported by TanStack Query.
 * @param error - The thrown query error.
 * @returns `true` for 5xx HTTP responses and fetch network errors while
 *   `failureCount` is less than `MAX_QUERY_RETRIES`; otherwise `false`.
 */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  const httpStatus = getHttpErrorStatus(error);
  if (httpStatus !== null && !isRetryableHttpStatus(httpStatus)) {
    return false;
  }
  if (httpStatus === null && !isRetryableNetworkError(error)) {
    return false;
  }
  return failureCount < MAX_QUERY_RETRIES;
}
