import { describe, expect, it } from "vitest";
import {
  FormConfirmationSchema,
  SafeConfirmationUrlSchema,
} from "../validation/notifications";

describe("FormConfirmationSchema", () => {
  it("accepts http and https confirmation URLs", () => {
    expect(SafeConfirmationUrlSchema.parse("https://example.com/next")).toBe(
      "https://example.com/next",
    );
    expect(
      FormConfirmationSchema.parse({
        title: "Thanks",
        message: "Done",
        redirect_url: "http://example.com/done",
        supplemental_link: {
          label: "Guide",
          url: "https://example.com/guide",
        },
        contact: {
          label: "Support",
          url: "https://example.com/support",
        },
      }),
    ).toEqual(
      expect.objectContaining({
        redirect_url: "http://example.com/done",
        supplemental_link: {
          label: "Guide",
          url: "https://example.com/guide",
        },
        contact: {
          label: "Support",
          url: "https://example.com/support",
        },
      }),
    );
  });

  it("rejects unsafe confirmation URL schemes", () => {
    const unsafeUrls = [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "ftp://example.com/file",
    ];

    for (const unsafeUrl of unsafeUrls) {
      expect(() => SafeConfirmationUrlSchema.parse(unsafeUrl)).toThrow(
        /http:\/\/ または https:\/\//,
      );
      expect(() =>
        FormConfirmationSchema.parse({
          title: "Thanks",
          message: "Done",
          redirect_url: unsafeUrl,
        }),
      ).toThrow(/http:\/\/ または https:\/\//);
      expect(() =>
        FormConfirmationSchema.parse({
          title: "Thanks",
          message: "Done",
          supplemental_link: { label: "Guide", url: unsafeUrl },
        }),
      ).toThrow(/http:\/\/ または https:\/\//);
      expect(() =>
        FormConfirmationSchema.parse({
          title: "Thanks",
          message: "Done",
          contact: { label: "Support", url: unsafeUrl },
        }),
      ).toThrow(/http:\/\/ または https:\/\//);
    }
  });

  it("continues to accept contact email without a URL", () => {
    expect(
      FormConfirmationSchema.parse({
        title: "Thanks",
        message: "Done",
        contact: { label: "Support", email: "help@example.com" },
      }).contact,
    ).toEqual({ label: "Support", email: "help@example.com" });
  });
});
