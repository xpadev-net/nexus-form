import { z } from "zod";
import { client, RpcError, rpc } from "./api";
import { getRuntimeConfigValue } from "./runtime-config";

/** Supported telemetry token endpoint versions. */
export type TelemetryTokenVersion = "v4" | "v6";

type TelemetryHostResolutionSource = "version-host" | "shared-host";

type TelemetryHostResolution = {
  source: TelemetryHostResolutionSource;
  url: string;
};

/** Telemetry token payload accepted by the public submit API. */
export type PublicSubmitTelemetryToken = {
  v4Token?: string;
  v6Token?: string;
};

type PublicSubmitTelemetryTokenResolution = TelemetryHostResolution & {
  version: TelemetryTokenVersion;
};

const telemetryTokenResponseSchema = z.object({
  token: z.string().min(1),
});

const telemetryTokenPathByVersion: Record<TelemetryTokenVersion, string> = {
  v4: "/api/telemetry/v4",
  v6: "/api/telemetry/v6",
};

const TELEMETRY_TOKEN_FETCH_TIMEOUT_MS = 10_000;

function hasExplicitUrlScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value);
}

function normalizeTelemetryHost(host: string): URL {
  const trimmedHost = host.trim();
  if (trimmedHost === "") {
    throw new Error("Telemetry host is empty");
  }

  const hostUrl = new URL(
    hasExplicitUrlScheme(trimmedHost) ? trimmedHost : `https://${trimmedHost}`,
  );
  if (hostUrl.protocol !== "http:" && hostUrl.protocol !== "https:") {
    throw new Error("Telemetry host must use http or https");
  }

  return hostUrl;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Builds a telemetry token endpoint URL from a bare host or http(s) URL.
 *
 * Bare hosts are normalized to `https://`, and URL path segments are preserved
 * as the base path before appending `/api/telemetry/{version}`.
 */
export function buildTelemetryTokenUrl(
  host: string,
  version: TelemetryTokenVersion,
): string {
  const hostUrl = normalizeTelemetryHost(host);
  const basePath = hostUrl.pathname.endsWith("/")
    ? hostUrl.pathname
    : `${hostUrl.pathname}/`;
  const endpointPath = telemetryTokenPathByVersion[version].replace(/^\/+/, "");
  return new URL(endpointPath, `${hostUrl.origin}${basePath}`).href;
}

function getVersionTelemetryHost(
  version: TelemetryTokenVersion,
): string | undefined {
  if (version === "v4") {
    return getRuntimeConfigValue(
      "telemetryV4Host",
      import.meta.env.VITE_TELEMETRY_V4_HOST,
    );
  }

  return getRuntimeConfigValue(
    "telemetryV6Host",
    import.meta.env.VITE_TELEMETRY_V6_HOST,
  );
}

/**
 * Resolves the endpoint for a specific telemetry token version.
 *
 * Version-specific runtime/build-time host config wins over the shared
 * telemetry host. Returns `null` so callers can use the existing API fallback.
 */
export function resolveTelemetryTokenUrl(
  version: TelemetryTokenVersion,
): TelemetryHostResolution | null {
  const versionHost = getVersionTelemetryHost(version);
  if (versionHost) {
    return {
      source: "version-host",
      url: buildTelemetryTokenUrl(versionHost, version),
    };
  }

  const sharedHost = getRuntimeConfigValue(
    "telemetryHost",
    import.meta.env.VITE_TELEMETRY_HOST,
  );
  if (sharedHost) {
    return {
      source: "shared-host",
      url: buildTelemetryTokenUrl(sharedHost, version),
    };
  }

  return null;
}

/**
 * Resolves the telemetry token endpoints used by public form submits.
 *
 * Public submits attempt both address-family-specific endpoints when they are
 * configured. Returning an empty array means the submit flow should use the
 * existing API client fallback on the v4 endpoint.
 */
export function resolvePublicSubmitTelemetryTokenUrls(): PublicSubmitTelemetryTokenResolution[] {
  return (["v4", "v6"] as const).flatMap((version) => {
    const resolution = resolveTelemetryTokenUrl(version);
    return resolution ? [{ ...resolution, version }] : [];
  });
}

function createTelemetryTokenFetchSignal(): {
  cleanup: () => void;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    TELEMETRY_TOKEN_FETCH_TIMEOUT_MS,
  );
  return {
    cleanup: () => window.clearTimeout(timeoutId),
    signal: controller.signal,
  };
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

async function fetchTelemetryTokenFromHost(url: string): Promise<string> {
  const { cleanup, signal } = createTelemetryTokenFetchSignal();
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "omit",
      headers: { Accept: "application/json" },
      method: "POST",
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("テレメトリトークンの取得がタイムアウトしました");
    }
    throw error;
  } finally {
    cleanup();
  }
  const json: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const details = isRecord(json) ? json : null;
    const errorJson = details as
      | { error?: string; message?: string }
      | null
      | undefined;
    throw new RpcError(
      errorJson?.error ?? errorJson?.message ?? `HTTP ${response.status}`,
      response.status,
      details,
    );
  }

  const result = telemetryTokenResponseSchema.safeParse(json);
  if (!result.success) {
    throw new Error("テレメトリトークンの形式が不正です");
  }
  return result.data.token;
}

/**
 * Fetches a v4 telemetry token using v4/shared host config, then API fallback.
 */
export async function fetchTelemetryV4Token(): Promise<string> {
  const telemetryUrl = resolveTelemetryTokenUrl("v4");
  if (telemetryUrl) {
    return fetchTelemetryTokenFromHost(telemetryUrl.url);
  }

  return (await rpc(client.api.telemetry.v4.$post())).token;
}

/**
 * Fetches the telemetry token payload required for public form submit.
 *
 * Dedicated host failures do not fall back to the API client, so deployment
 * misconfiguration remains visible. When no telemetry host is configured, the
 * existing API client fallback retrieves a v4 token.
 */
export async function fetchPublicSubmitTelemetryToken(): Promise<PublicSubmitTelemetryToken> {
  const telemetryUrls = resolvePublicSubmitTelemetryTokenUrls();
  if (telemetryUrls.length === 0) {
    return { v4Token: (await rpc(client.api.telemetry.v4.$post())).token };
  }

  const tokenResults = await Promise.allSettled(
    telemetryUrls.map(async ({ url, version }) => ({
      token: await fetchTelemetryTokenFromHost(url),
      version,
    })),
  );
  const telemetryToken: PublicSubmitTelemetryToken = {};

  for (const result of tokenResults) {
    if (result.status !== "fulfilled") {
      continue;
    }

    if (result.value.version === "v4") {
      telemetryToken.v4Token = result.value.token;
    } else {
      telemetryToken.v6Token = result.value.token;
    }
  }

  if (telemetryToken.v4Token || telemetryToken.v6Token) {
    return telemetryToken;
  }

  const firstError = tokenResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )?.reason;
  if (firstError instanceof Error) {
    throw firstError;
  }

  throw new Error("テレメトリトークンを取得できませんでした");
}
