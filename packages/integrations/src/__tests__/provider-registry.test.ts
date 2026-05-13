import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ValidationProvider } from "../plugin-interface";
import { ValidationProviderRegistry } from "../provider-registry";

function makeProvider(name: string, ruleType = "default"): ValidationProvider {
  return {
    name,
    label: `Label for ${name}`,
    description: `Description for ${name}`,
    rules: {
      [ruleType]: {
        name: ruleType,
        label: `Rule ${ruleType}`,
        description: `Rule ${ruleType} description`,
        inputHint: "Enter value",
        inputSchema: z.string(),
        configSchema: z.object({}),
        metadataSchema: z.object({}),
        validate: async () => ({ isValid: true }),
      },
    },
  };
}

describe("ValidationProviderRegistry", () => {
  it("registers a provider and retrieves it by name", () => {
    const registry = new ValidationProviderRegistry();
    const provider = makeProvider("alpha");
    registry.register(provider);
    expect(registry.get("alpha")).toBe(provider);
  });

  it("returns undefined for unknown provider", () => {
    const registry = new ValidationProviderRegistry();
    expect(registry.get("unknown")).toBeUndefined();
  });

  it("throws when registering a duplicate name", () => {
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("alpha"));
    expect(() => registry.register(makeProvider("alpha"))).toThrow(
      "Provider alpha is already registered",
    );
  });

  it("throws for invalid provider names", () => {
    const registry = new ValidationProviderRegistry();
    expect(() => registry.register(makeProvider("1invalid"))).toThrow(
      "Invalid provider name",
    );
    expect(() => registry.register(makeProvider("My-Service"))).toThrow(
      "Invalid provider name",
    );
    expect(() => registry.register(makeProvider(""))).toThrow(
      "Invalid provider name",
    );
    expect(() => registry.register(makeProvider("a".repeat(65)))).toThrow(
      "Invalid provider name",
    );
  });

  it("accepts a provider name with exactly 64 characters", () => {
    const registry = new ValidationProviderRegistry();
    const name = "a".repeat(64);
    registry.register(makeProvider(name));
    expect(registry.has(name)).toBe(true);
  });

  it("accepts valid provider names with letters, digits and underscores", () => {
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("my_service"));
    registry.register(makeProvider("service2"));
    expect(registry.has("my_service")).toBe(true);
    expect(registry.has("service2")).toBe(true);
  });

  it("getAll returns all registered providers", () => {
    const registry = new ValidationProviderRegistry();
    const a = makeProvider("aaa");
    const b = makeProvider("bbb");
    registry.register(a);
    registry.register(b);
    expect(registry.getAll()).toEqual(expect.arrayContaining([a, b]));
    expect(registry.getAll()).toHaveLength(2);
  });

  it("getNames returns all registered names", () => {
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("alpha"));
    registry.register(makeProvider("beta"));
    expect(registry.getNames()).toEqual(
      expect.arrayContaining(["alpha", "beta"]),
    );
  });

  it("has returns correct boolean", () => {
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("alpha"));
    expect(registry.has("alpha")).toBe(true);
    expect(registry.has("beta")).toBe(false);
  });

  it("getRule resolves to a provider rule", () => {
    const registry = new ValidationProviderRegistry();
    const provider = makeProvider("alpha", "primary");
    registry.register(provider);
    expect(registry.getRule("alpha", "primary")).toBe(provider.rules.primary);
    expect(registry.getRule("alpha", "missing")).toBeUndefined();
    expect(registry.getRule("missing", "primary")).toBeUndefined();
  });
});
