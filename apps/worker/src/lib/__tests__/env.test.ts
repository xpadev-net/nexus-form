import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getValidationPluginTimeoutMs,
  VALIDATION_PLUGIN_TIMEOUT_DEFAULT_MS,
  VALIDATION_PLUGIN_TIMEOUT_MAX_MS,
  VALIDATION_PLUGIN_TIMEOUT_MIN_MS,
} from "../env";

const originalEnv = process.env;

describe("getValidationPluginTimeoutMs", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VALIDATION_PLUGIN_TIMEOUT_MS;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("uses the default when the environment variable is unset", () => {
    expect(getValidationPluginTimeoutMs()).toBe(
      VALIDATION_PLUGIN_TIMEOUT_DEFAULT_MS,
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("uses the default without warning for an empty value", () => {
    process.env.VALIDATION_PLUGIN_TIMEOUT_MS = "";

    expect(getValidationPluginTimeoutMs()).toBe(
      VALIDATION_PLUGIN_TIMEOUT_DEFAULT_MS,
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("accepts values within the configured bounds", () => {
    process.env.VALIDATION_PLUGIN_TIMEOUT_MS = "120000";

    expect(getValidationPluginTimeoutMs()).toBe(120_000);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("accepts the maximum configured value", () => {
    process.env.VALIDATION_PLUGIN_TIMEOUT_MS = String(
      VALIDATION_PLUGIN_TIMEOUT_MAX_MS,
    );

    expect(getValidationPluginTimeoutMs()).toBe(
      VALIDATION_PLUGIN_TIMEOUT_MAX_MS,
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("accepts the minimum configured value", () => {
    process.env.VALIDATION_PLUGIN_TIMEOUT_MS = String(
      VALIDATION_PLUGIN_TIMEOUT_MIN_MS,
    );

    expect(getValidationPluginTimeoutMs()).toBe(
      VALIDATION_PLUGIN_TIMEOUT_MIN_MS,
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("clamps positive values below the operational minimum", () => {
    process.env.VALIDATION_PLUGIN_TIMEOUT_MS = String(
      VALIDATION_PLUGIN_TIMEOUT_MIN_MS - 1,
    );

    expect(getValidationPluginTimeoutMs()).toBe(
      VALIDATION_PLUGIN_TIMEOUT_MIN_MS,
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("clamping"),
    );
  });

  it.each([
    "invalid",
    "0",
    "-1",
    "1.5",
    String(VALIDATION_PLUGIN_TIMEOUT_MAX_MS + 1),
  ])("falls back to the default for invalid value %s", (value) => {
    process.env.VALIDATION_PLUGIN_TIMEOUT_MS = value;

    expect(getValidationPluginTimeoutMs()).toBe(
      VALIDATION_PLUGIN_TIMEOUT_DEFAULT_MS,
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("VALIDATION_PLUGIN_TIMEOUT_MS"),
    );
  });
});
