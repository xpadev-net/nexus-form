import type {
  ValidationProvider,
  ValidationProviderResult,
  ValidationProviderRule,
} from "@nexus-form/integrations";
import { z } from "zod";
import { getTwitterClient } from "./client";
import { TwitterErrorCode } from "./error-codes";
import { parseTwitterError } from "./utils";

const TwitterInputSchema = z.string().min(1).max(15);

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

function isValidTwitterUsername(username: string): boolean {
  return /^[a-z0-9_]{1,15}$/.test(username);
}

const userExistsRule: ValidationProviderRule = {
  name: "user_exists",
  label: "ユーザー存在検証",
  description: "Twitter/Xユーザーが存在することを検証します",
  inputHint: "Twitterユーザー名を入力してください（@不要）",
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

  async validate(input, _config): Promise<ValidationProviderResult> {
    if (!isValidTwitterUsername(input)) {
      return {
        isValid: false,
        errorCode: TwitterErrorCode.INVALID_INPUT,
        errorMessage: "無効なTwitterユーザー名形式です",
      };
    }

    try {
      const client = getTwitterClient();
      const userInfo = await client.getUserByUsername(input);

      if (!userInfo) {
        return {
          isValid: false,
          errorCode: TwitterErrorCode.TWITTER_USER_NOT_FOUND,
          errorMessage: "Twitterユーザーが見つかりません",
        };
      }

      return {
        isValid: true,
        metadata: {
          username: userInfo.username,
          userId: userInfo.id,
          displayName: userInfo.name || userInfo.username,
          avatarUrl:
            userInfo.profile_image_url?.replace("http://", "https://") || null,
          verified: userInfo.verified ?? false,
          profileUrl: `https://twitter.com/${userInfo.username}`,
          bio: userInfo.description ?? null,
          followersCount: userInfo.public_metrics?.followers_count ?? null,
          followingCount: userInfo.public_metrics?.following_count ?? null,
          tweetCount: userInfo.public_metrics?.tweet_count ?? null,
          createdAt: userInfo.created_at ?? null,
        },
      };
    } catch (error) {
      const parsed = parseTwitterError(error);

      if (parsed.code === TwitterErrorCode.TWITTER_API_RATE_LIMIT) {
        return {
          isValid: false,
          errorCode: TwitterErrorCode.TWITTER_API_RATE_LIMIT,
          errorMessage: "Twitter API rate limit exceeded",
          retryAfter: 60,
        };
      }

      return {
        isValid: false,
        errorCode: TwitterErrorCode.TWITTER_API_ERROR,
        errorMessage: parsed.message,
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
    const res = await fetch("https://api.twitter.com/2/openapi.json", {
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

export default twitterProvider;
