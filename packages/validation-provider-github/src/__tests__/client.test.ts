import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGitHubTimeoutFetch,
  GitHubApiClient,
  getGitHubClient,
} from "../client";
import { GitHubProviderError } from "../utils";

const { createAppAuthMock, octokitConstructorMock } = vi.hoisted(() => ({
  createAppAuthMock: vi.fn(),
  octokitConstructorMock: vi.fn(() => ({
    users: {
      getByUsername: vi.fn(),
    },
  })),
}));

vi.mock("@octokit/auth-app", () => ({
  createAppAuth: createAppAuthMock,
}));

vi.mock("@octokit/rest", () => ({
  Octokit: octokitConstructorMock,
}));

let client: GitHubApiClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new GitHubApiClient();
});

afterEach(() => {
  delete process.env.GITHUB_API_TIMEOUT_MS;
  octokitConstructorMock.mockClear();
  createAppAuthMock.mockClear();
});

describe("GitHubApiClient.getUserByUsername", () => {
  const validResponse = {
    login: "octocat",
    id: 1,
    name: "Octocat",
    avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    html_url: "https://github.com/octocat",
    bio: "A cat",
    public_repos: 8,
    followers: 5000,
    following: 9,
    created_at: "2011-01-25T18:44:36Z",
    updated_at: "2023-01-01T00:00:00Z",
  };

  it("returns GitHubUserInfo on valid response", async () => {
    const mockGetByUsername = vi.mocked(
      octokitConstructorMock.mock.results[0]?.value.users.getByUsername,
    );
    mockGetByUsername.mockResolvedValue({ data: validResponse });

    const result = await client.getUserByUsername("octocat");

    expect(result).not.toBeNull();
    expect(result?.username).toBe("octocat");
    expect(result?.userId).toBe(1);
    expect(result?.profileUrl).toBe("https://github.com/octocat");
  });

  it("throws GitHubProviderError(GITHUB_API_ERROR) on malformed response (missing login)", async () => {
    const mockGetByUsername = vi.mocked(
      octokitConstructorMock.mock.results[0]?.value.users.getByUsername,
    );
    const { login: _, ...incomplete } = validResponse;
    mockGetByUsername.mockResolvedValue({ data: incomplete });

    await expect(client.getUserByUsername("octocat")).rejects.toThrow(
      GitHubProviderError,
    );
  });

  it("throws GitHubProviderError(GITHUB_API_ERROR) on malformed response (non-numeric id)", async () => {
    const mockGetByUsername = vi.mocked(
      octokitConstructorMock.mock.results[0]?.value.users.getByUsername,
    );
    mockGetByUsername.mockResolvedValue({
      data: { ...validResponse, id: "not-a-number" },
    });

    await expect(client.getUserByUsername("octocat")).rejects.toThrow(
      GitHubProviderError,
    );
  });

  it("returns null on user not found (404)", async () => {
    const mockGetByUsername = vi.mocked(
      octokitConstructorMock.mock.results[0]?.value.users.getByUsername,
    );
    const notFoundError = Object.assign(new Error("Not Found"), {
      status: 404,
    });
    mockGetByUsername.mockRejectedValue(notFoundError);

    const result = await client.getUserByUsername("nonexistent");

    expect(result).toBeNull();
  });
});

describe("GitHubApiClient timeout configuration", () => {
  it("passes the default API timeout to unauthenticated Octokit clients", () => {
    new GitHubApiClient();

    expect(octokitConstructorMock).toHaveBeenCalledWith({
      request: {
        fetch: expect.any(Function),
      },
    });
  });

  it("passes GITHUB_API_TIMEOUT_MS to unauthenticated Octokit clients", () => {
    process.env.GITHUB_API_TIMEOUT_MS = "2500";

    new GitHubApiClient();

    expect(octokitConstructorMock).toHaveBeenCalledWith({
      request: {
        fetch: expect.any(Function),
      },
    });
  });

  it("passes the configured timeout to authenticated Octokit clients", () => {
    getGitHubClient("123", "-----BEGIN PRIVATE KEY-----\\nkey", "456", 3000);

    expect(octokitConstructorMock).toHaveBeenCalledWith({
      authStrategy: createAppAuthMock,
      auth: {
        appId: "123",
        privateKey: "-----BEGIN PRIVATE KEY-----\nkey",
        installationId: "456",
      },
      request: {
        fetch: expect.any(Function),
      },
    });
  });

  it("injects an AbortSignal.timeout signal into fetch requests", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutSignal);
    const response = new Response("{}");
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const timeoutFetch = createGitHubTimeoutFetch(2500, fetchImpl);

    await expect(
      timeoutFetch("https://api.github.com/users/octocat"),
    ).resolves.toBe(response);

    expect(timeoutSpy).toHaveBeenCalledWith(2500);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/users/octocat",
      {
        signal: timeoutSignal,
      },
    );
  });

  it("composes caller-provided fetch signals with the timeout signal", async () => {
    const callerSignal = new AbortController().signal;
    const timeoutSignal = new AbortController().signal;
    const composedSignal = new AbortController().signal;
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    const anySpy = vi.spyOn(AbortSignal, "any").mockReturnValue(composedSignal);
    const response = new Response("{}");
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const timeoutFetch = createGitHubTimeoutFetch(2500, fetchImpl);

    await timeoutFetch("https://api.github.com/users/octocat", {
      signal: callerSignal,
    });

    expect(anySpy).toHaveBeenCalledWith([callerSignal, timeoutSignal]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/users/octocat",
      {
        signal: composedSignal,
      },
    );
  });
});
