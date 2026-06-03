import { describe, expect, it } from "vitest";
import { buildPublicFormStructure } from "../public-structure";

describe("buildPublicFormStructure", () => {
  const fullStructure = {
    version: 2,
    settings: {
      allow_edit_responses: false,
      response_limit: { enabled: true, max_responses: 100 },
      privacy_notice: "We respect your privacy.",
      schedule: {
        publish_at: "2025-01-01T00:00:00Z",
        unpublish_at: "2025-12-31T23:59:59Z",
        timezone: "Asia/Tokyo",
      },
      autosave: { enabled: true, interval_seconds: 30 },
    },
    logic: [{ id: "rule-1", conditions: [], actions: [] }],
    appearance: { theme: { primary_color: "#000" }, layout: {} },
    confirmation: {
      title: "Thanks",
      message: "Submitted",
      show_response_id: false,
    },
    notifications: {
      on_submit: {
        email: { enabled: true, recipients: ["admin@example.com"] },
        webhook: {
          enabled: true,
          url: "https://webhook.site/abc",
          secret: "supersecret",
          headers: { Authorization: "Bearer token" },
        },
        discord: {
          enabled: true,
          webhook_url: "https://discord.com/api/webhooks/123/abc",
        },
      },
    },
    access_control: {
      require_authentication: true,
      allowed_domains: ["example.com"],
      allowed_roles: ["admin"],
      password_protection: {
        enabled: true,
        password: "$2b$10$hashedpassword",
        password_hint: "first pet",
      },
    },
  };

  it("includes whitelisted fields", () => {
    const result = buildPublicFormStructure(fullStructure);

    expect(result.version).toBe(2);
    expect(result.settings).toEqual({
      allow_edit_responses: false,
      response_limit: { enabled: true, max_responses: 100 },
      privacy_notice: "We respect your privacy.",
      schedule: {
        publish_at: "2025-01-01T00:00:00Z",
        unpublish_at: "2025-12-31T23:59:59Z",
        timezone: "Asia/Tokyo",
      },
      autosave: { enabled: true, interval_seconds: 30 },
    });
    expect(result.logic).toEqual(fullStructure.logic);
    expect(result.appearance).toEqual(fullStructure.appearance);
    expect(result.confirmation).toEqual(fullStructure.confirmation);
  });

  it("excludes notifications", () => {
    const result = buildPublicFormStructure(fullStructure);

    expect(result).not.toHaveProperty("notifications");
  });

  it("excludes access_control", () => {
    const result = buildPublicFormStructure(fullStructure);

    expect(result).not.toHaveProperty("access_control");
  });

  it("omits keys for undefined fields", () => {
    const minimal = { version: 1 };
    const result = buildPublicFormStructure(minimal);

    expect(result).toEqual({ version: 1 });
    expect(Object.keys(result)).toEqual(["version"]);
  });

  it("returns empty object when structure has no whitelisted fields", () => {
    const result = buildPublicFormStructure({
      notifications: { on_submit: {} },
      access_control: { require_authentication: false },
    });

    expect(result).toEqual({});
  });

  it("does not mutate the input structure", () => {
    const input = {
      version: 1,
      settings: { allow_edit_responses: true },
      notifications: { on_submit: {} },
      access_control: { require_authentication: false },
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    buildPublicFormStructure(input);

    expect(input).toEqual(snapshot);
  });

  it("does not share nested object references with input", () => {
    const input = {
      version: 1,
      settings: {
        allow_edit_responses: true,
        response_limit: { enabled: true, max_responses: 50 },
      },
      logic: [{ id: "rule-1", conditions: [] }],
      appearance: { theme: { primary_color: "#fff" } },
      confirmation: { title: "Thanks", message: "Done" },
    };
    const result = buildPublicFormStructure(input);

    // Mutating returned nested objects should not affect the input
    (result.settings as Record<string, unknown>).allow_edit_responses = false;
    (
      (result.settings as Record<string, unknown>).response_limit as Record<
        string,
        unknown
      >
    ).enabled = false;
    (result.logic as unknown[])[0] = { id: "mutated" };
    (result.appearance as Record<string, unknown>).theme = "mutated";
    (result.confirmation as Record<string, unknown>).title = "mutated";

    expect(
      (input.settings as Record<string, unknown>).allow_edit_responses,
    ).toBe(true);
    expect(
      (
        (input.settings as Record<string, unknown>).response_limit as Record<
          string,
          unknown
        >
      ).enabled,
    ).toBe(true);
    expect(input.logic[0]).toEqual({ id: "rule-1", conditions: [] });
    expect((input.appearance as Record<string, unknown>).theme).toEqual({
      primary_color: "#fff",
    });
    expect(input.confirmation).toEqual({ title: "Thanks", message: "Done" });
  });
});
