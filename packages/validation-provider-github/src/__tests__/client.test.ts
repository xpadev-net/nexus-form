import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGitHubTimeoutFetch,
  GitHubApiClient,
  getGitHubClient,
} from "../client";

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

afterEach(() => {
  delete process.env.GITHUB_API_TIMEOUT_MS;
  octokitConstructorMock.mockClear();
  createAppAuthMock.mockClear();
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
