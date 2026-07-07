import { describe, expect, it } from "vitest";
import {
  getValidationResultId,
  mergeValidationOutputValuesIntoMetadata,
  parseValidationOutputExportSettings,
  parseValidationOutputValuesFromMetadata,
  VALIDATION_OUTPUT_METADATA_KEY,
  type ValidationOutputValue,
  validationOutputExportSettingsSchema,
  validationOutputValuesSchema,
  validationResultIdentitySchema,
} from "../validation-results";

describe("validationResultIdentitySchema", () => {
  it("requires nonempty identity fields", () => {
    expect(() =>
      validationResultIdentitySchema.parse({
        responseId: "response-1",
        ruleId: "",
        referencedBlockId: "question-1",
      }),
    ).toThrow();
  });
});

describe("getValidationResultId", () => {
  it("returns a stable id for the validation result unique key", () => {
    const params = {
      responseId: "response-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
    };

    expect(getValidationResultId(params)).toBe(getValidationResultId(params));
    expect(getValidationResultId(params)).toMatch(
      /^validation-result:[a-f0-9]{32}$/,
    );
    // Golden value for persisted validation result primary keys.
    expect(getValidationResultId(params)).toBe(
      "validation-result:d7210b09421b8eb30c7a872f2e5b666a",
    );
  });

  it("changes when any unique key component changes", () => {
    const base = {
      responseId: "response-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
    };

    expect(getValidationResultId(base)).not.toBe(
      getValidationResultId({ ...base, referencedBlockId: "question-2" }),
    );
  });
});

describe("validationOutputValuesSchema", () => {
  it("accepts any number of named scalar output values", () => {
    expect(
      validationOutputValuesSchema.parse([
        { key: "username", label: "Username", value: "octocat" },
        { key: "followers", value: 42 },
        { key: "verified", value: true },
        { key: "bio", value: null },
      ]),
    ).toEqual([
      { key: "username", label: "Username", value: "octocat" },
      { key: "followers", value: 42 },
      { key: "verified", value: true },
      { key: "bio", value: null },
    ]);
  });

  it("rejects duplicate keys and non-scalar values", () => {
    expect(() =>
      validationOutputValuesSchema.parse([
        { key: "username", value: "octocat" },
        { key: "username", value: "duplicate" },
      ]),
    ).toThrow();

    expect(() =>
      validationOutputValuesSchema.parse([
        { key: "profile", value: { url: "https://example.com" } },
      ]),
    ).toThrow();
  });
});

describe("validation output metadata helpers", () => {
  it("stores output values under a reserved metadata key without dropping legacy metadata", () => {
    const metadata = mergeValidationOutputValuesIntoMetadata(
      { providerField: "kept" },
      [
        { key: "username", label: "Username", value: "octocat" },
        { key: "followers", value: 42 },
      ],
    );

    expect(metadata).toEqual({
      providerField: "kept",
      [VALIDATION_OUTPUT_METADATA_KEY]: [
        { key: "username", label: "Username", value: "octocat" },
        { key: "followers", value: 42 },
      ],
    });
    expect(parseValidationOutputValuesFromMetadata(metadata)).toEqual([
      { key: "username", label: "Username", value: "octocat" },
      { key: "followers", value: 42 },
    ]);
  });

  it("treats legacy rows without output metadata as empty output values", () => {
    expect(parseValidationOutputValuesFromMetadata({ legacy: true })).toEqual(
      [],
    );
    expect(parseValidationOutputValuesFromMetadata(null)).toEqual([]);
  });

  it("keeps existing metadata if output values are malformed at a direct call site", () => {
    const metadata = { providerField: "kept" };
    const malformedOutputValues = [
      { key: "username", value: "octocat" },
      { key: "username", value: "duplicate" },
    ] as unknown as ValidationOutputValue[];

    expect(
      mergeValidationOutputValuesIntoMetadata(metadata, malformedOutputValues),
    ).toBe(metadata);
  });
});

describe("validation output export settings", () => {
  it("accepts independent settings per rule and output key", () => {
    const parsed = validationOutputExportSettingsSchema.parse({
      values: [
        {
          rule_id: "rule-1",
          provider_name: "github",
          rule_type: "user_exists",
          output_key: "username",
          enabled: true,
        },
        {
          rule_id: "rule-1",
          provider_name: "github",
          rule_type: "user_exists",
          output_key: "followers",
          enabled: false,
        },
        {
          rule_id: "rule-2",
          provider_name: "github",
          rule_type: "user_exists",
          output_key: "username",
          enabled: false,
        },
      ],
    });

    expect(parsed.values).toHaveLength(3);
  });

  it("rejects duplicate settings for the same rule and output key", () => {
    const result = validationOutputExportSettingsSchema.safeParse({
      values: [
        {
          rule_id: "rule-1",
          provider_name: "github",
          rule_type: "user_exists",
          output_key: "username",
          enabled: true,
        },
        {
          rule_id: "rule-1",
          provider_name: "github",
          rule_type: "user_exists",
          output_key: "username",
          enabled: false,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("falls back to default export settings for wholly invalid stored settings", () => {
    expect(parseValidationOutputExportSettings({ values: "invalid" })).toEqual({
      values: [],
    });
  });

  it("keeps valid stored settings when some entries are malformed", () => {
    expect(
      parseValidationOutputExportSettings({
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
          {
            rule_id: "rule-1",
            provider_name: "github",
            rule_type: "user_exists",
            output_key: "username",
            enabled: true,
          },
        ],
      }),
    ).toEqual({
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
  });
});
