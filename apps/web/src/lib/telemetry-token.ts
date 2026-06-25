import { z } from "zod";
import { client, RpcError, rpc } from "./api";
import { getRuntimeConfigValue } from "./runtime-config";

export type TelemetryTokenVersion = "v4" | "v6";

type TelemetryHostResolutionSource = "version-host" | "shared-host";

type TelemetryHostResolution = {
  source: TelemetryHostResolutionSource;
  url: string;
};

export type PublicSubmitTelemetryToken =
  | { v4Token: string; v6Token?: never }
  | { v4Token?: never; v6Token: string };

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

function hasUrlScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value);
}

function normalizeTelemetryHost(host: string): URL {
  const trimmedHost = host.trim();
  if (trimmedHost === "") {
    throw new Error("Telemetry host is empty");
  }

  const hostUrl = new URL(
    hasUrlScheme(trimmedHost) ? trimmedHost : `https://${trimmedHost}`,
  );
  if (hostUrl.protocol !== "http:" && hostUrl.protocol !== "https:") {
    throw new Error("Telemetry host must use http or https");
  }

  return hostUrl;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function buildTelemetryTokenUrl(
  host: string,
  version: TelemetryTokenVersion,
): string {
  const hostUrl = normalizeTelemetryHost(host);
  return new URL(telemetryTokenPathByVersion[version], hostUrl.origin).href;
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

export function resolvePublicSubmitTelemetryTokenUrl(): PublicSubmitTelemetryTokenResolution | null {
  const v4Host = getVersionTelemetryHost("v4");
  if (v4Host) {
    return {
      source: "version-host",
      url: buildTelemetryTokenUrl(v4Host, "v4"),
      version: "v4",
    };
  }

  const v6Host = getVersionTelemetryHost("v6");
  if (v6Host) {
    return {
      source: "version-host",
      url: buildTelemetryTokenUrl(v6Host, "v6"),
      version: "v6",
    };
  }

  const sharedHost = getRuntimeConfigValue(
    "telemetryHost",
    import.meta.env.VITE_TELEMETRY_HOST,
  );
  if (sharedHost) {
    return {
      source: "shared-host",
      url: buildTelemetryTokenUrl(sharedHost, "v4"),
      version: "v4",
    };
  }

  return null;
}

async function fetchTelemetryTokenFromHost(url: string): Promise<string> {
  const response = await fetch(url, {
    credentials: "omit",
    headers: { Accept: "application/json" },
    method: "POST",
  });
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

export async function fetchTelemetryV4Token(): Promise<string> {
  const telemetryUrl = resolveTelemetryTokenUrl("v4");
  if (telemetryUrl) {
    return fetchTelemetryTokenFromHost(telemetryUrl.url);
  }

  return (await rpc(client.api.telemetry.v4.$post())).token;
}

export async function fetchPublicSubmitTelemetryToken(): Promise<PublicSubmitTelemetryToken> {
  const telemetryUrl = resolvePublicSubmitTelemetryTokenUrl();
  if (!telemetryUrl) {
    return { v4Token: (await rpc(client.api.telemetry.v4.$post())).token };
  }

  const token = await fetchTelemetryTokenFromHost(telemetryUrl.url);
  return telemetryUrl.version === "v4"
    ? { v4Token: token }
    : { v6Token: token };
}
