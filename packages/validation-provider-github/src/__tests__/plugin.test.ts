import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubErrorCode } from "../error-codes";
import { githubProvider } from "../plugin";
import { GitHubProviderError } from "../utils";

const { getUserByUsernameMock } = vi.hoisted(() => ({
  getUserByUsernameMock: vi.fn(),
}));

vi.mock("../client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client")>();
  return {
    ...actual,
    getGitHubClient: () => ({
      getUserByUsername: getUserByUsernameMock,
    }),
  };
});

beforeEach(() => {
  getUserByUsernameMock.mockReset();
});

const validUserData = {
  username: "octocat",
  userId: 1,
  displayName: "Octocat",
  avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
  profileUrl: "https://github.com/octocat",
  bio: "A cat",
  publicRepos: 8,
  followers: 5000,
  following: 9,
  createdAt: "2011-01-25T18:44:36Z",
  updatedAt: "2023-01-01T00:00:00Z",
};
const safeGitHubApiFailureMessage =
  "GitHub APIへの接続に失敗しました。しばらくしてから再試行してください";

describe("githubProvider.rules.user_exists.inputSchema", () => {
  it("documents credential and installation permission requirements through provider metadata", () => {
    const rule = githubProvider.rules.user_exists;

    expect(rule?.description).toContain("GitHub App credential");
    expect(rule?.inputHint).toContain("installation権限");
  });

  it("accepts usernames matching the advertised GitHub pattern", () => {
    const result =
      githubProvider.rules.user_exists?.inputSchema.safeParse("octo-cat");

    expect(result?.success).toBe(true);
  });

  it("accepts usernames at the minimum and maximum GitHub lengths", () => {
    const schema = githubProvider.rules.user_exists?.inputSchema;

    expect(schema?.safeParse("a").success).toBe(true);
    expect(schema?.safeParse("a".repeat(39)).success).toBe(true);
  });

  it("rejects usernames outside the GitHub length boundaries", () => {
    const schema = githubProvider.rules.user_exists?.inputSchema;

    expect(schema?.safeParse("").success).toBe(false);
    expect(schema?.safeParse("a".repeat(40)).success).toBe(false);
  });

  it("rejects usernames with characters outside the advertised pattern", () => {
    const result =
      githubProvider.rules.user_exists?.inputSchema.safeParse("octo/cat");

    expect(result?.success).toBe(false);
  });

  it("rejects usernames with a trailing hyphen", () => {
    const result =
      githubProvider.rules.user_exists?.inputSchema.safeParse("octocat-");

    expect(result?.success).toBe(false);
  });

  it("rejects usernames with a leading hyphen", () => {
    const result =
      githubProvider.rules.user_exists?.inputSchema.safeParse("-octocat");

    expect(result?.success).toBe(false);
  });
});

