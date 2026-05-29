// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

async function loadBrandConfig(): Promise<typeof import("./brand-config")> {
  vi.resetModules();
  return import("./brand-config");
}

describe("brandConfig", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("prefers validated runtime brand config values", async () => {
    vi.stubGlobal("window", {
      __BRAND_CONFIG__: {
        appName: "Runtime Form",
        primaryColor: "#123456",
      },
    });

    const { brandConfig } = await loadBrandConfig();

    expect(brandConfig.appName).toBe("Runtime Form");
    expect(brandConfig.primaryColor).toBe("#123456");
  });

  it("ignores malformed runtime brand config fields", async () => {
    vi.stubGlobal("window", {
      __BRAND_CONFIG__: {
        appName: 123,
        primaryColor: "#123456",
      },
    });

    const { brandConfig } = await loadBrandConfig();

    expect(brandConfig.appName).toBe("Nexus Form");
    expect(brandConfig.primaryColor).toBe("#123456");
  });

  it("rejects empty string brand config fields", async () => {
    vi.stubGlobal("window", {
      __BRAND_CONFIG__: {
        appName: "",
        primaryColor: "#123456",
      },
    });

    const { brandConfig } = await loadBrandConfig();

    expect(brandConfig.appName).toBe("Nexus Form");
    expect(brandConfig.primaryColor).toBe("#123456");
  });

  it("falls back without warning when runtime brand config is not injected", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("window", {});

    const { brandConfig } = await loadBrandConfig();

    expect(brandConfig.appName).toBe("Nexus Form");
    expect(warn).not.toHaveBeenCalled();
  });
});
