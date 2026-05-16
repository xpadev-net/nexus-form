import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import {
  getTwitterConfig,
  TWITTER_CONFIG_DEFAULTS,
  type TwitterConfig,
  validateTwitterConfig,
} from "./config";
import { TwitterErrorCode } from "./error-codes";
import {
  isValidTwitterUsername,
  normalizeTwitterUsername,
  parseTwitterError,
} from "./utils";

export interface TwitterUserInfo {
  id: string;
  username: string;
  name: string;
  description?: string;
  profile_image_url?: string;
  verified?: boolean;
  public_metrics?: {
    followers_count?: number;
    following_count?: number;
    tweet_count?: number;
    listed_count?: number;
  };
  created_at?: string;
}

interface TwitterApiResponse<T> {
  data?: T;
  errors?: Array<{ code: number; message: string }>;
  meta?: Record<string, unknown>;
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
      baseUrl: config.baseUrl || TWITTER_CONFIG_DEFAULTS.BASE_URL,
      timeout: config.timeout || TWITTER_CONFIG_DEFAULTS.TIMEOUT,
      bearerToken: config.bearerToken,
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

  private async request<T>(
    config: AxiosRequestConfig,
  ): Promise<TwitterApiResponse<T>> {
    const response =
      await this.axiosInstance.request<TwitterApiResponse<T>>(config);
    return response.data;
  }

  async getUserByUsername(username: string): Promise<TwitterUserInfo | null> {
    try {
      const normalizedUsername = normalizeTwitterUsername(username);
      if (!isValidTwitterUsername(normalizedUsername)) {
        throw new Error(`Invalid Twitter username format: ${username}`);
      }
      const response = await this.request<TwitterUserInfo>({
        method: "GET",
        url: `/users/by/username/${normalizedUsername}`,
        params: {
          "user.fields":
            "description,profile_image_url,verified,public_metrics,created_at",
        },
      });
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
      const response = await this.request<TwitterUserInfo>({
        method: "GET",
        url: `/users/${userId}`,
        params: {
          "user.fields":
            "description,profile_image_url,verified,public_metrics,created_at",
        },
      });
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

let twitterClient: TwitterApiClient | null = null;

export function getTwitterClient(config?: TwitterConfig): TwitterApiClient {
  if (config) {
    return new TwitterApiClient(config);
  }
  if (!twitterClient) {
    twitterClient = new TwitterApiClient(getTwitterConfig());
  }
  return twitterClient;
}
