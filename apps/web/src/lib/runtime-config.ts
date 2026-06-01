import { z } from "zod";

const runtimeConfigSchema = z.object({
  apiUrl: z.string().optional().catch(undefined),
  baseUrl: z.string().optional().catch(undefined),
  formSecurityDevBypass: z.string().optional().catch(undefined),
  hcaptchaSiteKey: z.string().optional().catch(undefined),
  telemetryHost: z.string().optional().catch(undefined),
  telemetryV4Host: z.string().optional().catch(undefined),
  telemetryV6Host: z.string().optional().catch(undefined),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

declare global {
  interface Window {
    __NEXUS_FORM_CONFIG__?: unknown;
  }
}

function getRuntimeConfig(): RuntimeConfig {
  if (typeof window === "undefined") return {};
  const result = runtimeConfigSchema.safeParse(window.__NEXUS_FORM_CONFIG__);
  if (result.success) return result.data;
  return {};
}

export function getRuntimeConfigValue(
  key: keyof RuntimeConfig,
  buildTimeValue: string | undefined,
  fallback: string,
): string;
export function getRuntimeConfigValue(
  key: keyof RuntimeConfig,
  buildTimeValue: string | undefined,
): string | undefined;
export function getRuntimeConfigValue(
  key: keyof RuntimeConfig,
  buildTimeValue: string | undefined,
  fallback?: string,
): string | undefined {
  const runtimeValue = getRuntimeConfig()[key];
  if (runtimeValue !== undefined && runtimeValue !== "") return runtimeValue;
  if (buildTimeValue !== undefined && buildTimeValue !== "")
    return buildTimeValue;
  return fallback;
}
