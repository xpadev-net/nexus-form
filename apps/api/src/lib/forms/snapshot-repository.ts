import { db } from "@nexus-form/database";
import { form, formSnapshot, formStructure } from "@nexus-form/database/schema";
import {
  extractQuestionsFromPlateContent,
  extractTitleFromChildren,
  type FormStatusValue,
  fromPlateQuestionType,
  isPlateQuestionType,
} from "@nexus-form/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { FormStructure } from "../../types/domain/form";
import type {
  FormDiffResult,
  FormSnapshot,
  NodeDiff,
  UnpublishedChangesInfo,
} from "../../types/domain/form-snapshot";
import {
  FormValidationError,
  NoChangesError,
  SnapshotNotFoundError,
} from "../errors/form-errors";
import { logError, logWarn } from "../logger";
import { assertCompletionTargetsForSnapshot } from "./completion-target-validation";
import { DEFAULT_FORM_STRUCTURE_JSON } from "./default-form-structure";
import { parseStoredStructure } from "./parse-stored-structure";
import type { TransactionClient } from "./types";
import {
  parseValidationRuleSnapshot,
  replaceValidationRulesFromSnapshot,
  serializeFormValidationRules,
} from "./validation-rule-repository";

// ── Plate node type ─────────────────────────────────────────────────

