// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTelemetryTokenUrl,
  fetchPublicSubmitTelemetryToken,
  fetchTelemetryV4Token,
  resolvePublicSubmitTelemetryTokenUrls,
  resolveTelemetryTokenUrl,
} from "./telemetry-token";

const apiMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  telemetryPost: vi.fn(),
}));

vi.mock("./api", () => ({
  client: {
    api: {
      telemetry: {
        v4: { $post: apiMocks.telemetryPost },
      },
    },
  },
  RpcError: class RpcError extends Error {
    readonly details: Record<string, unknown> | null;
    readonly status: number;

    constructor(
      message: string,
      status: number,
      details: Record<string, unknown> | null = null,
    ) {
      super(message);
      this.name = "RpcError";
      this.status = status;
      this.details = details;
    }
  },
  rpc: apiMocks.rpc,
}));

function setRuntimeConfig(config: Record<string, string>): void {
  window.__NEXUS_FORM_CONFIG__ = config;
}

describe("buildTelemetryTokenUrl", () => {
  it("accepts bare hosts and URL values when building versioned endpoints", () => {
    expect(buildTelemetryTokenUrl("ipv4.example.com", "v4")).toBe(
      "https://ipv4.example.com/api/telemetry/v4",
    );
    expect(buildTelemetryTokenUrl("telemetry-service:8080", "v4")).toBe(
      "https://telemetry-service:8080/api/telemetry/v4",
    );
    expect(
      buildTelemetryTokenUrl("https://telemetry.example.com/base", "v6"),
    ).toBe("https://telemetry.example.com/base/api/telemetry/v6");
  });

  it("rejects non-HTTP telemetry hosts", () => {
    expect(() =>
      buildTelemetryTokenUrl("ftp://telemetry.example.com", "v4"),
    ).toThrow("Telemetry host must use http or https");
  });
});

describe("resolveTelemetryTokenUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("prefers version hosts over shared telemetry hosts", () => {
    vi.stubEnv("VITE_TELEMETRY_HOST", "telemetry.build.example");
    setRuntimeConfig({
      telemetryHost: "telemetry.runtime.example",
      telemetryV4Host: "ipv4.runtime.example",
    });

    expect(resolveTelemetryTokenUrl("v4")).toEqual({
      source: "version-host",
      url: "https://ipv4.runtime.example/api/telemetry/v4",
    });
  });

  it("resolves v6-specific hosts for v6 token requests", () => {
    vi.stubEnv("VITE_TELEMETRY_HOST", "telemetry.build.example");
    setRuntimeConfig({
      telemetryV6Host: "ipv6.runtime.example",
    });

    expect(resolveTelemetryTokenUrl("v6")).toEqual({
      source: "version-host",
      url: "https://ipv6.runtime.example/api/telemetry/v6",
    });
  });

  it("falls back to the shared telemetry host before the API client fallback", () => {
    vi.stubEnv("VITE_TELEMETRY_HOST", "telemetry.build.example");
    setRuntimeConfig({
      telemetryV4Host: "",
    });

    expect(resolveTelemetryTokenUrl("v4")).toEqual({
      source: "shared-host",
      url: "https://telemetry.build.example/api/telemetry/v4",
    });
  });

  it("returns null when no telemetry host is configured", () => {
    setRuntimeConfig({});

    expect(resolveTelemetryTokenUrl("v4")).toBeNull();
  });
});

describe("resolvePublicSubmitTelemetryTokenUrls", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    apiMocks.rpc.mockReset();
    apiMocks.telemetryPost.mockReset();
  });

  it("resolves both configured address-family hosts for public submits", () => {
    vi.stubEnv("VITE_TELEMETRY_HOST", "telemetry.build.example");
    setRuntimeConfig({
      telemetryV4Host: "ipv4.runtime.example",
      telemetryV6Host: "ipv6.runtime.example",
    });
    expect(resolvePublicSubmitTelemetryTokenUrls()).toEqual([
      {
        source: "version-host",
        url: "https://ipv4.runtime.example/api/telemetry/v4",
        version: "v4",
      },
      {
        source: "version-host",
        url: "https://ipv6.runtime.example/api/telemetry/v6",
        version: "v6",
      },
    ]);

    setRuntimeConfig({
      telemetryV6Host: "ipv6.runtime.example",
    });
    expect(resolvePublicSubmitTelemetryTokenUrls()).toEqual([
      {
        source: "shared-host",
        url: "https://telemetry.build.example/api/telemetry/v4",
        version: "v4",
      },
      {
        source: "version-host",
        url: "https://ipv6.runtime.example/api/telemetry/v6",
        version: "v6",
      },
    ]);

    setRuntimeConfig({});
    expect(resolvePublicSubmitTelemetryTokenUrls()).toEqual([
      {
        source: "shared-host",
        url: "https://telemetry.build.example/api/telemetry/v4",
        version: "v4",
      },
      {
        source: "shared-host",
        url: "https://telemetry.build.example/api/telemetry/v6",
        version: "v6",
      },
    ]);
  });
});

