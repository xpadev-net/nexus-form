import { isIP } from "node:net";
import type { IPAddressRequestLike, IPExtractionResult } from "./types";

function parseTrustedProxyCount(
  value: string | undefined = process.env.TRUSTED_PROXY_COUNT,
): number {
  if (!value) return 0;
  if (!/^\d+$/.test(value)) return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeIp(value: string | null | undefined): string | null {
  const ip = value?.trim();
  if (!ip || isIP(ip) === 0) return null;
  return ip;
}

function getSocketRemoteIp(
  request: Request | IPAddressRequestLike,
): string | null {
  if (!("remoteAddress" in request)) return null;
  const remoteAddress = request.remoteAddress;
  return typeof remoteAddress === "string" ? normalizeIp(remoteAddress) : null;
}

function getTrustedForwardedIp(
  forwardedFor: string | null,
  trustedProxyCount: number,
): string | null {
  // Misconfigured proxy counts deliberately collapse to unknown instead of
  // trusting a spoofable left-side XFF value.
  if (trustedProxyCount <= 0 || !forwardedFor) return null;

  const forwardedIps = forwardedFor
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const targetIndex = forwardedIps.length - trustedProxyCount;
  if (targetIndex < 0) return null;

  return normalizeIp(forwardedIps[targetIndex]);
}

/**
 * テレメトリ戦略: x-nginx-forwarded-for → unknown
 * 用途: テレメトリトークン発行
 */
function extractTelemetryIP(
  request: Request | IPAddressRequestLike,
): IPExtractionResult {
  const forwarded = request.headers.get("x-nginx-forwarded-for");

  if (forwarded) {
    const firstIp = forwarded.split(",")[0]?.trim() ?? "unknown";
    return {
      ip: firstIp,
      source: "x-nginx-forwarded-for",
    };
  }

  return {
    ip: "unknown",
    source: "unknown",
  };
}

/**
 * 一般戦略: x-forwarded-for → unknown
 * 用途: レート制限、CAPTCHA、回答送信
 */
function extractGeneralIP(
  request: Request | IPAddressRequestLike,
  trustedProxyCount: number = parseTrustedProxyCount(),
): IPExtractionResult {
  const forwardedIp = getTrustedForwardedIp(
    request.headers.get("x-forwarded-for"),
    trustedProxyCount,
  );
  if (forwardedIp) {
    return {
      ip: forwardedIp,
      source: "x-forwarded-for",
    };
  }

  const socketIp = getSocketRemoteIp(request);
  if (socketIp) {
    return {
      ip: socketIp,
      source: "socket",
    };
  }

  return {
    ip: "unknown",
    source: "unknown",
  };
}

/**
 * 戦略に基づいてIPアドレスを抽出
 */
export function extractIPByStrategy(
  request: Request | IPAddressRequestLike,
  strategy: "telemetry" | "general",
  trustedProxyCount?: number,
): IPExtractionResult {
  switch (strategy) {
    case "telemetry": {
      return extractTelemetryIP(request);
    }
    case "general": {
      return extractGeneralIP(request, trustedProxyCount);
    }
  }
}
