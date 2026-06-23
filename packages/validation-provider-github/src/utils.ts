import { GitHubErrorCode } from "./error-codes";

const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ECONNRESET",
  "EAI_AGAIN",
  "ECONNABORTED",
]);

const RATE_LIMIT_RETRY_AFTER_HEADER_NAMES = ["retry-after"];
const RATE_LIMIT_RESET_HEADER_NAMES = ["x-ratelimit-reset"];
const RATE_LIMIT_REMAINING_HEADER_NAMES = ["x-ratelimit-remaining"];
const SECONDARY_RATE_LIMIT_MESSAGE_FRAGMENTS = [
  "secondary rate limit",
  "abuse detection mechanism",
];

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
  readonly status?: number;

  constructor(
    message: string,
    code: GitHubErrorCode,
    retryAfter?: number,
    status?: number,
  ) {
    super(message);
    this.name = "GitHubProviderError";
    this.code = code;
    this.retryAfter = retryAfter;
    this.status = status;
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
  const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, value] of Object.entries(headers)) {
    if (!normalizedNames.has(key.toLowerCase())) continue;
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function hasHeaderValue(
  headers: Record<string, unknown> | null,
  names: string[],
): boolean {
  return getHeaderValue(headers, names) !== null;
}

function getGitHubErrorHeaders(error: unknown): Record<string, unknown> | null {
  return getRecordProperty(getRecordProperty(error, "response"), "headers");
}

function getGitHubErrorData(error: unknown): Record<string, unknown> | null {
  return getRecordProperty(getRecordProperty(error, "response"), "data");
}

function getGitHubErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  const message = getStringProperty(error, "message");
  if (message !== null) messages.push(message);

  const data = getGitHubErrorData(error);
  const responseMessage = getStringProperty(data, "message");
  if (responseMessage) messages.push(responseMessage);

  const errors = data?.errors;
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      const entryMessage = getStringProperty(entry, "message");
      if (entryMessage) messages.push(entryMessage);
    }
  }

  return messages;
}

function hasSecondaryRateLimitMessage(error: unknown): boolean {
  return getGitHubErrorMessages(error).some((message) => {
    const normalizedMessage = message.toLowerCase();
    return SECONDARY_RATE_LIMIT_MESSAGE_FRAGMENTS.some((fragment) =>
      normalizedMessage.includes(fragment),
    );
  });
}

function parseRetryAfterHeader(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }

  const retryAtMs = Date.parse(trimmed);
  if (Number.isNaN(retryAtMs)) return null;
  return Math.max(0, retryAtMs - Date.now());
}

function parseRateLimitResetHeader(value: string): number | null {
  const resetTime = Number.parseInt(value, 10);
  if (Number.isNaN(resetTime)) return null;
  const now = Math.floor(Date.now() / 1000);
  const waitSeconds = Math.max(0, resetTime - now);
  return waitSeconds * 1000;
}

function hasRateLimitRemainingZeroHeader(
  headers: Record<string, unknown> | null,
): boolean {
  const remaining = getHeaderValue(headers, RATE_LIMIT_REMAINING_HEADER_NAMES);
  if (remaining === null) return false;
  return remaining === "0";
}

function hasRetryAfterHeader(error: unknown): boolean {
  return hasHeaderValue(
    getGitHubErrorHeaders(error),
    RATE_LIMIT_RETRY_AFTER_HEADER_NAMES,
  );
}

function hasSecondaryRateLimitSignal(error: unknown): boolean {
  return hasRetryAfterHeader(error) || hasSecondaryRateLimitMessage(error);
}

export function isGitHubRateLimitError(error: unknown): boolean {
  const status = getNumberProperty(error, "status");
  if (status === 429) return true;
  if (status !== 403) return false;

  const headers = getGitHubErrorHeaders(error);
  return (
    hasRateLimitRemainingZeroHeader(headers) ||
    hasSecondaryRateLimitSignal(error)
  );
}

function getGitHubRetryAfterHeader(error: unknown): string | null {
  return getHeaderValue(
    getGitHubErrorHeaders(error),
    RATE_LIMIT_RETRY_AFTER_HEADER_NAMES,
  );
}

function getGitHubRateLimitResetHeader(error: unknown): string | null {
  return getHeaderValue(
    getGitHubErrorHeaders(error),
    RATE_LIMIT_RESET_HEADER_NAMES,
  );
}

export function getGitHubRateLimitRetryAfter(error: unknown): number | null {
  const retryAfterHeader = getGitHubRetryAfterHeader(error);
  if (retryAfterHeader) {
    const retryAfter = parseRetryAfterHeader(retryAfterHeader);
    if (retryAfter !== null) return retryAfter;
  }

  const resetHeader = getGitHubRateLimitResetHeader(error);
  if (!resetHeader) return null;
  return parseRateLimitResetHeader(resetHeader);
}

export function parseGitHubError(error: unknown): string {
  const message = getStringProperty(error, "message");
  if (message !== null) return message;
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

export function isGitHubAuthError(error: unknown): boolean {
  return getNumberProperty(error, "status") === 401;
}

export function isGitHubUserNotFoundError(error: unknown): boolean {
  return getNumberProperty(error, "status") === 404;
}

/**
 * Extracts a numeric GitHub API status from an unknown error shape.
 *
 * For example, `{ status: 503 }` returns `503`, while `{ status: "503" }`
 * returns `null`. Extraction and validation are delegated to
 * `getNumberProperty`.
 */
export function getGitHubErrorStatus(error: unknown): number | null {
  return getNumberProperty(error, "status");
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
    ("code" in error || "errno" in error || "name" in error)
  ) {
    const name = getStringProperty(error, "name");
    const code = getStringProperty(error, "code");
    const errno = getStringOrNumberProperty(error, "errno");
    if (name === "TimeoutError") return GitHubErrorCode.TIMEOUT;
    if (RETRYABLE_NETWORK_ERROR_CODES.has(code ?? ""))
      return GitHubErrorCode.NETWORK_ERROR;
    if (code === "ETIMEDOUT" || errno === "ETIMEDOUT")
      return GitHubErrorCode.TIMEOUT;
  }
  return GitHubErrorCode.GITHUB_API_ERROR;
}
