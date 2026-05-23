import { describe, expect, it } from "vitest";
import {
  parseSystemSettingValue,
  SYSTEM_SETTING_KEY,
  validateDynamicServicesMutationWrite,
  validateSystemSettingWrite,
} from "../system-settings";

describe("validateSystemSettingWrite", () => {
  it("rejects unknown keys with HTTP 400 semantics", () => {
    const result = validateSystemSettingWrite("services.unknown", {
      enabled: true,
    });

    expect(result).toEqual({
      success: false,
      status: 400,
      error: "Unknown system setting key",
    });
  });

  it("accepts services.dynamic entries", () => {
    const updatedAt = new Date().toISOString();
    const result = validateSystemSettingWrite(
      SYSTEM_SETTING_KEY.SERVICES_DYNAMIC,
      [
        {
          service: "discord",
          enabled: true,
          updatedAt,
        },
      ],
    );

    expect(result).toMatchObject({
      success: true,
      key: SYSTEM_SETTING_KEY.SERVICES_DYNAMIC,
      value: [{ service: "discord", enabled: true, updatedAt }],
    });
  });

  it("parses legacy dynamic rows beyond the write cap", () => {
    const entries = Array.from({ length: 65 }, (_, index) => ({
      service: `service-${index}`,
      enabled: true,
      updatedAt: new Date().toISOString(),
    }));

    const parsed = parseSystemSettingValue(
      SYSTEM_SETTING_KEY.SERVICES_DYNAMIC,
      entries,
      [],
    );

    expect(parsed).toHaveLength(65);
    expect(
      validateSystemSettingWrite(SYSTEM_SETTING_KEY.SERVICES_DYNAMIC, entries)
        .success,
    ).toBe(false);
  });

  it("rejects malformed services.config values", () => {
    const result = validateSystemSettingWrite(
      SYSTEM_SETTING_KEY.SERVICES_CONFIG,
      "not-an-object",
    );

    expect(result).toEqual({
      success: false,
      status: 400,
      error: "Invalid system setting value",
    });
  });
});

describe("validateDynamicServicesMutationWrite", () => {
  it("allows legacy updates that do not grow an over-cap list", () => {
    const entries = Array.from({ length: 65 }, (_, index) => ({
      service: `service-${index}`,
      enabled: true,
      updatedAt: new Date().toISOString(),
    }));

    const result = validateDynamicServicesMutationWrite(entries, 65);

    expect(result.success).toBe(true);
  });

  it("rejects growing an over-cap legacy list", () => {
    const entries = Array.from({ length: 66 }, (_, index) => ({
      service: `service-${index}`,
      enabled: true,
      updatedAt: new Date().toISOString(),
    }));

    const result = validateDynamicServicesMutationWrite(entries, 65);

    expect(result.success).toBe(false);
  });
});
