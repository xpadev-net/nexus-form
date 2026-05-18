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

export class GitHubProviderError extends Error {
  readonly code: GitHubErrorCode;
  readonly retryAfter?: number;

  constructor(message: string, code: GitHubErrorCode, retryAfter?: number) {
    super(message);
    this.name = "GitHubProviderError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function isGitHubProviderError(
  error: unknown,
): error is GitHubProviderError {
  return error instanceof GitHubProviderError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function getRecordProperty(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const property = value[key];
  return isRecord(property) ? property : null;
}

function getStringProperty(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const property = value[key];
  return typeof property === "string" ? property : null;
}

function getNumberProperty(value: unknown, key: string): number | null {
  if (!isRecord(value)) return null;
  const property = value[key];
  return typeof property === "number" ? property : null;
}

function getStringOrNumberProperty(
  value: unknown,
  key: string,
): string | number | null {
  if (!isRecord(value)) return null;
  const property = value[key];
  return typeof property === "string" || typeof property === "number"
    ? property
    : null;
}

function getHeaderValue(
  headers: Record<string, unknown> | null,
  names: string[],
): string | null {
  if (!headers) return null;
  for (const name of names) {
    const value = headers[name];
    if (typeof value === "string") return value;
  }
  return null;
}

function getGitHubErrorHeaders(error: unknown): Record<string, unknown> | null {
  return getRecordProperty(getRecordProperty(error, "response"), "headers");
}

function getGitHubErrorData(error: unknown): Record<string, unknown> | null {
  return getRecordProperty(getRecordProperty(error, "response"), "data");
}

export function isGitHubRateLimitError(error: unknown): boolean {
  if (getNumberProperty(error, "status") !== 403) return false;
  const remaining = getHeaderValue(getGitHubErrorHeaders(error), [
    "x-ratelimit-remaining",
    "X-RateLimit-Remaining",
    "X-RATELIMIT-REMAINING",
  ]);
  if (remaining === null) return false;
  return remaining === "0";
}

export function isGitHubAuthError(error: unknown): boolean {
  return getNumberProperty(error, "status") === 401;
}

export function isGitHubUserNotFoundError(error: unknown): boolean {
  return getNumberProperty(error, "status") === 404;
}

export function getGitHubRateLimitRetryAfter(error: unknown): number | null {
  const resetHeader = getHeaderValue(getGitHubErrorHeaders(error), [
    "x-ratelimit-reset",
    "X-RateLimit-Reset",
    "X-RATELIMIT-RESET",
  ]);
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
  const message = getStringProperty(error, "message");
  if (message) return message;
  const data = getGitHubErrorData(error);
  const responseMessage = getStringProperty(data, "message");
  if (responseMessage) return responseMessage;
  const errors = data?.errors;
  if (Array.isArray(errors)) {
    const messages = errors
      .map((entry) => getStringProperty(entry, "message"))
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
    const code = getStringProperty(error, "code");
    const errno = getStringOrNumberProperty(error, "errno");
    if (code === "ECONNREFUSED" || code === "ENOTFOUND")
      return GitHubErrorCode.NETWORK_ERROR;
    if (code === "ETIMEDOUT" || errno === "ETIMEDOUT")
      return GitHubErrorCode.TIMEOUT;
  }
  return GitHubErrorCode.GITHUB_API_ERROR;
}
