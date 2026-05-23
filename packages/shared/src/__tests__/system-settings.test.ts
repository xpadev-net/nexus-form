import { describe, expect, it } from "vitest";
import {
  SYSTEM_SETTING_KEY,
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
    const result = validateSystemSettingWrite(
      SYSTEM_SETTING_KEY.SERVICES_DYNAMIC,
      [
        {
          service: "discord",
          enabled: true,
          updatedAt: new Date().toISOString(),
        },
      ],
    );

    expect(result.success).toBe(true);
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
