type RuntimeConfig = {
  apiUrl?: string;
  hcaptchaSiteKey?: string;
};

function getRuntimeConfig(): RuntimeConfig {
  if (typeof window === "undefined") return {};
  const config = (window as unknown as { __NEXUS_FORM_CONFIG__?: unknown })
    .__NEXUS_FORM_CONFIG__;
  if (typeof config !== "object" || config === null) return {};
  return config as RuntimeConfig;
}

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
