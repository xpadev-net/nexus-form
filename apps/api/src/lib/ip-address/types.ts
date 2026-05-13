export type IPStrategy = "telemetry" | "general";

export interface IPExtractionOptions {
  strategy: IPStrategy;
}

export type IPSource =
  | "x-nginx-forwarded-for"
  | "x-forwarded-for"
  | "x-real-ip"
  | "unknown";

export interface IPExtractionResult {
  ip: string;
  source: IPSource;
}
