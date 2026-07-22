import type { ValidationProviderExecutionContext as RootValidationProviderExecutionContext } from "@nexus-form/integrations";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type ValidationProviderExecutionContext,
  type ValidationProviderRule,
  validationProviderResultSchema,
} from "../plugin-interface";

describe("validationProviderResultSchema", () => {
  it("accepts string output values", () => {
    expect(
      validationProviderResultSchema.parse({
        isValid: true,
        outputValues: [
          { key: "username", label: "Username", value: "octocat" },
          { key: "followers", value: "42" },
          { key: "verified", value: "true" },
        ],
      }),
    ).toEqual({
      isValid: true,
      outputValues: [
        { key: "username", label: "Username", value: "octocat" },
        { key: "followers", value: "42" },
        { key: "verified", value: "true" },
      ],
    });
  });

  it("keeps legacy provider results without output values valid", () => {
    expect(
      validationProviderResultSchema.parse({
        isValid: true,
        metadata: { legacy: true },
      }),
    ).toEqual({
      isValid: true,
      metadata: { legacy: true },
    });
  });

  it("rejects non-string output values and duplicate keys", () => {
    expect(() =>
      validationProviderResultSchema.parse({
        isValid: true,
        outputValues: [{ key: "followers", value: 42 }],
      }),
    ).toThrow();

    expect(() =>
      validationProviderResultSchema.parse({
        isValid: true,
        outputValues: [
          { key: "profile", value: { url: "https://example.com" } },
        ],
      }),
    ).toThrow();

    expect(() =>
      validationProviderResultSchema.parse({
        isValid: true,
        outputValues: [
          { key: "username", value: "octocat" },
          { key: "username", value: "duplicate" },
        ],
      }),
    ).toThrow();
  });
});

describe("ValidationProviderRule execution context", () => {
  const createRule = (
    validate: ValidationProviderRule["validate"],
  ): ValidationProviderRule => ({
    name: "default",
    label: "Default",
    description: "Default rule",
    inputHint: "Enter a value",
    inputSchema: z.string(),
    configSchema: z.record(z.string(), z.unknown()),
    metadataSchema: z.record(z.string(), z.unknown()),
    validate,
  });

  it("keeps legacy two-argument plugins callable", async () => {
    const rule = createRule(async (input, config) => ({
      isValid: input === "legacy" && Object.keys(config).length === 1,
    }));

    await expect(rule.validate("legacy", { mode: "legacy" })).resolves.toEqual({
      isValid: true,
    });
  });

  it("passes cancellation and deadline metadata to context-aware plugins", async () => {
    const controller = new AbortController();
    const context: ValidationProviderExecutionContext = {
      signal: controller.signal,
      deadlineAt: 1_750_000_000_000,
    };
    let receivedContext: ValidationProviderExecutionContext | undefined;
    const rule = createRule(async (_input, _config, executionContext) => {
      receivedContext = executionContext;
      return { isValid: executionContext?.signal === controller.signal };
    });

    await expect(rule.validate("context-aware", {}, context)).resolves.toEqual({
      isValid: true,
    });
    expect(receivedContext).toBe(context);
    expect(receivedContext?.deadlineAt).toBe(1_750_000_000_000);
  });

  it("exports the execution context from the package root", () => {
    const context: RootValidationProviderExecutionContext = {
      signal: new AbortController().signal,
      deadlineAt: 1_750_000_000_000,
    };

    expect(context.signal).toBeInstanceOf(AbortSignal);
    expect(context.deadlineAt).toBe(1_750_000_000_000);
  });
});
