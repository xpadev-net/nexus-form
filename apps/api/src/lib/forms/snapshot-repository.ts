import { db } from "@nexus-form/database";
import { form, formSnapshot } from "@nexus-form/database/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import type {
  FormDiffResult,
  FormSnapshot,
  NodeDiff,
  UnpublishedChangesInfo,
} from "../../types/domain/form-snapshot";
import { NoChangesError, SnapshotNotFoundError } from "../errors/form-errors";
import { logError } from "../logger";
import {
  parseValidationRuleSnapshot,
  replaceValidationRulesFromSnapshot,
  serializeFormValidationRules,
} from "./validation-rule-repository";

// ── Plate node type ─────────────────────────────────────────────────

type PlateNode = { id?: string; type?: string; [key: string]: unknown };

function parsePlateNodes(content: string): PlateNode[] {
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Private snapshot row → FormSnapshot ──────────────────────────────

function rowToSnapshot(row: typeof formSnapshot.$inferSelect): FormSnapshot {
  return {
    id: row.id,
    formId: row.formId,
    version: row.version,
    plateContent: row.plateContent,
    validationRulesJson: row.validationRulesJson,
    isActive: row.isActive,
    publishedBy: row.publishedBy,
    publishedAt: row.publishedAt,
    changeLog: row.changeLog ?? undefined,
    title: row.title,
    description: row.description ?? undefined,
    parentVersion: row.parentVersion ?? undefined,
  };
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

// ── Write functions ─────────────────────────────────────────────────

export async function publishSnapshot(
  formId: string,
  userId: string,
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
    const currentValidationRulesJson =
      await serializeFormValidationRules(formId);

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
      if (plateUnchanged && rulesUnchanged) {
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
    });

    // Track the new snapshot as the base for the next save.
    await tx
      .update(form)
      .set({ baseSnapshotVersion: nextVersion })
      .where(eq(form.id, formId));

    const created = await tx.query.formSnapshot.findFirst({
      where: eq(formSnapshot.id, snapshotId),
    });

    if (!created) throw new Error("Failed to create snapshot");

    return { version: created.version, publishedAt: created.publishedAt };
  });

  return result;
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

  return {
    hasChanges:
      currentPlate !== baseSnapshot.plateContent ||
      currentRules !== baseSnapshot.validationRulesJson,
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

  const currentPlate = formData?.plateContent ?? "[]";
  const snapshotPlate = baseSnapshot?.plateContent ?? "[]";
  const activePlate = activeSnapshot?.plateContent ?? null;

  const currentNodes = parsePlateNodes(currentPlate);
  const snapshotNodes = parsePlateNodes(snapshotPlate);

  const nodes = diffNodes(snapshotNodes, currentNodes);
  const totalChanges = nodes.length;
  const hasValidationRuleChanges =
    currentRules !== (baseSnapshot?.validationRulesJson ?? "[]");

  const hasUnpublishedChanges =
    totalChanges > 0 || hasValidationRuleChanges || !baseSnapshot;

  let hasChangesFromActive = hasUnpublishedChanges;
  if (activeSnapshot && activeSnapshot.id !== baseSnapshot?.id && activePlate) {
    const activeNodes = parsePlateNodes(activePlate);
    const activeDiff = diffNodes(activeNodes, currentNodes);
    const activeRulesChanged =
      currentRules !== (activeSnapshot.validationRulesJson ?? "[]");
    hasChangesFromActive = activeDiff.length > 0 || activeRulesChanged;
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
 * 原子性注意: TX1(isActive + form 更新) と TX2(バリデーションルール置換) は別トランザクション。
 * 二つの間は plateContent のみ新しく、ルールは旧状態になる極短い窓が存在する。
 * restore 系は編集内容の巻き戻しなので、フォーム更新とルール置換を同一 TX にしている。
 */
export async function activateSnapshot(
  formId: string,
  version: number,
): Promise<FormSnapshot> {
  const target = await getSnapshotByVersion(formId, version);
  if (!target) throw new SnapshotNotFoundError(formId, version);

  await db.transaction(async (tx) => {
    await tx
      .select({ id: form.id })
      .from(form)
      .where(eq(form.id, formId))
      .for("update");
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
      })
      .where(eq(form.id, formId));
  });

  await replaceValidationRulesFromSnapshot({
    formId,
    rules: parseValidationRuleSnapshot(target.validationRulesJson),
  });

  const updated = await getSnapshotByVersion(formId, version);
  if (!updated) throw new SnapshotNotFoundError(formId, version);
  return updated;
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
