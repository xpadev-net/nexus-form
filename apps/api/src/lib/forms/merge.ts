import type {
  ConflictItem,
  MergeContext,
  MergeResult,
} from "../../types/domain/form-block";
import { extractBlockContent } from "../../types/domain/form-block";
import { deepEqual } from "../utils/deep-equal";

export interface ConflictResult {
  type: "conflict";
  conflicts: ConflictItem[];
}

/**
 * 3-wayマージの結果型
 */
export type MergeResultOrConflict<T> = T | ConflictResult;

/**
 * プリミティブ値の3-wayマージ
 */
export function mergePrimitive(
  base: unknown,
  local: unknown,
  remote: unknown,
  path: string = "",
): MergeResultOrConflict<unknown> {
  if (deepEqual(local, remote)) {
    return local;
  }

  if (deepEqual(base, local) && !deepEqual(base, remote)) {
    return remote;
  }

  if (deepEqual(base, remote) && !deepEqual(base, local)) {
    return local;
  }

  return {
    type: "conflict",
    conflicts: [
      {
        path,
        base,
        local,
        remote,
      },
    ],
  };
}

/**
 * IDを持つオブジェクトの配列を3-wayマージ
 */
export function mergeArrayById<T extends { id: string }>(
  base: T[],
  local: T[],
  remote: T[],
  path: string = "",
): MergeResultOrConflict<T[]> {
  const baseMap = new Map(base.map((item) => [item.id, item]));
  const localMap = new Map(local.map((item) => [item.id, item]));
  const remoteMap = new Map(remote.map((item) => [item.id, item]));

  const localDeleted = new Set(
    base.filter((b) => !localMap.has(b.id)).map((b) => b.id),
  );
  const remoteDeleted = new Set(
    base.filter((b) => !remoteMap.has(b.id)).map((b) => b.id),
  );

  const localAdded = local.filter((l) => !baseMap.has(l.id));
  const remoteAdded = remote.filter((r) => !baseMap.has(r.id));

  const conflicts: ConflictItem[] = [];
  const result: T[] = [];

  for (const baseItem of base) {
    const localItem = localMap.get(baseItem.id);
    const remoteItem = remoteMap.get(baseItem.id);

    if (localDeleted.has(baseItem.id) && remoteDeleted.has(baseItem.id)) {
      continue;
    }

    if (localDeleted.has(baseItem.id) || remoteDeleted.has(baseItem.id)) {
      continue;
    }

    if (localItem && remoteItem) {
      if (!deepEqual(localItem, remoteItem)) {
        conflicts.push({
          path: `${path}[${baseItem.id}]`,
          base: baseItem,
          local: localItem,
          remote: remoteItem,
        });
        continue;
      }
      result.push(remoteItem);
    }
  }

  for (const remoteItem of remoteAdded) {
    if (!localDeleted.has(remoteItem.id)) {
      result.push(remoteItem);
    }
  }

  for (const localItem of localAdded) {
    if (!remoteDeleted.has(localItem.id)) {
      result.push(localItem);
    }
  }

  if (conflicts.length > 0) {
    return {
      type: "conflict",
      conflicts,
    };
  }

  return result;
}

/**
 * オブジェクトの3-wayマージ
 */
export function mergeObject(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  path: string = "",
): MergeResultOrConflict<Record<string, unknown>> {
  const allKeys = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);

  const result: Record<string, unknown> = {};
  const conflicts: ConflictItem[] = [];

  for (const key of allKeys) {
    const baseValue = base[key];
    const localValue = local[key];
    const remoteValue = remote[key];
    const currentPath = path ? `${path}.${key}` : key;

    if (
      Array.isArray(localValue) &&
      Array.isArray(remoteValue) &&
      Array.isArray(baseValue)
    ) {
      if (
        localValue.length > 0 &&
        remoteValue.length > 0 &&
        baseValue.length > 0 &&
        typeof localValue[0] === "object" &&
        localValue[0] !== null &&
        "id" in (localValue[0] as Record<string, unknown>) &&
        typeof remoteValue[0] === "object" &&
        remoteValue[0] !== null &&
        "id" in (remoteValue[0] as Record<string, unknown>) &&
        typeof baseValue[0] === "object" &&
        baseValue[0] !== null &&
        "id" in (baseValue[0] as Record<string, unknown>)
      ) {
        const mergeResult = mergeArrayById(
          baseValue as Array<{ id: string }>,
          localValue as Array<{ id: string }>,
          remoteValue as Array<{ id: string }>,
          currentPath,
        );

        if (
          typeof mergeResult === "object" &&
          mergeResult !== null &&
          "type" in mergeResult &&
          mergeResult.type === "conflict"
        ) {
          conflicts.push(...(mergeResult as ConflictResult).conflicts);
          continue;
        }
        result[key] = mergeResult as unknown;
      } else {
        const mergeResult = mergePrimitive(
          baseValue,
          localValue,
          remoteValue,
          currentPath,
        );

        if (
          typeof mergeResult === "object" &&
          mergeResult !== null &&
          "type" in mergeResult &&
          mergeResult.type === "conflict"
        ) {
          conflicts.push(...(mergeResult as ConflictResult).conflicts);
          continue;
        }
        result[key] = mergeResult as unknown;
      }
    } else {
      const mergeResult = mergePrimitive(
        baseValue,
        localValue,
        remoteValue,
        currentPath,
      );

      if (
        typeof mergeResult === "object" &&
        mergeResult !== null &&
        "type" in mergeResult &&
        mergeResult.type === "conflict"
      ) {
        conflicts.push(...(mergeResult as ConflictResult).conflicts);
        continue;
      }
      result[key] = mergeResult as unknown;
    }
  }

  if (conflicts.length > 0) {
    return {
      type: "conflict",
      conflicts,
    };
  }

  return result;
}