type PlateNode = { id?: string; type?: string; [key: string]: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePlateNodes(content: string): PlateNode[] {
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function assertSnapshotQuestionTitles(plateContent: string): void {
  const missingTitleBlockIds: string[] = [];

  function walk(nodes: PlateNode[]): void {
    for (const node of nodes) {
      if (isPlateQuestionType(node.type)) {
        const type = fromPlateQuestionType(node.type);
        const title = Array.isArray(node.children)
          ? extractTitleFromChildren(node.children)
          : "";

        if (type !== "section_separator" && title.length === 0) {
          missingTitleBlockIds.push(
            typeof node.blockId === "string" ? node.blockId : "",
          );
        }
      }

      if (Array.isArray(node.children)) {
        walk(
          node.children.filter((child): child is PlateNode => {
            return child != null && typeof child === "object";
          }),
        );
      }
    }
  }

  walk(parsePlateNodes(plateContent));

  if (missingTitleBlockIds.length > 0) {
    throw new FormValidationError("質問タイトルは1文字以上入力してください", {
      blockIds: missingTitleBlockIds,
    });
  }
}

// ── Private snapshot row → FormSnapshot ──────────────────────────────

type SnapshotRow = Pick<
  typeof formSnapshot.$inferSelect,
  | "id"
  | "formId"
  | "version"
  | "plateContent"
  | "validationRulesJson"
  | "structureJson"
  | "isActive"
  | "publishedBy"
  | "publishedAt"
  | "changeLog"
  | "title"
  | "description"
  | "parentVersion"
>;

function rowToSnapshot(row: SnapshotRow): FormSnapshot {
  return {
    id: row.id,
    formId: row.formId,
    version: row.version,
    plateContent: row.plateContent,
    validationRulesJson: row.validationRulesJson,
    structureJson: row.structureJson,
    isActive: row.isActive,
    publishedBy: row.publishedBy,
    publishedAt: row.publishedAt,
    changeLog: row.changeLog ?? undefined,
    title: row.title,
    description: row.description ?? undefined,
    parentVersion: row.parentVersion ?? undefined,
  };
}

async function getCurrentStructureJson(
  tx: TransactionClient,
  formId: string,
): Promise<string> {
  const [currentStructure] = await tx
    .select({ structureJson: formStructure.structureJson })
    .from(formStructure)
    .where(
      and(eq(formStructure.formId, formId), eq(formStructure.isActive, true)),
    )
    .orderBy(desc(formStructure.version))
    .limit(1);

  const structureJson =
    currentStructure?.structureJson ?? DEFAULT_FORM_STRUCTURE_JSON;
  parseStoredStructure(structureJson);
  return structureJson;
}

async function restoreStructureFromSnapshot(
  tx: TransactionClient,
  formId: string,
  structureJson: string,
  changeLog: string,
): Promise<void> {
  parseStoredStructure(structureJson);
  const [latestStructure] = await tx
    .select({ version: formStructure.version })
    .from(formStructure)
    .where(eq(formStructure.formId, formId))
    .orderBy(desc(formStructure.version))
    .limit(1);
  const currentVersion = latestStructure?.version ?? 0;
  const nextVersion = currentVersion + 1;

  await tx
    .update(formStructure)
    .set({ activeFormId: null, isActive: false })
    .where(
      and(eq(formStructure.formId, formId), eq(formStructure.isActive, true)),
    );
  await tx.insert(formStructure).values({
    id: crypto.randomUUID(),
    formId,
    activeFormId: formId,
    structureJson,
    version: nextVersion,
    createdBy: null,
    isActive: true,
    changeLog,
    parentVersion: currentVersion > 0 ? currentVersion : null,
  });
}

// ── Read functions ──────────────────────────────────────────────────

export async function getLatestSnapshot(
  formId: string,
): Promise<FormSnapshot | null> {
  const row = await db.query.formSnapshot.findFirst({
    where: and(
      eq(formSnapshot.formId, formId),
      eq(formSnapshot.isActive, true),
    ),
    orderBy: [desc(formSnapshot.version)],
  });
  return row ? rowToSnapshot(row) : null;
}

export interface ActivePublication {
  snapshot: FormSnapshot;
  publicPasswordGrantGeneration: bigint;
}

/**
 * Returns the active snapshot and its form-scoped grant generation from one
 * authoritative database read. Consumers must keep the bigint value intact.
 */
export async function getActivePublication(
  formId: string,
): Promise<ActivePublication | null> {
  const [row] = await db
    .select({
      id: formSnapshot.id,
      formId: formSnapshot.formId,
      version: formSnapshot.version,
      plateContent: formSnapshot.plateContent,
      validationRulesJson: formSnapshot.validationRulesJson,
      structureJson: formSnapshot.structureJson,
      isActive: formSnapshot.isActive,
      publishedBy: formSnapshot.publishedBy,
      publishedAt: formSnapshot.publishedAt,
      changeLog: formSnapshot.changeLog,
      title: formSnapshot.title,
      description: formSnapshot.description,
      parentVersion: formSnapshot.parentVersion,
      publicPasswordGrantGeneration: form.publicPasswordGrantGeneration,
    })
    .from(form)
    .innerJoin(
      formSnapshot,
      and(eq(formSnapshot.formId, form.id), eq(formSnapshot.isActive, true)),
    )
    .where(eq(form.id, formId))
    .orderBy(desc(formSnapshot.version))
    .limit(1);

  if (!row) return null;
  return {
    snapshot: rowToSnapshot(row),
    publicPasswordGrantGeneration: row.publicPasswordGrantGeneration,
  };
}

export async function getLatestSnapshotByVersion(
  formId: string,
): Promise<FormSnapshot | null> {
  const row = await db.query.formSnapshot.findFirst({
    where: eq(formSnapshot.formId, formId),
    orderBy: [desc(formSnapshot.version)],
  });
  return row ? rowToSnapshot(row) : null;
}

export async function getSnapshotByVersion(
  formId: string,
  version: number,
): Promise<FormSnapshot | null> {
  const row = await db.query.formSnapshot.findFirst({
    where: and(
      eq(formSnapshot.formId, formId),
      eq(formSnapshot.version, version),
    ),
  });
  return row ? rowToSnapshot(row) : null;
}

type SnapshotPreviewStructure = Pick<
  FormStructure,
  "appearance" | "confirmation"
>;

export type SnapshotPreviewContent = SnapshotPreviewStructure & {
  plateContent: string;
  version: number;
  publishedAt: Date;
};

function parseSnapshotPreviewStructure(
  structureJson: string,
): SnapshotPreviewStructure {
  try {
    const structure = parseStoredStructure(structureJson);
    return {
      ...(structure.appearance === undefined
        ? {}
        : { appearance: structure.appearance }),
      ...(structure.confirmation === undefined
        ? {}
        : { confirmation: structure.confirmation }),
    };
  } catch {
    // Fall through to the compatibility parser below.
  }

  let raw: unknown;
  try {
    raw = JSON.parse(structureJson);
  } catch {
    logWarn(
      "getSnapshotPreviewByVersion: invalid snapshot structure JSON; using preview defaults",
      "general",
    );
    return {};
  }

  if (!isRecord(raw)) {
    logWarn(
      "getSnapshotPreviewByVersion: invalid snapshot structure value; using preview defaults",
      "general",
    );
    return {};
  }

  const appearanceResult = FormStructure.shape.appearance.safeParse(
    raw.appearance,
  );
  const confirmationResult = FormStructure.shape.confirmation.safeParse(
    raw.confirmation,
  );
  const invalidFields = [
    ...(appearanceResult.success ? [] : ["appearance"]),
    ...(confirmationResult.success ? [] : ["confirmation"]),
  ];
  if (invalidFields.length > 0) {
    logWarn(
      `getSnapshotPreviewByVersion: omitted invalid snapshot preview fields: ${invalidFields.join(", ")}`,
      "general",
    );
  } else {
    logWarn(
      "getSnapshotPreviewByVersion: stored structure failed full validation; using validated preview fields",
      "general",
    );
  }

  return {
    ...(appearanceResult.success && appearanceResult.data !== undefined
      ? { appearance: appearanceResult.data }
      : {}),
    ...(confirmationResult.success && confirmationResult.data !== undefined
      ? { confirmation: confirmationResult.data }
      : {}),
  };
}

export async function getSnapshotPreviewByVersion(
  formId: string,
  version: number,
): Promise<SnapshotPreviewContent | null> {
  const snapshot = await getSnapshotByVersion(formId, version);
  if (!snapshot) return null;

  return {
    plateContent: snapshot.plateContent,
    version: snapshot.version,
    publishedAt: snapshot.publishedAt,
    ...parseSnapshotPreviewStructure(snapshot.structureJson),
  };
}

// ── Write functions ─────────────────────────────────────────────────

export async function publishSnapshot(
  formId: string,
  userId: string | null,
  opts?: { changeLog?: string },
): Promise<{ version: number; publishedAt: Date }> {
  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: form.id })
      .from(form)
      .where(eq(form.id, formId))
      .for("update");

    const existingSnapshots = await tx
      .select({
        id: formSnapshot.id,
        version: formSnapshot.version,
        plateContent: formSnapshot.plateContent,
        validationRulesJson: formSnapshot.validationRulesJson,
        structureJson: formSnapshot.structureJson,
        isActive: formSnapshot.isActive,
      })
      .from(formSnapshot)
      .where(eq(formSnapshot.formId, formId))
      .orderBy(desc(formSnapshot.version))
      .for("update");

    const latestByVersion = existingSnapshots[0] ?? null;
    const existingActive = existingSnapshots.find((s) => s.isActive);

    const formData = await tx.query.form.findFirst({
      where: eq(form.id, formId),
      columns: {
        title: true,
        description: true,
        plateContent: true,
        baseSnapshotVersion: true,
      },
    });

    if (!formData) throw new Error("Form not found");

    if (!formData.title || formData.title.trim().length === 0) {
      throw new Error("フォームタイトルは1文字以上入力してください");
    }

    const currentPlateContent = formData.plateContent ?? "[]";
    const currentPlateNodes = parsePlateNodes(currentPlateContent);
    assertSnapshotQuestionTitles(currentPlateContent);

    const questionCount =
      extractQuestionsFromPlateContent(currentPlateNodes).length;
    if (questionCount === 0) {
      throw new FormValidationError(
        "質問がありません。質問を追加してから保存してください",
      );
    }
    assertCompletionTargetsForSnapshot(currentPlateNodes);

    const currentValidationRulesJson =
      await serializeFormValidationRules(formId);
    const currentStructureJson = await getCurrentStructureJson(tx, formId);

    // Use the stored base snapshot for comparison; fall back to latest by version.
    const baseVersion = formData.baseSnapshotVersion;
    const baseSnapshot =
      baseVersion != null
        ? (existingSnapshots.find((s) => s.version === baseVersion) ??
          latestByVersion)
        : latestByVersion;

    if (baseSnapshot) {
      const plateUnchanged = currentPlateContent === baseSnapshot.plateContent;
      const rulesUnchanged =
        currentValidationRulesJson === baseSnapshot.validationRulesJson;
      const structureUnchanged =
        currentStructureJson === baseSnapshot.structureJson;
      if (plateUnchanged && rulesUnchanged && structureUnchanged) {
        throw new NoChangesError();
      }
    }

    const nextVersion = (latestByVersion?.version ?? 0) + 1;
    const snapshotId = crypto.randomUUID();

    // 既存のアクティブスナップショットがある場合は非アクティブで保存する。
    // ユーザーが activateSnapshot を呼ぶまで公開状態を変えない。
    // 初回公開（existingActive が未定義）の場合は即座にアクティブにする。
    await tx.insert(formSnapshot).values({
      id: snapshotId,
      formId,
      version: nextVersion,
      isActive: !existingActive,
      publishedBy: userId,
      changeLog: opts?.changeLog ?? null,
      title: formData.title,
      description: formData.description ?? null,
      parentVersion: baseVersion ?? latestByVersion?.version ?? null,
      plateContent: currentPlateContent,
      validationRulesJson: currentValidationRulesJson,
      structureJson: currentStructureJson,
    });

    // Track the new snapshot as the base for the next save.
    await tx
      .update(form)
      .set({
        baseSnapshotVersion: nextVersion,
        ...(!existingActive
          ? {
              publicPasswordGrantGeneration: sql`${form.publicPasswordGrantGeneration} + 1`,
            }
          : {}),
      })
      .where(eq(form.id, formId));

    const created = await tx.query.formSnapshot.findFirst({
      where: eq(formSnapshot.id, snapshotId),
    });

    if (!created) throw new Error("Failed to create snapshot");

    return { version: created.version, publishedAt: created.publishedAt };
  });

  return result;
}

