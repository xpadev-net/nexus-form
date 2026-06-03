import type {
  ValidationProvider,
  ValidationProviderResult,
  ValidationProviderRule,
} from "@nexus-form/integrations";
import { z } from "zod";
import { GitHubUserInfoSchema, getGitHubClient } from "./client";
import { getGitHubApiTimeoutMs, getGitHubConfig } from "./config";
import { GitHubErrorCode } from "./error-codes";
import { isGitHubProviderError } from "./utils";

const GitHubInputSchema = z
  .string()
  .regex(/^[a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38}$/);

const GitHubConfigSchema = z.object({}).strict();
const RETRYABLE_GITHUB_ERROR_CODES = new Set<GitHubErrorCode>([
  GitHubErrorCode.GITHUB_API_RATE_LIMIT,
  GitHubErrorCode.NETWORK_ERROR,
  GitHubErrorCode.TIMEOUT,
]);
const RETRYABLE_GITHUB_HTTP_STATUSES = new Set([500, 502, 503, 504]);

const GitHubMetadataSchema = GitHubUserInfoSchema;

const GITHUB_EXTERNAL_SERVICE_ERROR_MESSAGE =
  "GitHub APIへの接続に失敗しました。しばらくしてから再試行してください";
const GITHUB_EXTERNAL_REQUEST_ERROR_MESSAGE =
  "GitHub APIへのリクエストに失敗しました";

const invalidGitHubApiResponseResult: ValidationProviderResult = Object.freeze({
  isValid: false,
  errorCode: GitHubErrorCode.GITHUB_API_ERROR,
  errorMessage: "Invalid GitHub API response schema",
});

function normalizeGitHubUsername(username: string): string {
  let normalized = username.trim();
  if (normalized.startsWith("@")) {
    normalized = normalized.slice(1);
  }
  return normalized;
}

function resolveGitHubClient(): ReturnType<typeof getGitHubClient> {
  try {
    const cfg = getGitHubConfig();
    return getGitHubClient(
      cfg.appId,
      cfg.privateKey,
      cfg.installationId,
      cfg.apiTimeoutMs,
    );
  } catch {
    return getGitHubClient();
  }
}

function isRetryableGitHubProviderError(error: {
  code: GitHubErrorCode;
  status?: number;
}): boolean {
  return (
    RETRYABLE_GITHUB_ERROR_CODES.has(error.code) ||
    (error.status != null && RETRYABLE_GITHUB_HTTP_STATUSES.has(error.status))
  );
}

function getSafeGitHubProviderErrorMessage(error: {
  code: GitHubErrorCode;
  status?: number;
}): string {
  if (isRetryableGitHubProviderError(error)) {
    if (error.code === GitHubErrorCode.GITHUB_API_RATE_LIMIT) {
      return "GitHub API rate limit exceeded";
    }
    return GITHUB_EXTERNAL_SERVICE_ERROR_MESSAGE;
  }
  if (error.code === GitHubErrorCode.GITHUB_AUTH_FAILED) {
    return "GitHub API authentication failed";
  }
  return GITHUB_EXTERNAL_REQUEST_ERROR_MESSAGE;
}

const userExistsRule: ValidationProviderRule = {
  name: "user_exists",
  label: "ユーザー存在検証",
  description:
    "GitHubユーザーが存在することを検証します。GitHub App credential が設定されている場合は認証済みAPI、未設定の場合は未認証APIで検証します。",
  inputHint:
    "GitHubユーザー名を入力してください（@不要）。GitHub Appの認証情報やinstallation権限が不足している場合は認証エラーとして失敗します。",
  inputPattern: "^[a-zA-Z\\d](?:[a-zA-Z\\d]|-(?=[a-zA-Z\\d])){0,38}$",
  patternTemplate: {
    id: "github",
    displayName: "GitHub",
    pattern: "^[a-zA-Z\\d](?:[a-zA-Z\\d]|-(?=[a-zA-Z\\d])){0,38}$",
    errorMessage:
      "GitHubのユーザー名形式で入力してください（1-39文字の英数字とハイフン、先頭末尾にハイフン不可）",
    placeholder: "username",
    description: "1-39文字の英数字とハイフン（先頭末尾にハイフン不可）",
    minLength: 1,
    maxLength: 39,
    externalService: "github",
  },
  inputSchema: GitHubInputSchema,
  configSchema: GitHubConfigSchema,
  metadataSchema: GitHubMetadataSchema,

  async validate(input, _config): Promise<ValidationProviderResult> {
    const client = resolveGitHubClient();

    try {
      const userData = await client.getUserByUsername(input);

      if (userData === null) {
        return {
          isValid: false,
          errorCode: GitHubErrorCode.GITHUB_USER_NOT_FOUND,
          errorMessage: `GitHubユーザー「${input}」が見つかりません。`,
        };
      }

      const parsedUserData = GitHubUserInfoSchema.safeParse(userData);
      if (!parsedUserData.success) {
        return invalidGitHubApiResponseResult;
      }

      return {
        isValid: true,
        metadata: parsedUserData.data,
      };
    } catch (error) {
      if (isGitHubProviderError(error)) {
        const retryAfterMs =
          error.code === GitHubErrorCode.GITHUB_API_RATE_LIMIT
            ? error.retryAfter
            : undefined;
        const retryable = isRetryableGitHubProviderError(error);
        return {
          isValid: false,
          errorCode: error.code,
          errorMessage: getSafeGitHubProviderErrorMessage(error),
          retryable,
          ...(error.code === GitHubErrorCode.GITHUB_API_RATE_LIMIT
            ? {
                retryAfter:
                  retryAfterMs != null ? Math.ceil(retryAfterMs / 1000) : 60,
              }
            : {}),
        };
      }

      return {
        isValid: false,
        errorCode: GitHubErrorCode.GITHUB_API_ERROR,
        errorMessage: GITHUB_EXTERNAL_REQUEST_ERROR_MESSAGE,
      };
    }
  },

  normalizeInput(input: string): string {
    return normalizeGitHubUsername(input);
  },
};

export const githubProvider: ValidationProvider = {
  name: "github",
  label: "GitHub",
  description: "GitHubアカウントの存在を検証します",
  rules: {
    user_exists: userExistsRule,
  },

  async healthCheck(): Promise<boolean> {
    return pingGitHubApi();
  },
};

async function pingGitHubApi(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getGitHubApiTimeoutMs());
  try {
    const res = await fetch("https://api.github.com/", {
      method: "GET",
      signal: controller.signal,
    });
    return res.ok || res.status === 401 || res.status === 403;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export default githubProvider;