/**
 * Blockの3-wayマージ
 */
export function mergeBlock(context: MergeContext): MergeResult {
  const { base, local, remote } = context;

  // Block からマージ対象のコンテンツフィールドを抽出
  const baseContent = extractBlockContent(base);
  const localContent = extractBlockContent(local);
  const remoteContent = extractBlockContent(remote);

  const mergedContent = mergeObject(
    baseContent,
    localContent,
    remoteContent,
    "content",
  );

  if (
    typeof mergedContent === "object" &&
    mergedContent !== null &&
    "type" in mergedContent &&
    mergedContent.type === "conflict"
  ) {
    return {
      merged: {
        ...local,
        version: remote.version,
        updatedAt: new Date(),
      },
      hasConflict: true,
      conflicts: (mergedContent as ConflictResult).conflicts,
    };
  }

  const orderMerge = mergePrimitive(
    base.order,
    local.order,
    remote.order,
    "order",
  );
  if (
    typeof orderMerge === "object" &&
    orderMerge !== null &&
    "type" in orderMerge &&
    orderMerge.type === "conflict"
  ) {
    return {
      merged: {
        ...local,
        version: remote.version,
        updatedAt: new Date(),
      },
      hasConflict: true,
      conflicts: (orderMerge as ConflictResult).conflicts,
    };
  }

  // マージ結果のコンテンツフィールドを Block に反映
  const mc = mergedContent as Record<string, unknown>;
  return {
    merged: {
      ...local,
      ...(mc.title !== undefined && { title: mc.title }),
      ...(mc.description !== undefined && { description: mc.description }),
      ...(mc.validation !== undefined && { validation: mc.validation }),
      ...(mc.meta !== undefined && { meta: mc.meta }),
      order: orderMerge as number,
      version: remote.version,
      updatedAt: new Date(),
    } as MergeResult["merged"],
    hasConflict: false,
    conflicts: [],
  };
}

/**
 * 衝突を検出する
 */
export function detectConflicts(context: MergeContext): ConflictItem[] {
  const { base, local, remote } = context;
  const conflicts: ConflictItem[] = [];

  // Block からコンテンツフィールドを抽出して比較
  const baseContent = extractBlockContent(base);
  const localContent = extractBlockContent(local);
  const remoteContent = extractBlockContent(remote);

  const contentConflicts = detectObjectConflicts(
    baseContent,
    localContent,
    remoteContent,
    "content",
  );
  conflicts.push(...contentConflicts);

  if (
    !deepEqual(base.order, local.order) &&
    !deepEqual(base.order, remote.order) &&
    !deepEqual(local.order, remote.order)
  ) {
    conflicts.push({
      path: "order",
      base: base.order,
      local: local.order,
      remote: remote.order,
    });
  }

  return conflicts;
}

function detectObjectConflicts(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  path: string = "",
): ConflictItem[] {
  const allKeys = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);

  const conflicts: ConflictItem[] = [];

  for (const key of allKeys) {
    const baseValue = base[key];
    const localValue = local[key];
    const remoteValue = remote[key];
    const currentPath = path ? `${path}.${key}` : key;

    if (
      Array.isArray(localValue) &&
      Array.isArray(remoteValue) &&
      Array.isArray(baseValue)
    ) {
      const arrayConflicts = detectArrayConflicts(
        baseValue,
        localValue,
        remoteValue,
        currentPath,
      );
      conflicts.push(...arrayConflicts);
    } else {
      if (!deepEqual(localValue, remoteValue)) {
        if (
          !deepEqual(baseValue, localValue) &&
          !deepEqual(baseValue, remoteValue)
        ) {
          conflicts.push({
            path: currentPath,
            base: baseValue,
            local: localValue,
            remote: remoteValue,
          });
        }
      }
    }
  }

  return conflicts;
}

