import { RpcError } from "./api";

const MAX_QUERY_RETRIES = 3;

export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (error instanceof RpcError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < MAX_QUERY_RETRIES;
}
