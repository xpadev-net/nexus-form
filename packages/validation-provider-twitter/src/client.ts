import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import { z } from "zod";
import {
  getTwitterConfig,
  TWITTER_CONFIG_DEFAULTS,
  type TwitterConfig,
  validateTwitterConfig,
} from "./config";
import { TwitterErrorCode } from "./error-codes";
import { normalizeTwitterUsername, parseTwitterError } from "./utils";

export const TwitterUserInfoSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  profile_image_url: z.string().url().optional(),
  verified: z.boolean().optional(),
  public_metrics: z
    .object({
      followers_count: z.number().int().nonnegative().optional(),
      following_count: z.number().int().nonnegative().optional(),
      tweet_count: z.number().int().nonnegative().optional(),
      listed_count: z.number().int().nonnegative().optional(),
    })
    .optional(),
  created_at: z.string().optional(),
});

export type TwitterUserInfo = z.infer<typeof TwitterUserInfoSchema>;

interface TwitterApiResponse<T> {
  data?: T;
  errors?: Array<{ code: number; message: string }>;
  meta?: Record<string, unknown>;
}

const TwitterApiErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
});

const TwitterApiResponseBaseSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(TwitterApiErrorSchema).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

function parseTwitterApiResponse<T>(
  raw: unknown,
  dataSchema: z.ZodSchema<T>,
): TwitterApiResponse<T> {
  const responseResult = TwitterApiResponseBaseSchema.safeParse(raw);
  if (!responseResult.success) {
    throw new Error("Twitter API returned malformed response", {
      cause: responseResult.error,
    });
  }

  const response = responseResult.data;
  if (response.data == null) {
    return {
      errors: response.errors,
      meta: response.meta,
    };
  }

  const dataResult = dataSchema.safeParse(response.data);
  if (!dataResult.success) {
    throw new Error("Twitter API returned malformed user data", {
      cause: dataResult.error,
    });
  }

  return {
    data: dataResult.data,
    errors: response.errors,
    meta: response.meta,
  };
}

export class TwitterApiClient {
  private axiosInstance: AxiosInstance;
  private config: TwitterConfig;
  protected debug = false;

  constructor(config: TwitterConfig, debug = false) {
    const validation = validateTwitterConfig(config);
    if (!validation.isValid) {
      throw new Error(
        `Invalid Twitter config: ${validation.errors.join(", ")}`,
      );
    }
    this.config = {
      apiVersion: config.apiVersion || TWITTER_CONFIG_DEFAULTS.API_VERSION,
      baseUrl: (config.baseUrl || TWITTER_CONFIG_DEFAULTS.BASE_URL).replace(
        /\/+$/,
        "",
      ),
      timeout: config.timeout || TWITTER_CONFIG_DEFAULTS.TIMEOUT,
      bearerToken: config.bearerToken,
      allowedBaseUrlHosts: config.allowedBaseUrlHosts,
    };
    this.debug = debug;
    this.axiosInstance = axios.create({
      baseURL: `${this.config.baseUrl}/${this.config.apiVersion}`,
      timeout: this.config.timeout,
      headers: {
        Authorization: `Bearer ${this.config.bearerToken}`,
        "Content-Type": "application/json",
      },
    });
  }

  private async request(config: AxiosRequestConfig): Promise<unknown> {
    const response = await this.axiosInstance.request<unknown>(config);
    return response.data;
  }

  async getUserByUsername(username: string): Promise<TwitterUserInfo | null> {
    try {
      const normalizedUsername = normalizeTwitterUsername(username);
      const response = parseTwitterApiResponse(
        await this.request({
          method: "GET",
          url: `/users/by/username/${normalizedUsername}`,
          params: {
            "user.fields":
              "description,profile_image_url,verified,public_metrics,created_at",
          },
        }),
        TwitterUserInfoSchema,
      );
      if (response.errors && response.errors.length > 0) {
        const error = response.errors[0];
        if (error?.code === 50) return null;
        throw new Error(
          `Twitter API error: ${error?.message ?? "Unknown error"}`,
        );
      }
      return response.data ?? null;
    } catch (error) {
      const validationError = parseTwitterError(error);
      if (validationError.code === TwitterErrorCode.TWITTER_USER_NOT_FOUND)
        return null;
      throw error;
    }
  }

  async getUserById(userId: string): Promise<TwitterUserInfo | null> {
    try {
      if (!/^\d+$/.test(userId)) {
        throw new Error(`Invalid Twitter user ID format: ${userId}`);
      }
      const response = parseTwitterApiResponse(
        await this.request({
          method: "GET",
          url: `/users/${userId}`,
          params: {
            "user.fields":
              "description,profile_image_url,verified,public_metrics,created_at",
          },
        }),
        TwitterUserInfoSchema,
      );
      if (response.errors && response.errors.length > 0) {
        const error = response.errors[0];
        if (error?.code === 50) return null;
        throw new Error(
          `Twitter API error: ${error?.message ?? "Unknown error"}`,
        );
      }
      return response.data ?? null;
    } catch (error) {
      const validationError = parseTwitterError(error);
      if (validationError.code === TwitterErrorCode.TWITTER_USER_NOT_FOUND)
        return null;
      throw error;
    }
  }

  async cleanup(): Promise<void> {}
}

export function getTwitterClient(config?: TwitterConfig): TwitterApiClient {
  if (config) {
    return new TwitterApiClient(config);
  }
  return new TwitterApiClient(getTwitterConfig());
}