function detectArrayConflicts(
  base: unknown[],
  local: unknown[],
  remote: unknown[],
  path: string,
): ConflictItem[] {
  const conflicts: ConflictItem[] = [];

  if (
    local.length > 0 &&
    remote.length > 0 &&
    base.length > 0 &&
    typeof local[0] === "object" &&
    local[0] !== null &&
    "id" in (local[0] as Record<string, unknown>) &&
    typeof remote[0] === "object" &&
    remote[0] !== null &&
    "id" in (remote[0] as Record<string, unknown>) &&
    typeof base[0] === "object" &&
    base[0] !== null &&
    "id" in (base[0] as Record<string, unknown>)
  ) {
    const localMap = new Map(
      (local as Array<{ id: string }>).map((item) => [item.id, item]),
    );
    const remoteMap = new Map(
      (remote as Array<{ id: string }>).map((item) => [item.id, item]),
    );

    for (const baseItem of base as Array<{ id: string }>) {
      const localItem = localMap.get(baseItem.id);
      const remoteItem = remoteMap.get(baseItem.id);

      if (localItem && remoteItem && !deepEqual(localItem, remoteItem)) {
        conflicts.push({
          path: `${path}[${baseItem.id}]`,
          base: baseItem,
          local: localItem,
          remote: remoteItem,
        });
      }
    }
  } else {
    if (!deepEqual(local, remote)) {
      conflicts.push({
        path,
        base,
        local,
        remote,
      });
    }
  }

  return conflicts;
}

export type ConflictResolution = "local" | "remote" | "manual";

export interface ConflictResolutionResult {
  resolved: boolean;
  value: unknown;
}

export function resolvePrimitiveConflict(
  conflict: ConflictItem,
  resolution: ConflictResolution,
): ConflictResolutionResult {
  switch (resolution) {
    case "local":
      return { resolved: true, value: conflict.local };
    case "remote":
      return { resolved: true, value: conflict.remote };
    case "manual":
      return { resolved: false, value: conflict.local };
    default:
      return { resolved: false, value: conflict.local };
  }
}

export function resolveArrayConflict<T extends { id: string }>(
  base: T[],
  local: T[],
  remote: T[],
  resolution: ConflictResolution,
): ConflictResolutionResult {
  switch (resolution) {
    case "local":
      return { resolved: true, value: local };
    case "remote":
      return { resolved: true, value: remote };
    case "manual":
      return { resolved: false, value: base };
    default:
      return { resolved: false, value: base };
  }
}

export function resolveObjectConflicts(
  _base: Record<string, unknown>,
  _local: Record<string, unknown>,
  _remote: Record<string, unknown>,
  conflicts: ConflictItem[],
  resolutions: Record<string, ConflictResolution>,
): ConflictResolutionResult {
  const result: Record<string, unknown> = { ..._base };
  let allResolved = true;

  for (const conflict of conflicts) {
    const path = conflict.path;
    const resolution = resolutions[path];

    if (!resolution) {
      allResolved = false;
      continue;
    }

    switch (resolution) {
      case "local":
        result[path] = conflict.local;
        break;
      case "remote":
        result[path] = conflict.remote;
        break;
      case "manual":
        allResolved = false;
        break;
    }
  }

  return { resolved: allResolved, value: result };
}

export function canAutoMerge(context: MergeContext): boolean {
  const conflicts = detectConflicts(context);
  return conflicts.length === 0;
}

export function getConflictSeverity(conflict: ConflictItem): number {
  const path = conflict.path.toLowerCase();

  if (path.includes("title") || path.includes("questionid")) {
    return 5;
  }
  if (path.includes("required") || path.includes("validation")) {
    return 4;
  }
  if (path.includes("options") || path.includes("choices")) {
    return 3;
  }
  if (path.includes("description") || path.includes("help")) {
    return 2;
  }
  return 1;
}

export function sortConflictsBySeverity(
  conflicts: ConflictItem[],
): ConflictItem[] {
  return conflicts.sort((a, b) => {
    const severityA = getConflictSeverity(a);
    const severityB = getConflictSeverity(b);
    return severityB - severityA;
  });
}
