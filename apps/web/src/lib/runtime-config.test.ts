// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimeConfigValue } from "./runtime-config";

describe("getRuntimeConfigValue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers runtime values over build-time values", () => {
    vi.stubGlobal("window", {
      __NEXUS_FORM_CONFIG__: {
        apiUrl: "https://api.runtime.example",
        formSecurityDevBypass: "true",
        telemetryHost: "telemetry.runtime.example",
        telemetryV4Host: "ipv4.runtime.example",
        telemetryV6Host: "ipv6.runtime.example",
      },
    });

    expect(
      getRuntimeConfigValue(
        "apiUrl",
        "https://api.build.example",
        "http://localhost:3001",
      ),
    ).toBe("https://api.runtime.example");
    expect(getRuntimeConfigValue("formSecurityDevBypass", "false")).toBe(
      "true",
    );
    expect(
      getRuntimeConfigValue("telemetryHost", "telemetry.build.example"),
    ).toBe("telemetry.runtime.example");
    expect(getRuntimeConfigValue("telemetryV4Host", "ipv4.build.example")).toBe(
      "ipv4.runtime.example",
    );
    expect(getRuntimeConfigValue("telemetryV6Host", "ipv6.build.example")).toBe(
      "ipv6.runtime.example",
    );
  });

  it("falls back to build-time values and defaults when runtime values are empty", () => {
    vi.stubGlobal("window", {
      __NEXUS_FORM_CONFIG__: {
        apiUrl: "",
      },
    });

    expect(
      getRuntimeConfigValue(
        "apiUrl",
        "https://api.build.example",
        "http://localhost:3001",
      ),
    ).toBe("https://api.build.example");

    expect(getRuntimeConfigValue("hcaptchaSiteKey", "", "fallback")).toBe(
      "fallback",
    );
    expect(
      getRuntimeConfigValue("telemetryHost", "telemetry.build.example"),
    ).toBe("telemetry.build.example");
  });
});