export type PublicationStatus = "PUBLISHED" | "UNPUBLISHED";

/**
 * Applies one effective publication status transition inside the caller's
 * transaction. The caller must have locked the form row before passing the
 * current status so concurrent/retried operations share one idempotency
 * boundary.
 */
export async function transitionPublicationStatusInTransaction(
  tx: TransactionClient,
  formId: string,
  currentStatus: FormStatusValue,
  nextStatus: PublicationStatus,
  effectiveAt: Date,
): Promise<boolean> {
  if (currentStatus === nextStatus) return false;

  await tx
    .update(form)
    .set({
      status: nextStatus,
      ...(nextStatus === "PUBLISHED"
        ? { publishedAt: effectiveAt }
        : { unpublishedAt: effectiveAt }),
      publicPasswordGrantGeneration: sql`${form.publicPasswordGrantGeneration} + 1`,
    })
    .where(eq(form.id, formId));
  return true;
}

export async function restoreFromSnapshot(
  formId: string,
): Promise<{ plateContent: string }> {
  const snapshot = await getLatestSnapshot(formId);
  if (!snapshot) throw new SnapshotNotFoundError(formId);

  await db.transaction(async (tx) => {
    await tx
      .update(form)
      .set({
        plateContent: snapshot.plateContent,
        plateContentVersion: sql`${form.plateContentVersion} + 1`,
        baseSnapshotVersion: snapshot.version,
      })
      .where(eq(form.id, formId));

    await replaceValidationRulesFromSnapshot({
      formId,
      rules: parseValidationRuleSnapshot(snapshot.validationRulesJson),
      tx,
    });
    await restoreStructureFromSnapshot(
      tx,
      formId,
      snapshot.structureJson,
      `Restore structure from snapshot v${snapshot.version}`,
    );
  });

  return {
    plateContent: snapshot.plateContent,
  };
}

