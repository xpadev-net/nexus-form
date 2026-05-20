import { Octokit } from "@octokit/rest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubTimeoutFetch } from "../client";

afterEach(() => {
  vi.restoreAllMocks();
});

function getFetchSignal(input: string | URL | Request, init?: RequestInit) {
  if (init?.signal) return init.signal;
  return input instanceof Request ? input.signal : null;
}

describe("GitHub timeout request hook integration", () => {
  it("injects a timeout signal into real Octokit request dispatch", async () => {
    let fetchSignal: AbortSignal | null = null;
    const fakeFetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        fetchSignal = getFetchSignal(_url, init);
        return new Response(JSON.stringify({ login: "octocat" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutSignal);
    const octokit = new Octokit({
      request: { fetch: createGitHubTimeoutFetch(2500, fakeFetch) },
    });

    await octokit.request("GET /users/{username}", { username: "octocat" });

    expect(timeoutSpy).toHaveBeenCalledWith(2500);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(fetchSignal).toBeInstanceOf(AbortSignal);
  });

  it("composes caller-provided request signals in real Octokit dispatch", async () => {
    let fetchSignal: AbortSignal | null = null;
    const fakeFetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        fetchSignal = getFetchSignal(_url, init);
        return new Response(JSON.stringify({ login: "octocat" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const callerSignal = new AbortController().signal;
    const timeoutSignal = new AbortController().signal;
    const composedSignal = new AbortController().signal;
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    const anySpy = vi.spyOn(AbortSignal, "any").mockReturnValue(composedSignal);
    const octokit = new Octokit({
      request: { fetch: createGitHubTimeoutFetch(2500, fakeFetch) },
    });

    await octokit.request("GET /users/{username}", {
      username: "octocat",
      request: { signal: callerSignal },
    });

    expect(anySpy).toHaveBeenCalledWith([callerSignal, timeoutSignal]);
    expect(fetchSignal).toBeInstanceOf(AbortSignal);
  });
});
