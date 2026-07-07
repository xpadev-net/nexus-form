import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFormStructure: vi.fn(),
  listValidationRules: vi.fn(),
  resultRows: [] as Array<Record<string, unknown>>,
  select: vi.fn(),
}));

vi.mock("../form-structure-service", () => ({
  getFormStructure: mocks.getFormStructure,
}));

vi.mock("../validation-rule-repository", () => ({
  listValidationRules: mocks.listValidationRules,
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((value: unknown) => ({ desc: value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock("@nexus-form/database/schema", () => ({
  externalServiceValidationResult: {
    createdAt: "externalServiceValidationResult.createdAt",
    metadata: "externalServiceValidationResult.metadata",
    responseId: "externalServiceValidationResult.responseId",
    ruleId: "externalServiceValidationResult.ruleId",
    service: "externalServiceValidationResult.service",
  },
  formResponse: {
    id: "formResponse.id",
    formId: "formResponse.formId",
  },
  formValidationRule: {
    id: "formValidationRule.id",
    name: "formValidationRule.name",
    providerName: "formValidationRule.providerName",
    ruleType: "formValidationRule.ruleType",
  },
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: mocks.select,
  },
}));

function createQuery() {
  const query = {
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    leftJoin: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(async () => mocks.resultRows),
  };
  return query;
}

describe("getValidationOutputExportSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resultRows = [];
    mocks.select.mockImplementation(() => createQuery());
    mocks.getFormStructure.mockResolvedValue({
      settings: {},
    });
    mocks.listValidationRules.mockResolvedValue([
      {
        id: "rule-1",
        name: "GitHub account",
        providerName: "github",
        ruleType: "user_exists",
      },
    ]);
  });

  it("returns built-in output values enabled by default", async () => {
    const { getValidationOutputExportSettings } = await import(
      "../validation-output-export-settings"
    );

    const result = await getValidationOutputExportSettings("form-1");

    expect(result.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: "rule-1",
          rule_name: "GitHub account",
          provider_name: "github",
          rule_type: "user_exists",
          output_key: "username",
          label: "GitHub username",
          enabled: true,
          source: "builtin",
        }),
        expect.objectContaining({
          output_key: "followers",
          enabled: true,
          source: "builtin",
        }),
      ]),
    );
    const query = mocks.select.mock.results[0]?.value;
    expect(query.orderBy).toHaveBeenCalledWith({
      desc: "externalServiceValidationResult.createdAt",
    });
    expect(query.limit).toHaveBeenCalledWith(500);
  });

  it("applies saved toggles and preserves saved historical keys", async () => {
    mocks.getFormStructure.mockResolvedValue({
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
              rule_id: "deleted-rule",
              provider_name: "unknown",
              rule_type: "unknown",
              output_key: "legacy_score",
              enabled: false,
            },
          ],
        },
      },
    });
    mocks.resultRows = [
      {
        metadata: {
          validationOutputs: [
            { key: "legacy_score", label: "Legacy Score", value: 88 },
          ],
        },
        ruleId: "deleted-rule",
        service: null,
        ruleName: null,
        providerName: null,
        ruleType: null,
      },
    ];
    const { getValidationOutputExportSettings } = await import(
      "../validation-output-export-settings"
    );

    const result = await getValidationOutputExportSettings("form-1");

    expect(result.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: "rule-1",
          output_key: "username",
          enabled: false,
          source: "builtin",
        }),
        expect.objectContaining({
          rule_id: "deleted-rule",
          provider_name: "unknown",
          rule_type: "unknown",
          output_key: "legacy_score",
          label: "Legacy Score",
          enabled: false,
          source: "result",
        }),
      ]),
    );
  });
});
