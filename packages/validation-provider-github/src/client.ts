import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { GitHubErrorCode } from "./error-codes";
import {
  getGitHubErrorCode,
  getGitHubRateLimitRetryAfter,
  isGitHubUserNotFoundError,
  parseGitHubError,
} from "./utils";

export interface GitHubUserInfo {
  username: string;
  userId: number;
  displayName: string | null;
  avatarUrl: string | null;
  profileUrl: string;
  bio: string | null;
  publicRepos: number;
  followers: number;
  following: number;
  createdAt: string;
  updatedAt: string;
}

export class GitHubApiClient {
  protected octokit: Octokit;
  protected debug = false;

  constructor(
    appId?: string,
    privateKey?: string,
    installationId?: string,
    debug = false,
  ) {
    this.debug = debug;

    const normalizedKey = privateKey?.replace(/\\n/g, "\n");

    if (appId && normalizedKey && installationId) {
      this.octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId,
          privateKey: normalizedKey,
          installationId,
        },
      });
    } else {
      this.octokit = new Octokit();
    }
  }

  async getUserByUsername(username: string): Promise<GitHubUserInfo | null> {
    try {
      const { data } = await this.octokit.users.getByUsername({ username });

      return {
        username: data.login,
        userId: data.id,
        displayName: data.name ?? null,
        avatarUrl: data.avatar_url ?? null,
        profileUrl: data.html_url,
        bio: data.bio ?? null,
        publicRepos: data.public_repos ?? 0,
        followers: data.followers ?? 0,
        following: data.following ?? 0,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    } catch (error) {
      if (isGitHubUserNotFoundError(error)) return null;

      const errorCode = getGitHubErrorCode(error);
      const errorMessage = parseGitHubError(error);

      if (errorCode === GitHubErrorCode.GITHUB_API_RATE_LIMIT) {
        const retryAfter = getGitHubRateLimitRetryAfter(error);
        const enhancedMessage =
          retryAfter !== null
            ? `${errorMessage} (Retry after ${Math.ceil(retryAfter / 1000)}s)`
            : errorMessage;
        const enhancedError = new Error(enhancedMessage);
        (enhancedError as { code?: string; retryAfter?: number }).code =
          errorCode;
        (enhancedError as { code?: string; retryAfter?: number }).retryAfter =
          retryAfter ?? undefined;
        throw enhancedError;
      }

      const enhancedError = new Error(errorMessage);
      (enhancedError as { code?: string }).code = errorCode;
      throw enhancedError;
    }
  }

  async cleanup(): Promise<void> {}
}

let githubClient: GitHubApiClient | null = null;

export function getGitHubClient(
  appId?: string,
  privateKey?: string,
  installationId?: string,
): GitHubApiClient {
  if (
    appId !== undefined ||
    privateKey !== undefined ||
    installationId !== undefined
  ) {
    return new GitHubApiClient(appId, privateKey, installationId);
  }
  if (!githubClient) {
    githubClient = new GitHubApiClient();
  }
  return githubClient;
}
