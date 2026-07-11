import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { z } from "zod";
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

const GitHubApiTimestampSchema = z.string().datetime({ offset: true });

const GitHubApiUserSchema = z.object({
  login: z.string().min(1),
  id: z.number().int().positive(),
  name: z.string().nullable(),
  avatar_url: z.string().url().nullable(),
  html_url: z.string().url(),
  bio: z.string().nullable(),
  public_repos: z.number().int().nonnegative(),
  followers: z.number().int().nonnegative(),
  following: z.number().int().nonnegative(),
  created_at: GitHubApiTimestampSchema,
  updated_at: GitHubApiTimestampSchema,
});

export const GitHubUserInfoSchema = z.object({
  username: z.string().min(1),
  userId: z.number().int().positive(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  profileUrl: z.string().url(),
  bio: z.string().nullable(),
  publicRepos: z.number().int().nonnegative(),
  followers: z.number().int().nonnegative(),
  following: z.number().int().nonnegative(),
  createdAt: GitHubApiTimestampSchema,
  updatedAt: GitHubApiTimestampSchema,
});

export type GitHubUserInfo = z.infer<typeof GitHubUserInfoSchema>;

function getRequestSignal(init?: RequestInit): AbortSignal | null {
  return init?.signal instanceof AbortSignal ? init.signal : null;
}

function isGitHubCancellationError(
  error: unknown,
  signal: AbortSignal,
): boolean {
  return (
    error === signal.reason ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

export function createGitHubTimeoutFetch(
  apiTimeoutMs: number,
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
  defaultSignal?: AbortSignal,
): typeof fetch {
  return async (input, init) => {
    const timeoutSignal = AbortSignal.timeout(apiTimeoutMs);
    const callerSignal =
      getRequestSignal(init) ??
      (input instanceof Request ? input.signal : null);
    const signals = [callerSignal, defaultSignal].filter(
      (signal, index, allSignals): signal is AbortSignal =>
        signal != null && allSignals.indexOf(signal) === index,
    );
    signals.push(timeoutSignal);
    const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

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
    signal?: AbortSignal,
  ) {
    this.debug = debug;

    const normalizedKey = privateKey?.replace(/\\n/g, "\n");
    const request = {
      fetch: createGitHubTimeoutFetch(apiTimeoutMs, undefined, signal),
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

  async getUserByUsername(
    username: string,
    signal?: AbortSignal,
  ): Promise<GitHubUserInfo | null> {
    try {
      const { data } = await this.octokit.users.getByUsername({
        username,
        ...(signal ? { request: { signal } } : {}),
      });

      const parsed = GitHubApiUserSchema.safeParse(data);
      if (!parsed.success) {
        throw new GitHubProviderError(
          "Invalid GitHub API response schema",
          GitHubErrorCode.GITHUB_API_ERROR,
          undefined,
          undefined,
        );
      }

      return {
        username: parsed.data.login,
        userId: parsed.data.id,
        displayName: parsed.data.name,
        avatarUrl: parsed.data.avatar_url,
        profileUrl: parsed.data.html_url,
        bio: parsed.data.bio,
        publicRepos: parsed.data.public_repos,
        followers: parsed.data.followers,
        following: parsed.data.following,
        createdAt: parsed.data.created_at,
        updatedAt: parsed.data.updated_at,
      };
    } catch (error) {
      if (signal?.aborted && isGitHubCancellationError(error, signal)) {
        throw signal.reason ?? error;
      }
      if (isGitHubUserNotFoundError(error)) return null;
      if (error instanceof GitHubProviderError) throw error;

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
  signal?: AbortSignal,
): GitHubApiClient {
  return new GitHubApiClient(
    appId,
    privateKey,
    installationId,
    false,
    apiTimeoutMs,
    signal,
  );
}