export async function restoreFromSnapshotVersion(
  formId: string,
  version: number,
): Promise<{ plateContent: string }> {
  const snapshot = await getSnapshotByVersion(formId, version);
  if (!snapshot) throw new SnapshotNotFoundError(formId, version);

  await db.transaction(async (tx) => {
    await tx
      .update(form)
      .set({
        plateContent: snapshot.plateContent,
        plateContentVersion: sql`${form.plateContentVersion} + 1`,
        baseSnapshotVersion: version,
      })
      .where(eq(form.id, formId));

    await replaceValidationRulesFromSnapshot({
      formId,
      rules: parseValidationRuleSnapshot(snapshot.validationRulesJson),
      tx,
    });
    await restoreStructureFromSnapshot(
      tx,
      formId,
      snapshot.structureJson,
      `Restore structure from snapshot v${snapshot.version}`,
    );
  });

  return {
    plateContent: snapshot.plateContent,
  };
}

// ── Diff / unpublished-changes ──────────────────────────────────────

export async function checkUnpublishedChanges(
  formId: string,
): Promise<UnpublishedChangesInfo> {
  const formData = await db.query.form.findFirst({
    where: eq(form.id, formId),
    columns: { plateContent: true, updatedAt: true, baseSnapshotVersion: true },
  });

  const baseVersion = formData?.baseSnapshotVersion;
  const baseSnapshot =
    baseVersion != null
      ? await getSnapshotByVersion(formId, baseVersion)
      : await getLatestSnapshotByVersion(formId);

  if (!baseSnapshot) {
    const hasContent =
      formData?.plateContent != null &&
      formData.plateContent !== "[]" &&
      formData.plateContent !== "null";
    return {
      hasChanges: hasContent,
      hasValidationRuleChanges: false,
      lastPublishedAt: null,
    };
  }

  const currentPlate = formData?.plateContent ?? "[]";
  const currentRules = await serializeFormValidationRules(formId);
  const [currentStructure] = await db
    .select({ structureJson: formStructure.structureJson })
    .from(formStructure)
    .where(
      and(eq(formStructure.formId, formId), eq(formStructure.isActive, true)),
    )
    .orderBy(desc(formStructure.version))
    .limit(1);
  const currentStructureJson =
    currentStructure?.structureJson ?? DEFAULT_FORM_STRUCTURE_JSON;

  return {
    hasChanges:
      currentPlate !== baseSnapshot.plateContent ||
      currentRules !== baseSnapshot.validationRulesJson ||
      currentStructureJson !== baseSnapshot.structureJson,
    hasValidationRuleChanges: currentRules !== baseSnapshot.validationRulesJson,
    lastPublishedAt: baseSnapshot.publishedAt,
  };
}

