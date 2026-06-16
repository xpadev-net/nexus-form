import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@nexus-form/database", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn() })) })),
    })),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
  externalServiceValidationResult: {},
  formValidationRule: {},
  formValidationRuleBlock: {},
}));

vi.mock("@nexus-form/integrations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@nexus-form/integrations")>();
  return {
    ...actual,
    providerRegistry: {
      get: vi.fn(),
    },
  };
});

import { db } from "@nexus-form/database";
import { providerRegistry } from "@nexus-form/integrations";
import {
  getValidationRule,
  listValidationRules,
  parseValidationRuleSnapshot,
  updateValidationRule,
  ValidationRuleConfigError,
  validateProviderRuleConfig,
} from "../validation-rule-repository";

const mockRegistryGet = vi.mocked(providerRegistry.get);
const mockDbSelect = vi.mocked(db.select);

function makePaginatedQuery(result: unknown[]) {
  return {
    offset: vi.fn(() => ({
      limit: vi.fn(() => Promise.resolve(result)),
    })),
    limit: vi.fn(() => Promise.resolve(result)),
  };
}

function mockSelectResults(resultSets: unknown[][]): void {
  let callIndex = 0;
  mockDbSelect.mockImplementation(
    () =>
      ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            const selectIndex = callIndex;
            const result = resultSets[callIndex] ?? [];
            callIndex += 1;
            return {
              orderBy: vi.fn(() =>
                selectIndex === 0 && resultSets.length > 1
                  ? makePaginatedQuery(result)
                  : Promise.resolve(result),
              ),
              limit: vi.fn(() => Promise.resolve(result)),
            };
          }),
        })),
      }) as unknown as ReturnType<typeof db.select>,
  );
}

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    name: "Test Rule",
    providerName: "discord",
    ruleType: "guild_member",
    referencedBlockIds: ["block-1"],
    configJson: { guildId: "123456789012345678" },
    orderIndex: 0,
    ...overrides,
  };
}

function makeRuleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    formId: "form-1",
    name: "Test Rule",
    providerName: "discord",
    ruleType: "guild_member",
    configJson: { guildId: "123456789012345678" },
    orderIndex: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeRuleBlockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-block-1",
    ruleId: "rule-1",
    referencedBlockId: "block-1",
    orderIndex: 0,
    ...overrides,
  };
}

describe("parseValidationRuleSnapshot", () => {
  it("nullに対して空配列を返す", () => {
    expect(parseValidationRuleSnapshot(null)).toEqual([]);
  });

  it("undefinedに対して空配列を返す", () => {
    expect(parseValidationRuleSnapshot(undefined)).toEqual([]);
  });

  it("空文字列に対して空配列を返す", () => {
    expect(parseValidationRuleSnapshot("")).toEqual([]);
  });

  it("不正なJSONに対して空配列を返す", () => {
    expect(parseValidationRuleSnapshot("{invalid json")).toEqual([]);
  });

  it("正常なスナップショットをパースする", () => {
    const entry = makeEntry();
    const result = parseValidationRuleSnapshot(JSON.stringify([entry]));
    expect(result).toEqual([entry]);
  });

  it("複数エントリをパースする", () => {
    const entries = [makeEntry(), makeEntry({ id: "rule-2", orderIndex: 1 })];
    const result = parseValidationRuleSnapshot(JSON.stringify(entries));
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("rule-1");
    expect(result[1]?.id).toBe("rule-2");
  });

  it("必須フィールドが欠落している場合は空配列を返す", () => {
    const invalid = [{ id: "rule-1" }];
    expect(parseValidationRuleSnapshot(JSON.stringify(invalid))).toEqual([]);
  });

  it("orderIndexが負の値の場合は空配列を返す", () => {
    const invalid = [makeEntry({ orderIndex: -1 })];
    expect(parseValidationRuleSnapshot(JSON.stringify(invalid))).toEqual([]);
  });

  it("orderIndexが非整数の場合は空配列を返す", () => {
    const invalid = [makeEntry({ orderIndex: 1.5 })];
    expect(parseValidationRuleSnapshot(JSON.stringify(invalid))).toEqual([]);
  });

  it("配列でないJSONに対して空配列を返す", () => {
    expect(parseValidationRuleSnapshot(JSON.stringify({ foo: "bar" }))).toEqual(
      [],
    );
  });

  it("空配列のJSONに対して空配列を返す", () => {
    expect(parseValidationRuleSnapshot("[]")).toEqual([]);
  });

  it("referencedBlockIdsが空配列のエントリをパースする", () => {
    const entry = makeEntry({ referencedBlockIds: [] });
    const result = parseValidationRuleSnapshot(JSON.stringify([entry]));
    expect(result).toEqual([entry]);
  });
});

