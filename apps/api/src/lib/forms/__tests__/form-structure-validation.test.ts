import { describe, expect, it } from "vitest";
import { FormStructure } from "../../../types/domain/form";
import { StoredLogicRuleSchema } from "../../../types/validation/form";
import { parseStoredStructure } from "../parse-stored-structure";
import { generateStructureDiff } from "../structure-diff";

describe("StoredLogicRuleSchema", () => {
  const validCondition = { field: "q1", operator: "equals" };
  const validAction = { type: "show" };

  it("フロントエンドの実際のペイロードを受け入れる", () => {
    const frontendRule = {
      id: "rule-1",
      sourceBlockId: "block-abc",
      condition: {
        field: "email",
        operator: "contains",
        value: "@example.com",
      },
      action: { type: "show", targetBlockId: "block-xyz" },
      priority: 1,
      isActive: true,
    };
    const result = StoredLogicRuleSchema.safeParse(frontendRule);
    expect(result.success).toBe(true);
  });

  it("id が欠けている場合は拒否する", () => {
    const invalid = {
      sourceBlockId: "block-abc",
      condition: validCondition,
      action: validAction,
      priority: 1,
      isActive: true,
    };
    const result = StoredLogicRuleSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("sourceBlockId が欠けている場合は拒否する", () => {
    const invalid = {
      id: "rule-1",
      condition: validCondition,
      action: validAction,
      priority: 1,
      isActive: true,
    };
    const result = StoredLogicRuleSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("priority が数値でない場合は拒否する", () => {
    const invalid = {
      id: "rule-1",
      sourceBlockId: "block-abc",
      condition: validCondition,
      action: validAction,
      priority: "high",
      isActive: true,
    };
    const result = StoredLogicRuleSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("isActive が真偽値でない場合は拒否する", () => {
    const invalid = {
      id: "rule-1",
      sourceBlockId: "block-abc",
      condition: validCondition,
      action: validAction,
      priority: 1,
      isActive: "yes",
    };
    const result = StoredLogicRuleSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("priority が小数の場合は拒否する", () => {
    const invalid = {
      id: "rule-1",
      sourceBlockId: "block-abc",
      condition: validCondition,
      action: validAction,
      priority: 1.5,
      isActive: true,
    };
    const result = StoredLogicRuleSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("priority が 0 の場合は受け入れる（境界値）", () => {
    const valid = {
      id: "rule-1",
      sourceBlockId: "block-abc",
      condition: { field: "q1", operator: "equals", value: "yes" },
      action: { type: "show", targetBlockId: "block-xyz" },
      priority: 0,
      isActive: true,
    };
    const result = StoredLogicRuleSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("priority が負の場合は拒否する", () => {
    const invalid = {
      id: "rule-1",
      sourceBlockId: "block-abc",
      condition: validCondition,
      action: validAction,
      priority: -1,
      isActive: true,
    };
    const result = StoredLogicRuleSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("condition に未知キーがある場合は拒否する", () => {
    const invalid = {
      id: "rule-1",
      sourceBlockId: "block-abc",
      condition: { field: "q1", operator: "equals", extraKey: true },
      action: validAction,
      priority: 1,
      isActive: true,
    };
    const result = StoredLogicRuleSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("condition.field が空文字の場合は拒否する", () => {
    const invalid = {
      id: "rule-1",
      sourceBlockId: "block-abc",
      condition: { field: "", operator: "equals" },
      action: validAction,
      priority: 1,
      isActive: true,
    };
    const result = StoredLogicRuleSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("action.type が欠けている場合は拒否する", () => {
    const invalid = {
      id: "rule-1",
      sourceBlockId: "block-abc",
      condition: validCondition,
      action: {},
      priority: 1,
      isActive: true,
    };
    const result = StoredLogicRuleSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("FormStructure schema", () => {
  const validSettings = {
    allow_edit_responses: false,
  };

  it("最小限の有効な構造を受け入れる", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
    });
    expect(result.success).toBe(true);
  });

  it("settings がない場合は拒否する", () => {
    const result = FormStructure.safeParse({ version: 1 });
    expect(result.success).toBe(false);
  });

  it("version が 0 以下の場合は拒否する", () => {
    const result = FormStructure.safeParse({
      version: 0,
      settings: validSettings,
    });
    expect(result.success).toBe(false);
  });

  it("フロントエンド形式の logic ルールを含む完全なペイロードを受け入れる", () => {
    const result = FormStructure.safeParse({
      version: 3,
      settings: validSettings,
      logic: [
        {
          id: "rule-1",
          sourceBlockId: "block-1",
          condition: { field: "q1", operator: "equals", value: "yes" },
          action: { type: "show", targetBlockId: "block-2" },
          priority: 0,
          isActive: true,
        },
      ],
      confirmation: {
        title: "ありがとう",
        message: "回答を受け付けました",
      },
    });
    expect(result.success).toBe(true);
  });

  it("StoredLogicRule 形式でない logic ルールは拒否する", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      logic: [
        {
          id: "rule-1",
          name: "テストルール",
          conditions: [{ question_id: "q1", operator: "equals", value: "yes" }],
          condition_match: "all",
          action: { type: "next" },
          stop_on_match: false,
          enabled: true,
          priority: 0,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("Discord 通知が有効で webhook_url がない場合は拒否する", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      notifications: {
        on_submit: {
          discord: {
            enabled: true,
          },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("Webhook 通知が有効で url がない場合は拒否する", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      notifications: {
        on_submit: {
          webhook: { enabled: true },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("Webhook 通知が有効で有効な url がある場合は受け入れる", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      notifications: {
        on_submit: {
          webhook: {
            enabled: true,
            url: "https://zapier.com/hooks/catch/test",
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("Webhook 通知が無効の場合は url なしでも受け入れる", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      notifications: {
        on_submit: {
          webhook: { enabled: false },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("メール通知が有効で recipients が空の場合を拒否する", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      notifications: {
        on_submit: {
          email: {
            enabled: true,
            recipients: [],
          },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("メール通知が有効で recipients がある場合を受け入れる", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      notifications: {
        on_submit: {
          email: {
            enabled: true,
            recipients: ["test@example.com"],
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("メール通知が無効の場合は recipients が空でも受け入れる", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      notifications: {
        on_submit: {
          email: {
            enabled: false,
            recipients: [],
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("Discord 通知が無効の場合は webhook_url なしでも受け入れる", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      notifications: {
        on_submit: {
          discord: {
            enabled: false,
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("無効な notification Discord URL を拒否する", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      notifications: {
        on_submit: {
          discord: {
            enabled: true,
            webhook_url: "https://evil.com/webhook",
          },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("有効な Discord webhook URL を受け入れる", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      notifications: {
        on_submit: {
          discord: {
            enabled: true,
            webhook_url: "https://discord.com/api/webhooks/123/abc",
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("PTB サブドメインの Discord webhook URL を受け入れる", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      notifications: {
        on_submit: {
          discord: {
            enabled: true,
            webhook_url: "https://ptb.discord.com/api/webhooks/123/abc",
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("Canary サブドメインの Discord webhook URL を受け入れる", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      notifications: {
        on_submit: {
          discord: {
            enabled: true,
            webhook_url: "https://canary.discord.com/api/webhooks/123/abc",
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("discord.com だがパスが /api/webhooks/ でない URL を拒否する", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      notifications: {
        on_submit: {
          discord: {
            enabled: true,
            webhook_url: "https://discord.com/arbitrary/path",
          },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("汎用 webhook で discord.com の不正パスを拒否する", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      notifications: {
        on_submit: {
          webhook: {
            enabled: true,
            url: "https://discord.com/arbitrary/path",
          },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("汎用 webhook で discord.com の /api/webhooks/ パスを受け入れる", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      notifications: {
        on_submit: {
          webhook: {
            enabled: true,
            url: "https://discord.com/api/webhooks/123/abc",
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("有効な appearance を受け入れる", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      appearance: {
        theme: {
          primary_color: "#ff0000",
          accent_color: "#00ff00",
          background_color: "#ffffff",
          font_family: "Inter",
        },
        layout: {
          width: "medium",
          alignment: "center",
          show_progress_bar: true,
          progress_position: "top",
          show_question_numbers: true,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("無効な HEX カラーコードを拒否する", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      appearance: {
        theme: {
          primary_color: "red",
          accent_color: "#00ff00",
          background_color: "#ffffff",
          font_family: "Inter",
        },
        layout: {
          width: "medium",
          alignment: "center",
          show_progress_bar: true,
          progress_position: "top",
          show_question_numbers: true,
        },
      },
    });
    expect(result.success).toBe(false);
  });

  // appearance テストでは brandConfig 由来の値（primary_color, accent_color）を
  // 直接アサートせず、スキーマ定義のデフォルト値（font_family, background_color 等）
  // または明示的に渡した値のみを検証する。
  it("appearance が空オブジェクトの場合はデフォルト値で補完する", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      appearance: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // theme / layout が存在しスキーマデフォルトが適用されることを確認
      expect(result.data.appearance?.theme).toBeDefined();
      expect(result.data.appearance?.theme.font_family).toBe("Inter");
      expect(result.data.appearance?.theme.background_color).toBe("#ffffff");
      expect(result.data.appearance?.layout).toBeDefined();
      expect(result.data.appearance?.layout.width).toBe("medium");
    }
  });

  it("appearance に theme のみある場合はデフォルト layout で補完する", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      appearance: { theme: { primary_color: "#ff0000" } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // 明示的に渡した値はそのまま保持される
      expect(result.data.appearance?.theme.primary_color).toBe("#ff0000");
      // スキーマデフォルト値が補完される（brandConfig 非依存の値のみアサート）
      expect(result.data.appearance?.theme.background_color).toBe("#ffffff");
      expect(result.data.appearance?.theme.font_family).toBe("Inter");
      // brandConfig 由来の accent_color は存在のみ確認（値は環境依存）
      expect(result.data.appearance?.theme.accent_color).toBeDefined();
      expect(result.data.appearance?.layout).toBeDefined();
    }
  });

  it("appearance に layout のみある場合はデフォルト theme で補完する", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      appearance: { layout: { width: "compact" } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // brandConfig 由来のテーマが補完されることを存在のみで確認
      expect(result.data.appearance?.theme).toBeDefined();
      expect(result.data.appearance?.layout.width).toBe("compact");
    }
  });

  it("パスワード保護が有効でパスワードがない場合は拒否する", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      access_control: {
        password_protection: {
          enabled: true,
          password_hint: "ヒント",
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("パスワード保護が無効の場合はパスワードなしで受け入れる", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      access_control: {
        password_protection: {
          enabled: false,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("logic 配列が空の場合も受け入れる", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      logic: [],
    });
    expect(result.success).toBe(true);
  });

  it("無効な logic ルール (必須フィールド欠落) を拒否する", () => {
    const result = FormStructure.safeParse({
      version: 1,
      settings: validSettings,
      logic: [{ id: "rule-1" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("generateStructureDiff", () => {
  it("同一オブジェクトの場合は空の変更リストを返す", () => {
    const obj = { settings: { a: 1 }, logic: [] };
    const changes = generateStructureDiff(obj, obj);
    expect(changes).toEqual([]);
  });

  it("追加されたキーを検出する", () => {
    const from = { settings: { a: 1 } };
    const to = { settings: { a: 1 }, logic: [{ id: "r1" }] };
    const changes = generateStructureDiff(from, to);
    expect(changes).toEqual([
      { type: "added", path: "logic", to: [{ id: "r1" }] },
    ]);
  });

  it("削除されたキーを検出する", () => {
    const from = { settings: { a: 1 }, logic: [] };
    const to = { settings: { a: 1 } };
    const changes = generateStructureDiff(from, to);
    expect(changes).toEqual([{ type: "removed", path: "logic", from: [] }]);
  });

  it("変更されたキーを検出する", () => {
    const from = { settings: { a: 1 }, version: 1 };
    const to = { settings: { a: 2 }, version: 1 };
    const changes = generateStructureDiff(from, to);
    expect(changes).toEqual([
      { type: "modified", path: "settings", from: { a: 1 }, to: { a: 2 } },
    ]);
  });

  it("追加・削除・変更を同時に検出する", () => {
    const from = { a: 1, b: 2 };
    const to = { b: 3, c: 4 };
    const changes = generateStructureDiff(from, to);
    const types = changes.map((c) => c.type).sort();
    expect(types).toEqual(["added", "modified", "removed"]);
    expect(changes.find((c) => c.path === "a")?.type).toBe("removed");
    expect(changes.find((c) => c.path === "b")?.type).toBe("modified");
    expect(changes.find((c) => c.path === "c")?.type).toBe("added");
  });

  it("ネストされたオブジェクトの変更を検出する", () => {
    const from = { nested: { deep: { value: 1 } } };
    const to = { nested: { deep: { value: 2 } } };
    const changes = generateStructureDiff(from, to);
    expect(changes).toEqual([
      {
        type: "modified",
        path: "nested",
        from: { deep: { value: 1 } },
        to: { deep: { value: 2 } },
      },
    ]);
  });

  it("両方とも空オブジェクトの場合は空の変更リストを返す", () => {
    const changes = generateStructureDiff({}, {});
    expect(changes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseStoredStructure
// ---------------------------------------------------------------------------
describe("parseStoredStructure", () => {
  it("正常な JSON を正しくパースする", () => {
    const json = JSON.stringify({
      version: 1,
      settings: { allow_edit_responses: false },
    });
    const result = parseStoredStructure(json);
    expect(result.version).toBe(1);
    expect(result.settings.allow_edit_responses).toBe(false);
  });

  it("余剰フィールドがあっても正常にパースする（strip される）", () => {
    const json = JSON.stringify({
      version: 1,
      settings: { allow_edit_responses: false },
      unknown_extra_field: "should be stripped",
    });
    const result = parseStoredStructure(json);
    expect(result.version).toBe(1);
    expect("unknown_extra_field" in result).toBe(false);
  });

  it("無効な JSON 文字列の場合にスローする", () => {
    expect(() => parseStoredStructure("not valid json")).toThrow(
      "invalid JSON",
    );
  });

  it("必須フィールドが欠落した場合にスローする", () => {
    expect(() => parseStoredStructure(JSON.stringify({}))).toThrow(
      "invalid structure in DB",
    );
  });
});
