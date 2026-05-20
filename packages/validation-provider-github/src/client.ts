import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { getGitHubApiTimeoutMs } from "./config";
import { GitHubErrorCode } from "./error-codes";
import {
  GitHubProviderError,
  getGitHubErrorCode,
  getGitHubErrorStatus,
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

function getRequestSignal(init?: RequestInit): AbortSignal | null {
  return init?.signal instanceof AbortSignal ? init.signal : null;
}

export function createGitHubTimeoutFetch(
  apiTimeoutMs: number,
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
): typeof fetch {
  return async (input, init) => {
    const timeoutSignal = AbortSignal.timeout(apiTimeoutMs);
    const requestSignal =
      getRequestSignal(init) ??
      (input instanceof Request ? input.signal : null);
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, timeoutSignal])
      : timeoutSignal;

    return fetchImpl(input, {
      ...init,
      signal,
    });
  };
}

export class GitHubApiClient {
  protected octokit: Octokit;
  protected debug = false;

  constructor(
    appId?: string,
    privateKey?: string,
    installationId?: string,
    debug = false,
    apiTimeoutMs = getGitHubApiTimeoutMs(),
  ) {
    this.debug = debug;

    const normalizedKey = privateKey?.replace(/\\n/g, "\n");
    const request = {
      fetch: createGitHubTimeoutFetch(apiTimeoutMs),
    };

    if (appId && normalizedKey && installationId) {
      this.octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId,
          privateKey: normalizedKey,
          installationId,
        },
        request,
      });
    } else {
      this.octokit = new Octokit({ request });
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
      const status = getGitHubErrorStatus(error);

      if (errorCode === GitHubErrorCode.GITHUB_API_RATE_LIMIT) {
        const retryAfter = getGitHubRateLimitRetryAfter(error);
        const enhancedMessage =
          retryAfter !== null
            ? `${errorMessage} (Retry after ${Math.ceil(retryAfter / 1000)}s)`
            : errorMessage;
        throw new GitHubProviderError(
          enhancedMessage,
          errorCode,
          retryAfter ?? undefined,
          status ?? undefined,
        );
      }

      throw new GitHubProviderError(
        errorMessage,
        errorCode,
        undefined,
        status ?? undefined,
      );
    }
  }

  async cleanup(): Promise<void> {}
}

export function getGitHubClient(
  appId?: string,
  privateKey?: string,
  installationId?: string,
  apiTimeoutMs?: number,
): GitHubApiClient {
  return new GitHubApiClient(
    appId,
    privateKey,
    installationId,
    false,
    apiTimeoutMs,
  );
}
