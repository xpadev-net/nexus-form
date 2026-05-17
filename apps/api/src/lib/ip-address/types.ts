export type IPStrategy = "telemetry" | "general";

export interface IPExtractionOptions {
  strategy: IPStrategy;
  trustedProxyCount?: number;
}

export type IPSource =
  | "x-nginx-forwarded-for"
  | "x-forwarded-for"
  | "cf-connecting-ip"
  | "x-real-ip"
  | "unknown";

export interface IPExtractionResult {
  ip: string;
  source: IPSource;
}
