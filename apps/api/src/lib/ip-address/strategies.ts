import type { IPExtractionResult } from "./types";

/**
 * テレメトリ戦略: x-nginx-forwarded-for → unknown
 * 用途: テレメトリトークン発行
 */
function extractTelemetryIP(
  request: Request | { headers: Headers },
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
 * 一般戦略: x-forwarded-for → x-real-ip → unknown
 * 用途: レート制限、CAPTCHA、回答送信
 */
function extractGeneralIP(
  request: Request | { headers: Headers },
): IPExtractionResult {
  // x-forwarded-forを優先的にチェック
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim() ?? "unknown";
    return {
      ip: firstIp,
      source: "x-forwarded-for",
    };
  }

  // x-real-ipをフォールバックとしてチェック
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return {
      ip: realIp.trim(),
      source: "x-real-ip",
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
  request: Request | { headers: Headers },
  strategy: "telemetry" | "general",
): IPExtractionResult {
  switch (strategy) {
    case "telemetry": {
      return extractTelemetryIP(request);
    }
    case "general": {
      return extractGeneralIP(request);
    }
  }
}