describe("fetchPublicSubmitTelemetryToken", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    apiMocks.rpc.mockReset();
    apiMocks.telemetryPost.mockReset();
  });

  it("returns both token payloads when both runtime hosts are configured", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            token: url.includes("/v4") ? "v4-host-token" : "v6-host-token",
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    setRuntimeConfig({
      telemetryV4Host: "ipv4.runtime.example",
      telemetryV6Host: "ipv6.runtime.example",
    });

    await expect(fetchPublicSubmitTelemetryToken()).resolves.toEqual({
      v4Token: "v4-host-token",
      v6Token: "v6-host-token",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ipv4.runtime.example/api/telemetry/v4",
      {
        credentials: "omit",
        headers: { Accept: "application/json" },
        method: "POST",
        signal: expect.any(AbortSignal),
      },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ipv6.runtime.example/api/telemetry/v6",
      {
        credentials: "omit",
        headers: { Accept: "application/json" },
        method: "POST",
        signal: expect.any(AbortSignal),
      },
    );
    expect(apiMocks.telemetryPost).not.toHaveBeenCalled();
    expect(apiMocks.rpc).not.toHaveBeenCalled();
  });

  it("returns a v6 token payload when the v4 endpoint fails", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("/v4")
          ? new Response(JSON.stringify({ error: "v4 unavailable" }), {
              status: 503,
            })
          : new Response(JSON.stringify({ token: "v6-host-token" }), {
              status: 200,
            }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    setRuntimeConfig({
      telemetryV4Host: "ipv4.runtime.example",
      telemetryV6Host: "ipv6.runtime.example",
    });

    await expect(fetchPublicSubmitTelemetryToken()).resolves.toEqual({
      v6Token: "v6-host-token",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ipv6.runtime.example/api/telemetry/v6",
      {
        credentials: "omit",
        headers: { Accept: "application/json" },
        method: "POST",
        signal: expect.any(AbortSignal),
      },
    );
    expect(apiMocks.telemetryPost).not.toHaveBeenCalled();
    expect(apiMocks.rpc).not.toHaveBeenCalled();
  });

  it("returns a v4 token payload when the v6 endpoint fails", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("/v6")
          ? new Response(JSON.stringify({ error: "v6 unavailable" }), {
              status: 503,
            })
          : new Response(JSON.stringify({ token: "v4-host-token" }), {
              status: 200,
            }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    setRuntimeConfig({
      telemetryV4Host: "ipv4.runtime.example",
      telemetryV6Host: "ipv6.runtime.example",
    });

    await expect(fetchPublicSubmitTelemetryToken()).resolves.toEqual({
      v4Token: "v4-host-token",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ipv4.runtime.example/api/telemetry/v4",
      {
        credentials: "omit",
        headers: { Accept: "application/json" },
        method: "POST",
        signal: expect.any(AbortSignal),
      },
    );
    expect(apiMocks.telemetryPost).not.toHaveBeenCalled();
    expect(apiMocks.rpc).not.toHaveBeenCalled();
  });

  it("times out when a configured host does not respond", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setRuntimeConfig({
      telemetryV4Host: "ipv4.runtime.example",
    });

    const tokenPromise = expect(
      fetchPublicSubmitTelemetryToken(),
    ).rejects.toThrow("テレメトリトークンの取得がタイムアウトしました");
    await vi.advanceTimersByTimeAsync(10_000);
    await tokenPromise;
    expect(apiMocks.telemetryPost).not.toHaveBeenCalled();
    expect(apiMocks.rpc).not.toHaveBeenCalled();
  });

  it("does not fall back to the API client when a configured host fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setRuntimeConfig({
      telemetryV4Host: "ipv4.runtime.example",
    });

    await expect(fetchPublicSubmitTelemetryToken()).rejects.toThrow(
      "rate limited",
    );
    expect(apiMocks.telemetryPost).not.toHaveBeenCalled();
    expect(apiMocks.rpc).not.toHaveBeenCalled();
  });

  it("uses the existing API client when no telemetry host is configured", async () => {
    apiMocks.telemetryPost.mockReturnValue("telemetry-request");
    apiMocks.rpc.mockResolvedValue({ token: "api-token" });
    setRuntimeConfig({});

    await expect(fetchPublicSubmitTelemetryToken()).resolves.toEqual({
      v4Token: "api-token",
    });
    expect(apiMocks.telemetryPost).toHaveBeenCalledTimes(1);
    expect(apiMocks.rpc).toHaveBeenCalledWith("telemetry-request");
  });
});

describe("fetchTelemetryV4Token", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    apiMocks.rpc.mockReset();
    apiMocks.telemetryPost.mockReset();
  });

  it("fetches v4 tokens from the dedicated runtime host without credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ token: "host-token" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    setRuntimeConfig({
      telemetryV4Host: "ipv4.runtime.example",
    });

    await expect(fetchTelemetryV4Token()).resolves.toBe("host-token");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ipv4.runtime.example/api/telemetry/v4",
      {
        credentials: "omit",
        headers: { Accept: "application/json" },
        method: "POST",
        signal: expect.any(AbortSignal),
      },
    );
    expect(apiMocks.telemetryPost).not.toHaveBeenCalled();
    expect(apiMocks.rpc).not.toHaveBeenCalled();
  });

  it("uses the existing API client when no telemetry host is configured", async () => {
    apiMocks.telemetryPost.mockReturnValue("telemetry-request");
    apiMocks.rpc.mockResolvedValue({ token: "api-token" });
    setRuntimeConfig({});

    await expect(fetchTelemetryV4Token()).resolves.toBe("api-token");
    expect(apiMocks.telemetryPost).toHaveBeenCalledTimes(1);
    expect(apiMocks.rpc).toHaveBeenCalledWith("telemetry-request");
  });
});
