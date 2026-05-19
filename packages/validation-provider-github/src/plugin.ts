import type {
  ValidationProvider,
  ValidationProviderResult,
  ValidationProviderRule,
} from "@nexus-form/integrations";
import { z } from "zod";
import { getGitHubClient } from "./client";
import { getGitHubConfig } from "./config";
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

const GitHubMetadataSchema = z.object({
  username: z.string(),
  userId: z.number(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  profileUrl: z.string().url(),
  bio: z.string().nullable(),
  publicRepos: z.number().int().nonnegative(),
  followers: z.number().int().nonnegative(),
  following: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
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
    return getGitHubClient(cfg.appId, cfg.privateKey, cfg.installationId);
  } catch {
    return getGitHubClient();
  }
}

const userExistsRule: ValidationProviderRule = {
  name: "user_exists",
  label: "ユーザー存在検証",
  description: "GitHubユーザーが存在することを検証します",
  inputHint: "GitHubユーザー名を入力してください（@不要）",
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

      return {
        isValid: true,
        metadata: {
          username: userData.username,
          userId: userData.userId,
          displayName: userData.displayName,
          avatarUrl: userData.avatarUrl,
          profileUrl: userData.profileUrl,
          bio: userData.bio,
          publicRepos: userData.publicRepos,
          followers: userData.followers,
          following: userData.following,
          createdAt: userData.createdAt,
          updatedAt: userData.updatedAt,
        },
      };
    } catch (error) {
      if (isGitHubProviderError(error)) {
        const retryAfterMs =
          error.code === GitHubErrorCode.GITHUB_API_RATE_LIMIT
            ? error.retryAfter
            : undefined;
        return {
          isValid: false,
          errorCode: error.code,
          errorMessage: error.message,
          retryable:
            RETRYABLE_GITHUB_ERROR_CODES.has(error.code) ||
            (error.status != null &&
              RETRYABLE_GITHUB_HTTP_STATUSES.has(error.status)),
          ...(error.code === GitHubErrorCode.GITHUB_API_RATE_LIMIT
            ? {
                retryAfter:
                  retryAfterMs != null ? Math.ceil(retryAfterMs / 1000) : 60,
              }
            : {}),
        };
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        isValid: false,
        errorCode: GitHubErrorCode.GITHUB_API_ERROR,
        errorMessage,
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
  const timeout = setTimeout(() => controller.abort(), 10_000);
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
