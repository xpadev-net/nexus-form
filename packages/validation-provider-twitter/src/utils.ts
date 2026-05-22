import { z } from "zod";
import { TwitterErrorCode, type TwitterValidationError } from "./error-codes";

const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ECONNRESET",
  "EAI_AGAIN",
  "ECONNABORTED",
]);

export function normalizeTwitterUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}

export function isValidTwitterUsername(username: string): boolean {
  if (!username || typeof username !== "string") return false;
  const normalized = normalizeTwitterUsername(username);
  if (normalized.length < 1 || normalized.length > 15) return false;
  if (!/^[a-zA-Z0-9_]+$/.test(normalized)) return false;
  if (normalized === "_") return false;
  return true;
}

export function parseTwitterError(error: unknown): TwitterValidationError {
  if (error instanceof z.ZodError) {
    return {
      code: TwitterErrorCode.INVALID_INPUT,
      message: "Invalid Twitter username format",
      retryable: false,
    };
  }

  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    error.response &&
    typeof error.response === "object"
  ) {
    const axiosError = error as {
      response: {
        status?: number;
        headers?: Record<string, string | number | undefined>;
        data?: {
          errors?: Array<{ code?: number; message?: string }>;
          title?: string;
          detail?: string;
          retry_after?: number;
        };
      };
    };
    const status = axiosError.response.status;
    const data = axiosError.response.data;
    const retryAfterHeader = axiosError.response.headers?.["retry-after"];
    const retryAfterSeconds =
      typeof data?.retry_after === "number"
        ? data.retry_after
        : typeof retryAfterHeader === "number"
          ? retryAfterHeader
          : typeof retryAfterHeader === "string"
            ? Number.parseInt(retryAfterHeader, 10)
            : undefined;

    if (status !== undefined) {
      if (status === 429)
        return {
          code: TwitterErrorCode.TWITTER_API_RATE_LIMIT,
          message: data?.title || "Twitter API rate limit exceeded",
          retryable: true,
          retryAfterSeconds: Number.isFinite(retryAfterSeconds)
            ? retryAfterSeconds
            : undefined,
        };
      if (status === 401 || status === 403)
        return {
          code: TwitterErrorCode.TWITTER_AUTH_FAILED,
          message: data?.title || "Twitter API authentication failed",
          retryable: false,
        };
      if (status === 404)
        return {
          code: TwitterErrorCode.TWITTER_USER_NOT_FOUND,
          message: data?.title || "Twitter user not found",
          retryable: false,
        };
      return {
        code: TwitterErrorCode.TWITTER_API_ERROR,
        message:
          data?.errors?.[0]?.message ||
          data?.detail ||
          data?.title ||
          `Twitter API error: ${status}`,
        retryable: status >= 500,
      };
    }
  }

  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    RETRYABLE_NETWORK_ERROR_CODES.has((error as { code?: string }).code ?? "")
  ) {
    return {
      code: TwitterErrorCode.NETWORK_ERROR,
      message: "Network error occurred while connecting to Twitter API",
      retryable: true,
    };
  }

  if (
    error &&
    typeof error === "object" &&
    ("code" in error || "message" in error)
  ) {
    const errorWithCode = error as { code?: unknown; message?: unknown };
    if (
      errorWithCode.code === "ETIMEDOUT" ||
      (typeof errorWithCode.message === "string" &&
        errorWithCode.message.toLowerCase().includes("timeout"))
    ) {
      return {
        code: TwitterErrorCode.TIMEOUT,
        message: "Request to Twitter API timed out",
        retryable: true,
      };
    }
  }

  if (error instanceof Error) {
    return {
      code: TwitterErrorCode.TWITTER_API_ERROR,
      message: error.message || "Unknown Twitter API error",
      retryable: false,
    };
  }

  return {
    code: TwitterErrorCode.UNKNOWN_ERROR,
    message: "Unknown error occurred",
    retryable: false,
  };
}

export function isRateLimitError(error: unknown): boolean {
  return (
    parseTwitterError(error).code === TwitterErrorCode.TWITTER_API_RATE_LIMIT
  );
}

export function isAuthError(error: unknown): boolean {
  return parseTwitterError(error).code === TwitterErrorCode.TWITTER_AUTH_FAILED;
}

export function isNotFoundError(error: unknown): boolean {
  return (
    parseTwitterError(error).code === TwitterErrorCode.TWITTER_USER_NOT_FOUND
  );
}

export async function userExists(
  client: {
    getUserByUsername: (
      username: string,
    ) => Promise<Record<string, unknown> | null>;
  },
  username: string,
): Promise<boolean> {
  try {
    const user = await client.getUserByUsername(username);
    return user != null;
  } catch {
    return false;
  }
}
