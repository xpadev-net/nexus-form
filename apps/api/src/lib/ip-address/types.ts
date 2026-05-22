export type IPStrategy = "telemetry" | "general";

export interface IPAddressRequestLike {
  headers: Headers;
  remoteAddress?: string;
}

export interface IPExtractionOptions {
  strategy: IPStrategy;
  trustedProxyCount?: number;
}

export type IPSource =
  | "x-nginx-forwarded-for"
  | "x-forwarded-for"
  | "socket"
  | "unknown";

export interface IPExtractionResult {
  ip: string;
  source: IPSource;
}
