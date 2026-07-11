import type {
  ValidationProvider,
  ValidationProviderExecutionContext,
  ValidationProviderResult,
  ValidationProviderRule,
} from "@nexus-form/integrations";
import axios from "axios";
import { z } from "zod";
import { getTwitterClient, TwitterUserInfoSchema } from "./client";
import { assertTwitterEnvironmentConfig } from "./config";
import { TwitterErrorCode } from "./error-codes";
import { parseTwitterError } from "./utils";

const TwitterInputSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_]{1,15}$/)
  .refine((username) => username !== "_", {
    message: "Twitter username cannot be a single underscore",
  });
const TWITTER_HEALTH_CHECK_URL =
  "https://api.twitter.com/2/users/by/username/TwitterDev";

assertTwitterEnvironmentConfig();

const TwitterConfigSchema = z.object({}).strict();

const TwitterMetadataSchema = z.object({
  username: z.string(),
  userId: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().url().nullable(),
  verified: z.boolean(),
  profileUrl: z.string().url(),
  bio: z.string().nullable().optional(),
  followersCount: z.number().int().nonnegative().nullable().optional(),
  followingCount: z.number().int().nonnegative().nullable().optional(),
  tweetCount: z.number().int().nonnegative().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});

function normalizeTwitterUsername(username: string): string {
  let normalized = username.trim().toLowerCase();
  if (normalized.startsWith("@")) {
    normalized = normalized.slice(1);
  }
  return normalized;
}

function isTwitterCancellationError(
  error: unknown,
  signal: AbortSignal,
): boolean {
  return (
    error === signal.reason ||
    (error instanceof DOMException && error.name === "AbortError") ||
    axios.isCancel(error)
  );
}

const userExistsRule: ValidationProviderRule = {
  name: "user_exists",
  label: "ユーザー存在検証",
  description:
    "Twitter/Xユーザーが存在することを検証します。実行にはTWITTER_BEARER_TOKENとUsers lookup APIを呼び出せる権限が必要です。",
  inputHint:
    "Twitter/Xユーザー名を入力してください（@不要）。Bearer tokenが未設定、無効、またはUsers lookup権限が不足している場合は認証エラーとして失敗します。",
  inputPattern: "^[a-zA-Z0-9_]{1,15}$",
  patternTemplate: {
    id: "twitter",
    displayName: "Twitter/X",
    pattern: "^[a-zA-Z0-9_]{1,15}$",
    errorMessage:
      "Twitter/Xのユーザー名形式で入力してください（1-15文字の英数字とアンダースコア）",
    placeholder: "username",
    description: "1-15文字の英数字とアンダースコア",
    minLength: 1,
    maxLength: 15,
    externalService: "twitter",
  },
  inputSchema: TwitterInputSchema,
  configSchema: TwitterConfigSchema,
  metadataSchema: TwitterMetadataSchema,

  async validate(
    input,
    _config,
    context?: ValidationProviderExecutionContext,
  ): Promise<ValidationProviderResult> {
    try {
      const username = TwitterInputSchema.parse(input);
      const client = getTwitterClient();
      const userInfo = context
        ? await client.getUserByUsername(username, context.signal)
        : await client.getUserByUsername(username);

      if (!userInfo) {
        return {
          isValid: false,
          errorCode: TwitterErrorCode.TWITTER_USER_NOT_FOUND,
          errorMessage: "Twitterユーザーが見つかりません",
        };
      }
      // Keep this boundary check even though the bundled client validates
      // upstream responses; tests and external client implementations can
      // still inject malformed user objects.
      const parsedUserInfo = TwitterUserInfoSchema.safeParse(userInfo);
      if (!parsedUserInfo.success) {
        return {
          isValid: false,
          errorCode: TwitterErrorCode.TWITTER_API_ERROR,
          errorMessage: "Twitter API returned malformed user data",
          retryable: false,
        };
      }
      const user = parsedUserInfo.data;

      return {
        isValid: true,
        metadata: {
          username: user.username,
          userId: user.id,
          displayName: user.name || user.username,
          avatarUrl:
            user.profile_image_url?.replace("http://", "https://") || null,
          verified: user.verified ?? false,
          profileUrl: `https://twitter.com/${user.username}`,
          bio: user.description ?? null,
          followersCount: user.public_metrics?.followers_count ?? null,
          followingCount: user.public_metrics?.following_count ?? null,
          tweetCount: user.public_metrics?.tweet_count ?? null,
          createdAt: user.created_at ?? null,
        },
        outputValues: [
          {
            key: "username",
            label: "Twitter/X username",
            value: user.username,
          },
          {
            key: "display_name",
            label: "Display name",
            value: user.name || user.username,
          },
          {
            key: "profile_url",
            label: "Profile URL",
            value: `https://twitter.com/${user.username}`,
          },
          {
            key: "followers",
            label: "Followers",
            value: user.public_metrics?.followers_count ?? null,
          },
          {
            key: "verified",
            label: "Verified",
            value: user.verified ?? false,
          },
        ],
      };
    } catch (error) {
      if (
        context?.signal.aborted &&
        isTwitterCancellationError(error, context.signal)
      ) {
        throw context.signal.reason ?? error;
      }
      const parsed = parseTwitterError(error);

      if (parsed.code === TwitterErrorCode.TWITTER_API_RATE_LIMIT) {
        return {
          isValid: false,
          errorCode: TwitterErrorCode.TWITTER_API_RATE_LIMIT,
          errorMessage: "Twitter API rate limit exceeded",
          retryAfter: parsed.retryAfterSeconds || 60,
          retryable: true,
        };
      }

      return {
        isValid: false,
        errorCode: parsed.code,
        errorMessage: parsed.message,
        retryable: parsed.retryable,
      };
    }
  },

  normalizeInput(input: string): string {
    return normalizeTwitterUsername(input);
  },
};

export const twitterProvider: ValidationProvider = {
  name: "twitter",
  label: "Twitter/X",
  description: "Twitter/Xアカウントの存在を検証します",
  rules: {
    user_exists: userExistsRule,
  },

  async healthCheck(): Promise<boolean> {
    return pingTwitterApi();
  },
};

async function pingTwitterApi(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(TWITTER_HEALTH_CHECK_URL, {
      method: "GET",
      signal: controller.signal,
    });
    // 401/403 = auth failures, 404 = probe user missing, 429 = throttled;
    // all still prove the Twitter API endpoint is reachable.
    return res.ok || [401, 403, 404, 429].includes(res.status);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export default twitterProvider;
