import { randomUUID } from "node:crypto";
import { db } from "@nexus-form/database";
import {
  externalServiceValidationResult,
  formSnapshot,
  formValidationRule,
  formValidationRuleBlock,
} from "@nexus-form/database/schema";
import { providerRegistry } from "@nexus-form/integrations";
import { extractQuestionsFromPlateContent } from "@nexus-form/shared";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type {
  CreateFormValidationRule,
  FormValidationRule,
  UpdateFormValidationRule,
} from "../../types/domain/validation-rule";
import { getPlateBlocksForForm } from "./plate-blocks";

export class ValidationRuleNotFoundError extends Error {
  constructor(ruleId: string) {
    super(`Validation rule not found: ${ruleId}`);
    this.name = "ValidationRuleNotFoundError";
  }
}

export class ValidationRuleConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationRuleConfigError";
  }
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join(", ");
}

/**
 * provider / ruleType / configJson の妥当性をまとめて検証する。
 * providerRegistry に当該 (providerName, ruleType) が登録されていれば
 * rule.configSchema で configJson をパースして、サニタイズ後の値を返す。
 */
export function validateProviderRuleConfig(input: {
  providerName: string;
  ruleType: string;
  configJson: Record<string, unknown>;
}): Record<string, unknown> {
  const provider = providerRegistry.get(input.providerName);
  if (!provider) {
    throw new ValidationRuleConfigError(
      `Validation provider not registered: ${input.providerName}`,
    );
  }
  const rule = provider.rules[input.ruleType];
  if (!rule) {
    throw new ValidationRuleConfigError(
      `Provider ${input.providerName} does not expose rule: ${input.ruleType}`,
    );
  }
  const parsed = rule.configSchema.safeParse(input.configJson);
  if (!parsed.success) {
    throw new ValidationRuleConfigError(
      `Invalid ${input.providerName}.${input.ruleType} config: ${formatZodIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

/**
 * referencedBlockIds が当該フォームの有効な short_text ブロックの blockId
 * を参照していることを確認する。Missing / 別タイプ / 削除済みの場合は throw。
 *
 * ブロック一覧はアクティブスナップショット → 最新スナップショット → ドラフトの順で取得する。
 * ドラフトにのみ存在するブロックへの参照を誤って許可しないようスナップショットを基準とする。
 */
export async function assertReferencedBlocks(input: {
  formId: string;
  referencedBlockIds: readonly string[];
}): Promise<void> {
  if (input.referencedBlockIds.length === 0) {
    throw new ValidationRuleConfigError(
      "referencedBlockIds must contain at least one entry",
    );
  }
  const uniqueIds = [...new Set(input.referencedBlockIds)];
  if (uniqueIds.length !== input.referencedBlockIds.length) {
    throw new ValidationRuleConfigError(
      "referencedBlockIds must not contain duplicates",
    );
  }

  const snapshotRow =
    (await db.query.formSnapshot.findFirst({
      where: and(
        eq(formSnapshot.formId, input.formId),
        eq(formSnapshot.isActive, true),
      ),
      orderBy: [desc(formSnapshot.version)],
      columns: { plateContent: true },
    })) ??
    (await db.query.formSnapshot.findFirst({
      where: eq(formSnapshot.formId, input.formId),
      orderBy: [desc(formSnapshot.version)],
      columns: { plateContent: true },
    }));

  let blockMap: Map<string, { type: string }>;
  if (snapshotRow?.plateContent) {
    let content: unknown;
    try {
      content = JSON.parse(snapshotRow.plateContent);
    } catch {
      content = [];
    }
    const questions = Array.isArray(content)
      ? extractQuestionsFromPlateContent(content)
      : [];
    blockMap = new Map(questions.map((q) => [q.blockId, { type: q.type }]));
  } else {
    const plateBlocks = await getPlateBlocksForForm(input.formId);
    blockMap = new Map(plateBlocks.map((b) => [b.blockId, { type: b.type }]));
  }

  for (const blockId of uniqueIds) {
    const block = blockMap.get(blockId);
    if (!block) {
      throw new ValidationRuleConfigError(
        `Referenced block not found: ${blockId}`,
      );
    }
    if (block.type !== "short_text") {
      throw new ValidationRuleConfigError(
        `Referenced block must be short_text: ${blockId} (${block.type})`,
      );
    }
  }
}

interface RuleWithBlocks {
  rule: typeof formValidationRule.$inferSelect;
  ruleBlocks: Array<typeof formValidationRuleBlock.$inferSelect>;
}

async function loadRuleWithBlocks(
  ruleId: string,
): Promise<RuleWithBlocks | null> {
  const [rule] = await db
    .select()
    .from(formValidationRule)
    .where(eq(formValidationRule.id, ruleId))
    .limit(1);
  if (!rule) return null;
  const ruleBlocks = await db
    .select()
    .from(formValidationRuleBlock)
    .where(eq(formValidationRuleBlock.ruleId, ruleId))
    .orderBy(asc(formValidationRuleBlock.orderIndex));
  return { rule, ruleBlocks };
}

function toFormValidationRule(loaded: RuleWithBlocks): FormValidationRule {
  return {
    id: loaded.rule.id,
    formId: loaded.rule.formId,
    name: loaded.rule.name,
    providerName: loaded.rule.providerName,
    ruleType: loaded.rule.ruleType,
    referencedBlockIds: loaded.ruleBlocks.map((rb) => rb.referencedBlockId),
    configJson: loaded.rule.configJson as Record<string, unknown>,
    orderIndex: loaded.rule.orderIndex,
    createdAt: loaded.rule.createdAt,
    updatedAt: loaded.rule.updatedAt,
  };
}

export async function listValidationRules(
  formId: string,
  pagination?: { limit: number; offset: number },
): Promise<FormValidationRule[]> {
  const query = db
    .select()
    .from(formValidationRule)
    .where(eq(formValidationRule.formId, formId))
    .orderBy(
      asc(formValidationRule.orderIndex),
      asc(formValidationRule.createdAt),
    );
  const rules = pagination
    ? await query.offset(pagination.offset).limit(pagination.limit)
    : await query;
  if (rules.length === 0) return [];

  const ruleBlocks = await db
    .select()
    .from(formValidationRuleBlock)
    .where(
      inArray(
        formValidationRuleBlock.ruleId,
        rules.map((r) => r.id),
      ),
    )
    .orderBy(asc(formValidationRuleBlock.orderIndex));

  const blocksByRule = new Map<
    string,
    Array<typeof formValidationRuleBlock.$inferSelect>
  >();
  for (const rb of ruleBlocks) {
    const existing = blocksByRule.get(rb.ruleId);
    if (existing) {
      existing.push(rb);
    } else {
      blocksByRule.set(rb.ruleId, [rb]);
    }
  }

  return rules.map((rule) =>
    toFormValidationRule({ rule, ruleBlocks: blocksByRule.get(rule.id) ?? [] }),
  );
}

export async function countValidationRules(formId: string): Promise<number> {
  const rows = await db
    .select({ count: count() })
    .from(formValidationRule)
    .where(eq(formValidationRule.formId, formId));
  return rows[0]?.count ?? 0;
}

export async function getValidationRule(
  formId: string,
  ruleId: string,
): Promise<FormValidationRule | null> {
  const loaded = await loadRuleWithBlocks(ruleId);
  if (!loaded || loaded.rule.formId !== formId) {
    return null;
  }
  return toFormValidationRule(loaded);
}

export async function createValidationRule(input: {
  formId: string;
  payload: CreateFormValidationRule;
}): Promise<FormValidationRule> {
  await assertReferencedBlocks({
    formId: input.formId,
    referencedBlockIds: input.payload.referencedBlockIds,
  });
  const sanitizedConfig = validateProviderRuleConfig({
    providerName: input.payload.providerName,
    ruleType: input.payload.ruleType,
    configJson: input.payload.configJson,
  });

  const ruleId = randomUUID();
  await db.transaction(async (tx) => {
    let orderIndex = input.payload.orderIndex;
    if (orderIndex === undefined) {
      const existing = await tx
        .select({ count: formValidationRule.id })
        .from(formValidationRule)
        .where(eq(formValidationRule.formId, input.formId));
      orderIndex = existing.length;
    }
    await tx.insert(formValidationRule).values({
      id: ruleId,
      formId: input.formId,
      name: input.payload.name,
      providerName: input.payload.providerName,
      ruleType: input.payload.ruleType,
      configJson: sanitizedConfig,
      orderIndex,
    });
    await tx.insert(formValidationRuleBlock).values(
      input.payload.referencedBlockIds.map((blockId, index) => ({
        id: randomUUID(),
        ruleId,
        referencedBlockId: blockId,
        orderIndex: index,
      })),
    );
  });

  const loaded = await loadRuleWithBlocks(ruleId);
  if (!loaded) {
    throw new Error("Failed to load newly created validation rule");
  }
  return toFormValidationRule(loaded);
}

export async function updateValidationRule(input: {
  formId: string;
  ruleId: string;
  payload: UpdateFormValidationRule;
}): Promise<FormValidationRule> {
  const existing = await loadRuleWithBlocks(input.ruleId);
  if (!existing || existing.rule.formId !== input.formId) {
    throw new ValidationRuleNotFoundError(input.ruleId);
  }

  const nextProviderName =
    input.payload.providerName ?? existing.rule.providerName;
  const nextRuleType = input.payload.ruleType ?? existing.rule.ruleType;
  const nextConfigJson = (input.payload.configJson ??
    existing.rule.configJson) as Record<string, unknown>;
  const nextReferencedBlockIds =
    input.payload.referencedBlockIds ??
    existing.ruleBlocks.map((rb) => rb.referencedBlockId);

  if (input.payload.referencedBlockIds) {
    await assertReferencedBlocks({
      formId: input.formId,
      referencedBlockIds: nextReferencedBlockIds,
    });
  }

  const sanitizedConfig = validateProviderRuleConfig({
    providerName: nextProviderName,
    ruleType: nextRuleType,
    configJson: nextConfigJson,
  });

  const providerOrRuleChanged =
    nextProviderName !== existing.rule.providerName ||
    nextRuleType !== existing.rule.ruleType;

  await db.transaction(async (tx) => {
    await tx
      .update(formValidationRule)
      .set({
        name: input.payload.name ?? existing.rule.name,
        providerName: nextProviderName,
        ruleType: nextRuleType,
        configJson: sanitizedConfig,
        orderIndex: input.payload.orderIndex ?? existing.rule.orderIndex,
      })
      .where(eq(formValidationRule.id, input.ruleId));

    if (input.payload.referencedBlockIds) {
      await tx
        .delete(formValidationRuleBlock)
        .where(eq(formValidationRuleBlock.ruleId, input.ruleId));
      await tx.insert(formValidationRuleBlock).values(
        input.payload.referencedBlockIds.map((blockId, index) => ({
          id: randomUUID(),
          ruleId: input.ruleId,
          referencedBlockId: blockId,
          orderIndex: index,
        })),
      );
    }

    if (providerOrRuleChanged) {
      // provider / ruleType を変えた場合、過去の結果行とは検査対象が変わるため削除する
      await tx
        .delete(externalServiceValidationResult)
        .where(eq(externalServiceValidationResult.ruleId, input.ruleId));
    }
  });

  const refreshed = await loadRuleWithBlocks(input.ruleId);
  if (!refreshed) {
    throw new Error("Failed to reload validation rule after update");
  }
  return toFormValidationRule(refreshed);
}

export async function deleteValidationRule(input: {
  formId: string;
  ruleId: string;
}): Promise<boolean> {
  const existing = await loadRuleWithBlocks(input.ruleId);
  if (!existing || existing.rule.formId !== input.formId) {
    return false;
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(externalServiceValidationResult)
      .where(eq(externalServiceValidationResult.ruleId, input.ruleId));
    await tx
      .delete(formValidationRuleBlock)
      .where(eq(formValidationRuleBlock.ruleId, input.ruleId));
    await tx
      .delete(formValidationRule)
      .where(eq(formValidationRule.id, input.ruleId));
  });
  return true;
}

export async function reorderValidationRules(input: {
  formId: string;
  orderings: ReadonlyArray<{ ruleId: string; orderIndex: number }>;
}): Promise<void> {
  if (input.orderings.length === 0) return;
  const ruleIds = input.orderings.map((o) => o.ruleId);
  const existing = await db
    .select({ id: formValidationRule.id })
    .from(formValidationRule)
    .where(
      and(
        eq(formValidationRule.formId, input.formId),
        inArray(formValidationRule.id, ruleIds),
      ),
    );
  const existingIds = new Set(existing.map((r) => r.id));
  await db.transaction(async (tx) => {
    for (const ordering of input.orderings) {
      if (!existingIds.has(ordering.ruleId)) continue;
      await tx
        .update(formValidationRule)
        .set({ orderIndex: ordering.orderIndex })
        .where(
          and(
            eq(formValidationRule.id, ordering.ruleId),
            eq(formValidationRule.formId, input.formId),
          ),
        );
    }
  });
}

// ── Snapshot serialization ──────────────────────────────────────────

const ValidationRuleSnapshotEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  providerName: z.string(),
  ruleType: z.string(),
  referencedBlockIds: z.array(z.string()),
  configJson: z.record(z.string(), z.unknown()),
  orderIndex: z.number().int().min(0),
});
type ValidationRuleSnapshotEntry = z.infer<
  typeof ValidationRuleSnapshotEntrySchema
>;

export async function serializeFormValidationRules(
  formId: string,
): Promise<string> {
  const rules = await listValidationRules(formId);
  const entries: ValidationRuleSnapshotEntry[] = rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    providerName: rule.providerName,
    ruleType: rule.ruleType,
    referencedBlockIds: rule.referencedBlockIds,
    configJson: rule.configJson,
    orderIndex: rule.orderIndex,
  }));
  return JSON.stringify(entries);
}

export function parseValidationRuleSnapshot(
  json: string | null | undefined,
): ValidationRuleSnapshotEntry[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    const result = z.array(ValidationRuleSnapshotEntrySchema).safeParse(parsed);
    if (!result.success) return [];
    return result.data;
  } catch {
    return [];
  }
}

/**
 * フォーム全体のリセット (publish 状態への巻き戻し) で呼び出され、
 * snapshot に保存された検証ルールでフォームを完全に置換する。
 */
export async function replaceValidationRulesFromSnapshot(input: {
  formId: string;
  rules: ValidationRuleSnapshotEntry[];
}): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: formValidationRule.id })
      .from(formValidationRule)
      .where(eq(formValidationRule.formId, input.formId));
    if (existing.length > 0) {
      const existingIds = existing.map((r) => r.id);
      await tx
        .delete(externalServiceValidationResult)
        .where(inArray(externalServiceValidationResult.ruleId, existingIds));
      await tx
        .delete(formValidationRuleBlock)
        .where(inArray(formValidationRuleBlock.ruleId, existingIds));
      await tx
        .delete(formValidationRule)
        .where(eq(formValidationRule.formId, input.formId));
    }

    for (const entry of input.rules) {
      const ruleId = entry.id;
      await tx.insert(formValidationRule).values({
        id: ruleId,
        formId: input.formId,
        name: entry.name,
        providerName: entry.providerName,
        ruleType: entry.ruleType,
        configJson: entry.configJson,
        orderIndex: entry.orderIndex,
      });
      if (entry.referencedBlockIds.length > 0) {
        await tx.insert(formValidationRuleBlock).values(
          entry.referencedBlockIds.map((blockId, index) => ({
            id: randomUUID(),
            ruleId,
            referencedBlockId: blockId,
            orderIndex: index,
          })),
        );
      }
    }
  });
}