describe("validateProviderRuleConfig", () => {
  const fakeConfigSchema = {
    safeParse: vi.fn(),
  };

  const fakeRule = {
    name: "guild_member",
    configSchema: fakeConfigSchema,
  };

  const fakeProvider = {
    name: "discord",
    rules: { guild_member: fakeRule },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("プロバイダーが登録されていない場合にValidationRuleConfigErrorをスローする", () => {
    mockRegistryGet.mockReturnValue(undefined);

    expect(() =>
      validateProviderRuleConfig({
        providerName: "unknown",
        ruleType: "guild_member",
        configJson: {},
      }),
    ).toThrow(ValidationRuleConfigError);
  });

  it("ルールタイプが未登録の場合にValidationRuleConfigErrorをスローする", () => {
    mockRegistryGet.mockReturnValue({
      ...fakeProvider,
      rules: {},
    } as unknown as ReturnType<typeof mockRegistryGet>);

    expect(() =>
      validateProviderRuleConfig({
        providerName: "discord",
        ruleType: "nonexistent",
        configJson: {},
      }),
    ).toThrow(ValidationRuleConfigError);
  });

  it("設定スキーマが無効な場合にValidationRuleConfigErrorをスローする", () => {
    fakeConfigSchema.safeParse.mockReturnValue({
      success: false,
      error: {
        issues: [{ path: ["guildId"], message: "Required" }],
      },
    });
    mockRegistryGet.mockReturnValue(
      fakeProvider as unknown as ReturnType<typeof mockRegistryGet>,
    );

    expect(() =>
      validateProviderRuleConfig({
        providerName: "discord",
        ruleType: "guild_member",
        configJson: {},
      }),
    ).toThrow(ValidationRuleConfigError);
  });

  it("有効な設定をパースしてサニタイズ済みの値を返す", () => {
    const sanitized = { guildId: "123456789012345678" };
    fakeConfigSchema.safeParse.mockReturnValue({
      success: true,
      data: sanitized,
    });
    mockRegistryGet.mockReturnValue(
      fakeProvider as unknown as ReturnType<typeof mockRegistryGet>,
    );

    const result = validateProviderRuleConfig({
      providerName: "discord",
      ruleType: "guild_member",
      configJson: { guildId: "123456789012345678", extra: "field" },
    });

    expect(result).toEqual(sanitized);
  });
});

describe("validation rule read mapping", () => {
  const strictConfigSchema = z.object({
    guildId: z.string().regex(/^\d{17,20}$/),
  });
  const fakeProvider = {
    name: "discord",
    rules: {
      guild_member: {
        name: "guild_member",
        configSchema: strictConfigSchema,
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistryGet.mockReturnValue(
      fakeProvider as unknown as ReturnType<typeof mockRegistryGet>,
    );
  });

  it("listValidationRulesはDB読み出し境界でprovider configSchemaを再検証する", async () => {
    mockSelectResults([
      [
        makeRuleRow({
          configJson: {
            guildId: "123456789012345678",
            extra: "dropped",
          },
        }),
      ],
      [makeRuleBlockRow()],
    ]);

    await expect(
      listValidationRules("form-1", { limit: 20, offset: 0 }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "rule-1",
        configJson: { guildId: "123456789012345678" },
      }),
    ]);
  });

  it("listValidationRulesは壊れたconfigJsonを空objectに置き換えずValidationRuleConfigErrorを投げる", async () => {
    mockSelectResults([
      [makeRuleRow({ configJson: { guildId: "not-a-snowflake" } })],
      [makeRuleBlockRow()],
    ]);

    await expect(
      listValidationRules("form-1", { limit: 20, offset: 0 }),
    ).rejects.toThrow(ValidationRuleConfigError);
  });

  it("getValidationRuleはDB読み出し境界でprovider configSchemaを再検証する", async () => {
    mockSelectResults([
      [makeRuleRow({ configJson: { guildId: "not-a-snowflake" } })],
      [makeRuleBlockRow()],
    ]);

    await expect(getValidationRule("form-1", "rule-1")).rejects.toThrow(
      ValidationRuleConfigError,
    );
  });

  it("updateValidationRuleは既存configJsonを再利用する場合もprovider configSchemaで検証する", async () => {
    mockSelectResults([
      [makeRuleRow({ configJson: { guildId: "not-a-snowflake" } })],
      [makeRuleBlockRow()],
    ]);

    await expect(
      updateValidationRule({
        formId: "form-1",
        ruleId: "rule-1",
        payload: { name: "Updated Rule" },
      }),
    ).rejects.toThrow(ValidationRuleConfigError);
  });
});
