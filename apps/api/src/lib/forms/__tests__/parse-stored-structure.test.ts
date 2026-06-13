import { describe, expect, it } from "vitest";
import { parseStoredStructure } from "../parse-stored-structure";

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