export async function calculateFormDiff(
  formId: string,
): Promise<FormDiffResult> {
  const formData = await db.query.form.findFirst({
    where: eq(form.id, formId),
    columns: { plateContent: true, baseSnapshotVersion: true },
  });

  const baseVersion = formData?.baseSnapshotVersion;
  const [baseSnapshot, activeSnapshot, currentRules] = await Promise.all([
    baseVersion != null
      ? getSnapshotByVersion(formId, baseVersion)
      : getLatestSnapshotByVersion(formId),
    getLatestSnapshot(formId),
    serializeFormValidationRules(formId),
  ]);
  const [currentStructure] = await db
    .select({ structureJson: formStructure.structureJson })
    .from(formStructure)
    .where(
      and(eq(formStructure.formId, formId), eq(formStructure.isActive, true)),
    )
    .orderBy(desc(formStructure.version))
    .limit(1);

  const currentPlate = formData?.plateContent ?? "[]";
  const currentStructureJson =
    currentStructure?.structureJson ?? DEFAULT_FORM_STRUCTURE_JSON;
  const snapshotPlate = baseSnapshot?.plateContent ?? "[]";
  const activePlate = activeSnapshot?.plateContent ?? null;

  const currentNodes = parsePlateNodes(currentPlate);
  const snapshotNodes = parsePlateNodes(snapshotPlate);

  const nodes = diffNodes(snapshotNodes, currentNodes);
  const totalChanges = nodes.length;
  const hasValidationRuleChanges =
    currentRules !== (baseSnapshot?.validationRulesJson ?? "[]");
  const hasStructureChanges =
    currentStructureJson !==
    (baseSnapshot?.structureJson ?? DEFAULT_FORM_STRUCTURE_JSON);

  const hasUnpublishedChanges =
    totalChanges > 0 ||
    hasValidationRuleChanges ||
    hasStructureChanges ||
    !baseSnapshot;

  let hasChangesFromActive = hasUnpublishedChanges;
  if (activeSnapshot && activeSnapshot.id !== baseSnapshot?.id && activePlate) {
    const activeNodes = parsePlateNodes(activePlate);
    const activeDiff = diffNodes(activeNodes, currentNodes);
    const activeRulesChanged =
      currentRules !== (activeSnapshot.validationRulesJson ?? "[]");
    const activeStructureChanged =
      currentStructureJson !== activeSnapshot.structureJson;
    hasChangesFromActive =
      activeDiff.length > 0 || activeRulesChanged || activeStructureChanged;
  }

  return {
    formId,
    hasUnpublishedChanges,
    hasChangesFromActive,
    hasValidationRuleChanges,
    nodes,
    totalChanges,
    lastChecked: new Date(),
  };
}