describe("githubProvider.rules.user_exists.validate", () => {
  it("validates an existing GitHub user and returns metadata from fixtures", async () => {
    getUserByUsernameMock.mockResolvedValueOnce(validUserData);

    const result = await githubProvider.rules.user_exists?.validate(
      "octocat",
      {},
    );

    expect(result).toEqual({
      isValid: true,
      metadata: validUserData,
    });
  });

  it("returns a user-not-found validation failure for typoed GitHub usernames", async () => {
    getUserByUsernameMock.mockResolvedValueOnce(null);

    const result = await githubProvider.rules.user_exists?.validate(
      "octocatt",
      {},
    );

    expect(result).toEqual({
      isValid: false,
      errorCode: GitHubErrorCode.GITHUB_USER_NOT_FOUND,
      errorMessage: "GitHubユーザー「octocatt」が見つかりません。",
    });
  });

  it("uses structured GitHub provider error codes", async () => {
    getUserByUsernameMock.mockRejectedValueOnce(
      new GitHubProviderError(
        "GitHub authentication failed token=secret",
        GitHubErrorCode.GITHUB_AUTH_FAILED,
      ),
    );

    const result = await githubProvider.rules.user_exists?.validate(
      "octocat",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: GitHubErrorCode.GITHUB_AUTH_FAILED,
      errorMessage: "GitHub API authentication failed",
    });
    expect(result?.errorMessage).not.toContain("token=secret");
    expect(result).not.toHaveProperty("retryAfter");
  });

  it("converts GitHub provider retryAfter milliseconds to seconds", async () => {
    getUserByUsernameMock.mockRejectedValueOnce(
      new GitHubProviderError(
        "GitHub API rate limit exceeded",
        GitHubErrorCode.GITHUB_API_RATE_LIMIT,
        90_000,
      ),
    );

    const result = await githubProvider.rules.user_exists?.validate(
      "octocat",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: GitHubErrorCode.GITHUB_API_RATE_LIMIT,
      errorMessage: "GitHub API rate limit exceeded",
      retryAfter: 90,
      retryable: true,
    });
  });

  it("marks GitHub 5xx provider errors as retryable", async () => {
    getUserByUsernameMock.mockRejectedValueOnce(
      new GitHubProviderError(
        "GitHub API unavailable token=secret trace=abc123",
        GitHubErrorCode.GITHUB_API_ERROR,
        undefined,
        503,
      ),
    );

    const result = await githubProvider.rules.user_exists?.validate(
      "octocat",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: GitHubErrorCode.GITHUB_API_ERROR,
      errorMessage: safeGitHubApiFailureMessage,
      retryable: true,
    });
    expect(result?.errorMessage).not.toContain("token=secret");
    expect(result?.errorMessage).not.toContain("trace=abc123");
  });

  it("marks GitHub provider network errors as retryable", async () => {
    getUserByUsernameMock.mockRejectedValueOnce(
      new GitHubProviderError(
        "Temporary network failure",
        GitHubErrorCode.NETWORK_ERROR,
      ),
    );

    const result = await githubProvider.rules.user_exists?.validate(
      "octocat",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: GitHubErrorCode.NETWORK_ERROR,
      errorMessage: safeGitHubApiFailureMessage,
      retryable: true,
    });
    expect(result?.errorMessage).not.toContain("Temporary network failure");
  });

  it("marks GitHub provider timeout errors as retryable without leaking low-level details", async () => {
    getUserByUsernameMock.mockRejectedValueOnce(
      new GitHubProviderError(
        "request to https://api.github.com/users/octocat timed out token=secret",
        GitHubErrorCode.TIMEOUT,
      ),
    );

    const result = await githubProvider.rules.user_exists?.validate(
      "octocat",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: GitHubErrorCode.TIMEOUT,
      errorMessage: safeGitHubApiFailureMessage,
      retryable: true,
    });
    expect(result?.errorMessage).not.toContain("api.github.com");
    expect(result?.errorMessage).not.toContain("token=secret");
  });

  it("keeps unhandled GitHub API errors non-retryable without leaking upstream details", async () => {
    getUserByUsernameMock.mockRejectedValueOnce(
      new GitHubProviderError(
        "Validation failed for https://api.github.com/users/octocat token=secret",
        GitHubErrorCode.GITHUB_API_ERROR,
        undefined,
        422,
      ),
    );

    const result = await githubProvider.rules.user_exists?.validate(
      "octocat",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: GitHubErrorCode.GITHUB_API_ERROR,
      errorMessage: "GitHub APIへのリクエストに失敗しました",
      retryable: false,
    });
    expect(result?.errorMessage).not.toContain("api.github.com");
    expect(result?.errorMessage).not.toContain("token=secret");
  });

  it("does not mark GitHub permanent provider errors as retryable", async () => {
    getUserByUsernameMock.mockRejectedValueOnce(
      new GitHubProviderError(
        "GitHub authentication failed",
        GitHubErrorCode.GITHUB_AUTH_FAILED,
        undefined,
        401,
      ),
    );

    const result = await githubProvider.rules.user_exists?.validate(
      "octocat",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: GitHubErrorCode.GITHUB_AUTH_FAILED,
      errorMessage: "GitHub API authentication failed",
      retryable: false,
    });
  });

  it.each([
    ["missing username", { username: undefined }],
    ["non-numeric userId", { userId: "not-a-number" }],
    ["invalid createdAt", { createdAt: "not-a-date" }],
  ])("does not treat malformed GitHub user data as successful validation (%s)", async (_caseName, override) => {
    getUserByUsernameMock.mockResolvedValueOnce({
      ...validUserData,
      ...override,
    });

    const result = await githubProvider.rules.user_exists?.validate(
      "octocat",
      {},
    );

    expect(result).toMatchObject({
      isValid: false,
      errorCode: GitHubErrorCode.GITHUB_API_ERROR,
      errorMessage: "Invalid GitHub API response schema",
    });
    expect(result).not.toHaveProperty("metadata");
  });
});
