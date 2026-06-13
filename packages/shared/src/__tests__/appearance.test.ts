import { describe, expect, it } from "vitest";
import {
  createFormAppearanceSchema,
  FormAppearanceImageUrlSchema,
  isSafeFormAppearanceImageUrl,
} from "../validation/appearance";

const schema = createFormAppearanceSchema({
  primaryColor: "#2563eb",
  accentColor: "#16a34a",
});

describe("FormAppearance image URLs", () => {
  it.each([
    "https://cdn.example.com/logo.png",
    "http://localhost/logo.png",
  ])("accepts http(s) image URL %s", (url) => {
    expect(FormAppearanceImageUrlSchema.safeParse(url).success).toBe(true);
    expect(
      schema.safeParse({
        theme: {
          logo_url: url,
          cover_image_url: url,
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    "data:image/svg+xml,<svg></svg>",
    "javascript:alert(1)",
    "ftp://cdn.example.com/logo.png",
  ])("rejects non-http(s) image URL %s", (url) => {
    expect(isSafeFormAppearanceImageUrl(url)).toBe(false);
    expect(FormAppearanceImageUrlSchema.safeParse(url).success).toBe(false);
    expect(
      schema.safeParse({
        theme: {
          logo_url: url,
        },
      }).success,
    ).toBe(false);
  });

  it("keeps empty appearance defaults valid", () => {
    const result = schema.safeParse({});

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.theme.logo_url).toBeUndefined();
    expect(result.data.theme.cover_image_url).toBeUndefined();
  });
});
