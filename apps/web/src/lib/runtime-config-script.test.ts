import { describe, expect, it } from "vitest";
import {
  createRuntimeConfig,
  createRuntimeConfigScript,
  injectRuntimeConfigScript,
} from "./runtime-config-script";

describe("createRuntimeConfig", () => {
  it("maps Vite env values into browser runtime config keys", () => {
    expect(
      createRuntimeConfig({
        VITE_API_URL: "https://api.example.com",
        VITE_BASE_URL: "https://form.example.com",
        VITE_FORM_SECURITY_DEV_BYPASS: "false",
        VITE_HCAPTCHA_SITE_KEY: "10000000-ffff-ffff-ffff-000000000001",
        VITE_TELEMETRY_HOST: "telemetry.example.com",
        VITE_TELEMETRY_V4_HOST: "ipv4.example.com",
        VITE_TELEMETRY_V6_HOST: "ipv6.example.com",
      }),
    ).toEqual({
      apiUrl: "https://api.example.com",
      baseUrl: "https://form.example.com",
      formSecurityDevBypass: "false",
      hcaptchaSiteKey: "10000000-ffff-ffff-ffff-000000000001",
      telemetryHost: "telemetry.example.com",
      telemetryV4Host: "ipv4.example.com",
      telemetryV6Host: "ipv6.example.com",
    });
  });
});

describe("createRuntimeConfigScript", () => {
  it("serializes hCaptcha and telemetry values into window config", () => {
    const script = createRuntimeConfigScript({
      VITE_HCAPTCHA_SITE_KEY: "10000000-ffff-ffff-ffff-000000000001",
      VITE_TELEMETRY_HOST: "telemetry.example.com",
      VITE_TELEMETRY_V4_HOST: "ipv4.example.com",
      VITE_TELEMETRY_V6_HOST: "ipv6.example.com",
    });
    const windowShim: { __NEXUS_FORM_CONFIG__?: unknown } = {};

    new Function("window", script)(windowShim);

    expect(windowShim.__NEXUS_FORM_CONFIG__).toEqual(
      expect.objectContaining({
        hcaptchaSiteKey: "10000000-ffff-ffff-ffff-000000000001",
        telemetryHost: "telemetry.example.com",
        telemetryV4Host: "ipv4.example.com",
        telemetryV6Host: "ipv6.example.com",
      }),
    );
  });
});

describe("injectRuntimeConfigScript", () => {
  it("injects the initial runtime config before container runtime overrides", () => {
    const html = [
      "<html>",
      "  <head>",
      '    <script src="/env-config.js"></script>',
      "  </head>",
      "</html>",
    ].join("\n");

    const transformedHtml = injectRuntimeConfigScript(html, {
      VITE_HCAPTCHA_SITE_KEY: "10000000-ffff-ffff-ffff-000000000001",
      VITE_TELEMETRY_HOST: "telemetry.example.com",
    });

    expect(transformedHtml).toContain("window.__NEXUS_FORM_CONFIG__ = ");
    expect(transformedHtml).toContain(
      '"hcaptchaSiteKey":"10000000-ffff-ffff-ffff-000000000001"',
    );
    expect(transformedHtml).toContain(
      '"telemetryHost":"telemetry.example.com"',
    );
    expect(
      transformedHtml.indexOf("window.__NEXUS_FORM_CONFIG__"),
    ).toBeLessThan(
      transformedHtml.indexOf('<script src="/env-config.js"></script>'),
    );
  });

  it("supports attributes on the env config script anchor", () => {
    const html = [
      "<html>",
      "  <head>",
      `    <script defer crossorigin="anonymous" src='/env-config.js'></script>`,
      "  </head>",
      "</html>",
    ].join("\n");

    const transformedHtml = injectRuntimeConfigScript(html, {
      VITE_HCAPTCHA_SITE_KEY: "10000000-ffff-ffff-ffff-000000000001",
    });

    expect(transformedHtml).toContain("window.__NEXUS_FORM_CONFIG__ = ");
    expect(
      transformedHtml.indexOf("window.__NEXUS_FORM_CONFIG__"),
    ).toBeLessThan(transformedHtml.indexOf("src='/env-config.js'"));
  });

  it("preserves replacement metacharacters in runtime env values", () => {
    const html =
      '<html><head><script src="/env-config.js"></script></head></html>';

    const transformedHtml = injectRuntimeConfigScript(html, {
      VITE_HCAPTCHA_SITE_KEY: "site-$&-$1-$'",
    });

    expect(transformedHtml).toContain('"hcaptchaSiteKey":"site-$&-$1-$\'"');
  });

  it("fails fast when the env config script anchor is missing", () => {
    expect(() =>
      injectRuntimeConfigScript("<html><head></head></html>", {
        VITE_HCAPTCHA_SITE_KEY: "10000000-ffff-ffff-ffff-000000000001",
      }),
    ).toThrow(
      "Unable to inject runtime config: missing /env-config.js script tag in index.html",
    );
  });
});