function diffNodes(
  snapshotNodes: PlateNode[],
  currentNodes: PlateNode[],
): NodeDiff[] {
  const snapshotMap = new Map(
    snapshotNodes.filter((n) => n.id).map((n) => [n.id as string, n]),
  );
  const currentMap = new Map(
    currentNodes.filter((n) => n.id).map((n) => [n.id as string, n]),
  );

  const diffs: NodeDiff[] = [];

  for (const [id, snap] of snapshotMap) {
    const cur = currentMap.get(id);
    if (!cur) {
      diffs.push({
        nodeId: id,
        nodeType: snap.type ?? null,
        diffType: "removed",
      });
    } else if (JSON.stringify(snap) !== JSON.stringify(cur)) {
      diffs.push({
        nodeId: id,
        nodeType: cur.type ?? null,
        diffType: "modified",
      });
    }
  }

  for (const [id, cur] of currentMap) {
    if (!snapshotMap.has(id)) {
      diffs.push({ nodeId: id, nodeType: cur.type ?? null, diffType: "added" });
    }
  }

  return diffs;
}

/**
 * スナップショットをアクティブに切り替え、form の plateContent とバリデーションルールを
 * スナップショットの内容で上書きする。
 *
 * isActive、form、formStructure、バリデーションルールは同一 TX で切り替える。
 */
export async function activateSnapshot(
  formId: string,
  version: number,
): Promise<FormSnapshot> {
  return db.transaction((tx) =>
    activateSnapshotInTransaction(tx, formId, version),
  );
}

/**
 * Activates a snapshot and advances the grant generation in the same
 * transaction. The form row is the serialization/idempotency boundary; an
 * already-active target is a true no-op.
 */
export async function activateSnapshotInTransaction(
  tx: TransactionClient,
  formId: string,
  version: number,
): Promise<FormSnapshot> {
  const [lockedForm] = await tx
    .select({ id: form.id })
    .from(form)
    .where(eq(form.id, formId))
    .for("update")
    .limit(1);
  if (!lockedForm) throw new Error("Form not found");

  const [target] = await tx
    .select()
    .from(formSnapshot)
    .where(
      and(eq(formSnapshot.formId, formId), eq(formSnapshot.version, version)),
    )
    .for("update")
    .limit(1);
  if (!target) throw new SnapshotNotFoundError(formId, version);
  if (target.isActive) return rowToSnapshot(target);

  await tx
    .update(formSnapshot)
    .set({ isActive: false })
    .where(
      and(eq(formSnapshot.formId, formId), eq(formSnapshot.isActive, true)),
    );
  await tx
    .update(formSnapshot)
    .set({ isActive: true })
    .where(eq(formSnapshot.id, target.id));
  await tx
    .update(form)
    .set({
      plateContent: target.plateContent,
      plateContentVersion: sql`${form.plateContentVersion} + 1`,
      baseSnapshotVersion: version,
      publicPasswordGrantGeneration: sql`${form.publicPasswordGrantGeneration} + 1`,
    })
    .where(eq(form.id, formId));
  await restoreStructureFromSnapshot(
    tx,
    formId,
    target.structureJson,
    `Activate snapshot v${target.version}`,
  );

  await replaceValidationRulesFromSnapshot({
    formId,
    rules: parseValidationRuleSnapshot(target.validationRulesJson),
    tx,
  });

  return rowToSnapshot({ ...target, isActive: true });
}

export async function deleteSnapshot(
  formId: string,
  version: number,
): Promise<boolean> {
  try {
    await db
      .delete(formSnapshot)
      .where(
        and(eq(formSnapshot.formId, formId), eq(formSnapshot.version, version)),
      );
    return true;
  } catch (error) {
    logError("Error deleting snapshot:", "api", { error });
    return false;
  }
}
