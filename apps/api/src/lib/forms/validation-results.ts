import { db } from "@nexus-form/database";
import {
  externalServiceValidationResult,
  form,
  formResponse,
  formValidationRule,
} from "@nexus-form/database/schema";
import { extractQuestionsFromPlateContent } from "@nexus-form/shared";
import { desc, eq } from "drizzle-orm";
import { getSnapshotByVersion } from "./snapshot-repository";
import { parseValidationRuleSnapshot } from "./validation-rule-repository";

type BlockTitleMap = Map<string, string>;

function buildBlockTitleMap(
  plateContent: string | null | undefined,
): BlockTitleMap {
  const blockTitleMap = new Map<string, string>();
  if (!plateContent) return blockTitleMap;
  try {
    const parsed: unknown = JSON.parse(plateContent);
    if (Array.isArray(parsed)) {
      for (const q of extractQuestionsFromPlateContent(parsed)) {
        if (q.blockId) {
          blockTitleMap.set(q.blockId, q.title || q.blockId);
        }
      }
    }
  } catch {
    // plateContent が不正な場合はマップを空のまま続行
  }
  return blockTitleMap;
}

/**
 * responseIdからformIdを取得する
 */
export async function getFormIdFromResponseId(
  responseId: string,
): Promise<string | null> {
  const [response] = await db
    .select({ formId: formResponse.formId })
    .from(formResponse)
    .where(eq(formResponse.id, responseId))
    .limit(1);

  return response?.formId ?? null;
}

/**
 * 外部サービス検証結果を取得する。
 * 結果行は (ruleId, referencedBlockId) ペアごとに作られるので、フロント側で
 * ruleId による group 化を行う前提でフラット形式で返却する。
 */
export async function getExternalValidationResults(responseId: string) {
  const [response] = await db
    .select({ formId: formResponse.formId })
    .from(formResponse)
    .where(eq(formResponse.id, responseId))
    .limit(1);

  if (!response) {
    return [];
  }

  const validationResults = await db
    .select({
      result: externalServiceValidationResult,
      rule: formValidationRule,
    })
    .from(externalServiceValidationResult)
    .leftJoin(
      formValidationRule,
      eq(externalServiceValidationResult.ruleId, formValidationRule.id),
    )
    .where(eq(externalServiceValidationResult.responseId, responseId))
    .orderBy(
      formValidationRule.orderIndex,
      desc(externalServiceValidationResult.createdAt),
    );

  const snapshotVersions = [
    ...new Set(
      validationResults
        .map(({ result }) => result.snapshotVersion)
        .filter((version): version is number => version !== null),
    ),
  ];
  const snapshotRuleMap = new Map<
    string,
    {
      name: string;
      providerName: string;
      ruleType: string;
    }
  >();
  const snapshotBlockTitleMaps = new Map<number, BlockTitleMap>();
  for (const version of snapshotVersions) {
    const snapshot = await getSnapshotByVersion(response.formId, version);
    if (!snapshot) continue;
    snapshotBlockTitleMaps.set(
      version,
      buildBlockTitleMap(snapshot.plateContent),
    );
    for (const entry of parseValidationRuleSnapshot(
      snapshot.validationRulesJson,
    )) {
      snapshotRuleMap.set(`${version}:${entry.id}`, {
        name: entry.name,
        providerName: entry.providerName,
        ruleType: entry.ruleType,
      });
    }
  }

  const [formRecord] = await db
    .select({ plateContent: form.plateContent })
    .from(form)
    .where(eq(form.id, response.formId))
    .limit(1);

  const currentBlockTitleMap = buildBlockTitleMap(formRecord?.plateContent);

  return validationResults.map(({ result, rule }) => {
    const snapshotRule =
      result.snapshotVersion === null
        ? undefined
        : snapshotRuleMap.get(`${result.snapshotVersion}:${result.ruleId}`);
    const blockTitleMap =
      result.snapshotVersion === null
        ? currentBlockTitleMap
        : (snapshotBlockTitleMaps.get(result.snapshotVersion) ??
          currentBlockTitleMap);
    const referencedTitle = blockTitleMap.get(result.referencedBlockId) ?? null;
    const ruleId = rule?.id ?? result.ruleId;
    const providerName =
      snapshotRule?.providerName ??
      rule?.providerName ??
      result.service ??
      null;

    return {
      id: result.id,
      response_id: result.responseId,
      rule_id: ruleId,
      rule_name: snapshotRule?.name ?? rule?.name ?? result.ruleId,
      provider_name: providerName,
      rule_type: snapshotRule?.ruleType ?? rule?.ruleType ?? null,
      referenced_block_id: result.referencedBlockId,
      referenced_block_label: referencedTitle,
      referenced_block_missing: referencedTitle === null,
      service: result.service ?? providerName,
      status: result.status,
      success: result.success,
      attempt_count: result.attemptCount,
      last_attempt_at: result.lastAttemptAt?.toISOString(),
      next_retry_at: result.nextRetryAt?.toISOString(),
      metadata: result.metadata,
      error_code: result.errorCode,
      error_message: result.errorMessage,
      job_id: result.jobId ?? null,
      created_at: result.createdAt.toISOString(),
      updated_at: result.updatedAt.toISOString(),
    };
  });
}
