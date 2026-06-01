import type { RuntimeConfig } from "./runtime-config";

type RuntimeConfigEnv = {
  VITE_API_URL?: string;
  VITE_BASE_URL?: string;
  VITE_FORM_SECURITY_DEV_BYPASS?: string;
  VITE_HCAPTCHA_SITE_KEY?: string;
  VITE_TELEMETRY_HOST?: string;
  VITE_TELEMETRY_V4_HOST?: string;
  VITE_TELEMETRY_V6_HOST?: string;
};

export function createRuntimeConfig(env: RuntimeConfigEnv): RuntimeConfig {
  return {
    apiUrl: env.VITE_API_URL ?? "",
    baseUrl: env.VITE_BASE_URL ?? "",
    formSecurityDevBypass: env.VITE_FORM_SECURITY_DEV_BYPASS ?? "",
    hcaptchaSiteKey: env.VITE_HCAPTCHA_SITE_KEY ?? "",
    telemetryHost: env.VITE_TELEMETRY_HOST ?? "",
    telemetryV4Host: env.VITE_TELEMETRY_V4_HOST ?? "",
    telemetryV6Host: env.VITE_TELEMETRY_V6_HOST ?? "",
  };
}

export function createRuntimeConfigScript(env: RuntimeConfigEnv): string {
  const serializedConfig = JSON.stringify(createRuntimeConfig(env))
    .replace(/</g, "\\u003C")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  return `window.__NEXUS_FORM_CONFIG__ = ${serializedConfig};`;
}

export function injectRuntimeConfigScript(
  html: string,
  env: RuntimeConfigEnv,
): string {
  const scriptTag = `<script>${createRuntimeConfigScript(env)}</script>`;
  return html.replace(
    '<script src="/env-config.js"></script>',
    `${scriptTag}\n    <script src="/env-config.js"></script>`,
  );
}
