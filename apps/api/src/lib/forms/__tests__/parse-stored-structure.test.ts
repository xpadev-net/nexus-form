import { beforeEach, describe, expect, it, vi } from "vitest";
import { logWarn } from "../../logger";
import { parseStoredStructure } from "../parse-stored-structure";

vi.mock("../../logger", () => ({
  logWarn: vi.fn(),
}));

const logWarnMock = vi.mocked(logWarn);

beforeEach(() => {
  logWarnMock.mockClear();
});

describe("R12-P2 legacy logic rule compatibility", () => {
  it("drops empty legacy logic rules instead of failing structure parse", () => {
    const structure = parseStoredStructure(
      JSON.stringify({
        version: 1,
        settings: {},
        logic: [
          {
            id: "legacy-empty",
            sourceBlockId: "block-1",
            condition: {},
            action: {},
            priority: 0,
            isActive: true,
          },
          {
            id: "valid-rule",
            sourceBlockId: "block-2",
            condition: { field: "q1", operator: "equals", value: "yes" },
            action: { type: "show", targetBlockId: "block-3" },
            priority: 1,
            isActive: true,
          },
        ],
      }),
    );

    expect(structure.logic).toHaveLength(1);
    expect(structure.logic?.[0]?.id).toBe("valid-rule");
  });
});

describe("legacy appearance image URL compatibility", () => {
  it("drops unsafe legacy appearance image URLs instead of failing structure parse", () => {
    const structure = parseStoredStructure(
      JSON.stringify({
        version: 1,
        settings: {},
        appearance: {
          theme: {
            primary_color: "#2563eb",
            accent_color: "#16a34a",
            background_color: "#ffffff",
            font_family: "Inter",
            brand_name: "Nexus",
            logo_url: "data:image/svg+xml,<svg></svg>",
            cover_image_url: "ftp://cdn.example.com/cover.jpg",
          },
          layout: {},
        },
      }),
    );

    expect(structure.appearance?.theme.brand_name).toBe("Nexus");
    expect(structure.appearance?.theme.logo_url).toBeUndefined();
    expect(structure.appearance?.theme.cover_image_url).toBeUndefined();
  });
});

describe("validation output export settings compatibility", () => {
  it("keeps valid validation output export entries when stored settings contain malformed entries", () => {
    const structure = parseStoredStructure(
      JSON.stringify({
        version: 1,
        settings: {
          validation_output_export: {
            values: [
              {
                rule_id: "rule-1",
                provider_name: "github",
                rule_type: "user_exists",
                output_key: "username",
                enabled: false,
              },
              {
                rule_id: "rule-1",
                provider_name: "github",
                rule_type: "user_exists",
                output_key: "bad-key",
                enabled: false,
              },
            ],
          },
        },
      }),
    );

    expect(structure.settings.validation_output_export).toEqual({
      values: [
        {
          rule_id: "rule-1",
          provider_name: "github",
          rule_type: "user_exists",
          output_key: "username",
          enabled: false,
        },
      ],
    });
    expect(logWarnMock).toHaveBeenCalledWith(
      "parseStoredStructure: normalized validation output export settings",
      "general",
    );
  });

  it("does not log normalization for valid validation output export settings", () => {
    const structure = parseStoredStructure(
      JSON.stringify({
        version: 1,
        settings: {
          validation_output_export: {
            values: [
              {
                rule_id: "rule-1",
                provider_name: "github",
                rule_type: "user_exists",
                output_key: "username",
                enabled: false,
              },
            ],
          },
        },
      }),
    );

    expect(structure.settings.validation_output_export).toEqual({
      values: [
        {
          rule_id: "rule-1",
          provider_name: "github",
          rule_type: "user_exists",
          output_key: "username",
          enabled: false,
        },
      ],
    });
    expect(logWarnMock).not.toHaveBeenCalledWith(
      "parseStoredStructure: normalized validation output export settings",
      "general",
    );
  });
});
