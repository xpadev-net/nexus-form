import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  getSnapshotByVersion: vi.fn(),
  parseValidationRuleSnapshot: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
}));

vi.mock("@nexus-form/database/schema", () => ({
  externalServiceValidationResult: {
    createdAt: "externalServiceValidationResult.createdAt",
    responseId: "externalServiceValidationResult.responseId",
    ruleId: "externalServiceValidationResult.ruleId",
  },
  form: {
    id: "form.id",
    plateContent: "form.plateContent",
  },
  formResponse: {
    formId: "formResponse.formId",
    id: "formResponse.id",
  },
  formValidationRule: {
    id: "formValidationRule.id",
    orderIndex: "formValidationRule.orderIndex",
  },
}));

vi.mock("@nexus-form/shared", () => ({
  extractQuestionsFromPlateContent: vi.fn(
    (
      blocks: Array<{ blockId?: string; children?: Array<{ text?: string }> }>,
    ) =>
      blocks.map((block) => ({
        blockId: block.blockId,
        title: block.children?.[0]?.text ?? block.blockId,
      })),
  ),
  parseValidationOutputValuesFromMetadata: vi.fn((metadata: unknown) => {
    if (typeof metadata !== "object" || metadata === null) return [];
    const outputValues = (
      metadata as { validationOutputs?: Array<Record<string, unknown>> }
    ).validationOutputs;
    return Array.isArray(outputValues) ? outputValues : [];
  }),
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((value: unknown) => ({ type: "desc", value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
}));

vi.mock("../snapshot-repository", () => ({
  getSnapshotByVersion: mocks.getSnapshotByVersion,
}));

vi.mock("../validation-rule-repository", () => ({
  parseValidationRuleSnapshot: mocks.parseValidationRuleSnapshot,
}));

function useSelectResults(results: unknown[][]): void {
  let index = 0;
  const next = () => Promise.resolve(results[index++] ?? []);
  mocks.db.select.mockImplementation(() => ({
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(next),
        })),
      })),
      where: vi.fn(() => ({
        limit: vi.fn(next),
      })),
    })),
  }));
}

describe("getExternalValidationResults", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns snapshot-backed validation results after the live rule is deleted", async () => {
    useSelectResults([
      [{ formId: "form-1" }],
      [
        {
          result: {
            id: "result-1",
            responseId: "response-1",
            ruleId: "rule-deleted",
            referencedBlockId: "block-1",
            snapshotVersion: 7,
            service: "discord",
            status: "PENDING",
            success: null,
            attemptCount: 0,
            lastAttemptAt: null,
            nextRetryAt: null,
            metadata: null,
            errorCode: null,
            errorMessage: null,
            jobId: null,
            createdAt: new Date("2026-05-24T00:00:00.000Z"),
            updatedAt: new Date("2026-05-24T00:01:00.000Z"),
          },
          rule: null,
        },
      ],
      [{ plateContent: "[]" }],
    ]);
    mocks.getSnapshotByVersion.mockResolvedValue({
      plateContent: JSON.stringify([
        {
          type: "form_short_text",
          blockId: "block-1",
          children: [{ text: "Discord handle" }],
        },
      ]),
      validationRulesJson: "snapshot-rules",
      structureJson: JSON.stringify({
        version: 1,
        settings: { allow_edit_responses: false },
      }),
    });
    mocks.parseValidationRuleSnapshot.mockReturnValue([
      {
        id: "rule-deleted",
        name: "Published Discord membership",
        providerName: "discord",
        ruleType: "guild_member",
        referencedBlockIds: ["block-1"],
        configJson: { guildId: "guild-1" },
        orderIndex: 0,
      },
    ]);

    const { getExternalValidationResults } = await import(
      "../validation-results"
    );

    await expect(getExternalValidationResults("response-1")).resolves.toEqual([
      expect.objectContaining({
        id: "result-1",
        rule_id: "rule-deleted",
        rule_name: "Published Discord membership",
        provider_name: "discord",
        rule_type: "guild_member",
        referenced_block_label: "Discord handle",
        referenced_block_missing: false,
        service: "discord",
        status: "PENDING",
        output_values: [],
      }),
    ]);
  });

  it("returns validation output values parsed from result metadata", async () => {
    useSelectResults([
      [{ formId: "form-1" }],
      [
        {
          result: {
            id: "result-1",
            responseId: "response-1",
            ruleId: "rule-1",
            referencedBlockId: "block-1",
            snapshotVersion: null,
            service: "github",
            status: "COMPLETED",
            success: true,
            attemptCount: 1,
            lastAttemptAt: null,
            nextRetryAt: null,
            metadata: {
              validationOutputs: [
                { key: "username", label: "Username", value: "octocat" },
                { key: "followers", value: 42 },
              ],
              legacy: "kept",
            },
            errorCode: null,
            errorMessage: null,
            jobId: null,
            createdAt: new Date("2026-05-24T00:00:00.000Z"),
            updatedAt: new Date("2026-05-24T00:01:00.000Z"),
          },
          rule: {
            id: "rule-1",
            name: "GitHub user",
            providerName: "github",
            ruleType: "user_exists",
            orderIndex: 0,
          },
        },
      ],
      [{ plateContent: "[]" }],
    ]);

    const { getExternalValidationResults } = await import(
      "../validation-results"
    );

    await expect(getExternalValidationResults("response-1")).resolves.toEqual([
      expect.objectContaining({
        id: "result-1",
        output_values: [
          { key: "username", label: "Username", value: "octocat" },
          { key: "followers", value: 42 },
        ],
      }),
    ]);
  });
});
