import { GitHubErrorCode } from "./error-codes";

export interface OctokitRequestError extends Error {
  status?: number;
  response?: {
    headers?: Record<string, string>;
    data?: {
      message?: string;
      errors?: Array<{ message?: string; code?: string }>;
    };
  };
}

export function isGitHubRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as OctokitRequestError;
  if (err.status !== 403) return false;
  const headers = err.response?.headers || {};
  const remaining =
    headers["x-ratelimit-remaining"] ||
    headers["X-RateLimit-Remaining"] ||
    headers["X-RATELIMIT-REMAINING"];
  if (remaining === undefined) return false;
  return remaining === "0";
}

export function isGitHubAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as OctokitRequestError).status === 401;
}

export function isGitHubUserNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as OctokitRequestError).status === 404;
}

export function getGitHubRateLimitRetryAfter(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const err = error as OctokitRequestError;
  const headers = err.response?.headers || {};
  const resetHeader =
    headers["x-ratelimit-reset"] ||
    headers["X-RateLimit-Reset"] ||
    headers["X-RATELIMIT-RESET"];
  if (!resetHeader) return null;
  try {
    const resetTime = Number.parseInt(resetHeader, 10);
    const now = Math.floor(Date.now() / 1000);
    const waitSeconds = Math.max(0, resetTime - now);
    return waitSeconds * 1000;
  } catch {
    return null;
  }
}

export function parseGitHubError(error: unknown): string {
  if (!error || typeof error !== "object") return "Unknown GitHub API error";
  if ("message" in error && typeof error.message === "string")
    return error.message;
  const err = error as OctokitRequestError;
  if (err.response?.data?.message) return err.response.data.message;
  if (err.response?.data?.errors && Array.isArray(err.response.data.errors)) {
    const messages = err.response.data.errors
      .map((e) => e.message)
      .filter((msg): msg is string => typeof msg === "string");
    if (messages.length > 0) return messages.join("; ");
  }
  return "Unknown GitHub API error";
}

export function getGitHubErrorCode(error: unknown): GitHubErrorCode {
  if (isGitHubRateLimitError(error))
    return GitHubErrorCode.GITHUB_API_RATE_LIMIT;
  if (isGitHubAuthError(error)) return GitHubErrorCode.GITHUB_AUTH_FAILED;
  if (isGitHubUserNotFoundError(error))
    return GitHubErrorCode.GITHUB_USER_NOT_FOUND;
  if (
    error &&
    typeof error === "object" &&
    ("code" in error || "errno" in error)
  ) {
    const err = error as { code?: string; errno?: string | number };
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND")
      return GitHubErrorCode.NETWORK_ERROR;
    if (err.code === "ETIMEDOUT" || err.errno === "ETIMEDOUT")
      return GitHubErrorCode.TIMEOUT;
  }
  return GitHubErrorCode.GITHUB_API_ERROR;
}
