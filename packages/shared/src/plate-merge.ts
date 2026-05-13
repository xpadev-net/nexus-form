/**
 * 3-way merge algorithm for Plate.js document content at the node level.
 *
 * Merges concurrent edits by comparing base (common ancestor), local (this
 * user's changes), and remote (another user's saved version) node arrays.
 * Each top-level node is identified by its `nodeId` property.
 */

import { ensureNodeIds, extractTextFromChildren } from "./plate-content-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlateNodeConflict {
  /** Stable node identifier */
  nodeId: string;
  /** What kind of conflict occurred */
  conflictType: "modified_both" | "deleted_vs_modified";
  /** Node in the base version (`null` if it didn't exist in base) */
  base: unknown | null;
  /** Node in the local version (`null` if deleted locally) */
  local: unknown | null;
  /** Node in the remote version (`null` if deleted remotely) */
  remote: unknown | null;
  /** Human-readable label for the conflict UI */
  displayLabel: string;
}

export interface MergePlateResult {
  /** The merged node array (conflicts are resolved using local by default) */
  merged: unknown[];
  /** Whether any conflicts were detected */
  hasConflict: boolean;
  /** Per-node conflict descriptions */
  conflicts: PlateNodeConflict[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_DEEP_EQUAL_DEPTH = 100;

/**
 * Compare two Plate nodes ignoring identity fields (nodeId, blockId).
 * These fields are used for merge tracking, not for content equality —
 * including them would produce false conflicts when nodes receive
 * different client-generated UUIDs before the CAS backfill propagates.
 * Identity fields can exist on nested elements too, so exclusion is applied
 * recursively across the entire subtree.
 */
const NODE_IDENTITY_KEYS = new Set(["nodeId", "blockId"]);

function nodeContentEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (depth > MAX_DEEP_EQUAL_DEPTH) return a === b;
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!nodeContentEqual(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA).filter((k) => !NODE_IDENTITY_KEYS.has(k));
  const keysB = Object.keys(objB).filter((k) => !NODE_IDENTITY_KEYS.has(k));
  if (keysA.length !== keysB.length) return false;
  const keySetB = new Set(keysB);
  for (const key of keysA) {
    if (!keySetB.has(key)) return false;
    if (!nodeContentEqual(objA[key], objB[key], depth + 1)) return false;
  }
  return true;
}

type PlateNode = Record<string, unknown>;

function getNodeId(node: unknown): string | undefined {
  if (node == null || typeof node !== "object") return undefined;
  const el = node as PlateNode;
  return typeof el.nodeId === "string" ? el.nodeId : undefined;
}

function buildNodeMap(nodes: unknown[]): Map<string, PlateNode> {
  const map = new Map<string, PlateNode>();
  for (const node of nodes) {
    const id = getNodeId(node);
    if (id) map.set(id, node as PlateNode);
  }
  return map;
}

function buildOrderList(nodes: unknown[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    const id = getNodeId(node);
    if (id) ids.push(id);
  }
  return ids;
}

function nodeDisplayLabel(node: unknown): string {
  if (node == null || typeof node !== "object") return "(不明なノード)";
  const el = node as PlateNode;

  // Form question nodes — show type + title
  if (typeof el.type === "string" && (el.type as string).startsWith("form_")) {
    const typeName = (el.type as string).replace(/^form_/, "");
    if (Array.isArray(el.children)) {
      const text = extractTextFromChildren(el.children as unknown[]).trim();
      if (text) return `${typeName}: ${text.slice(0, 40)}`;
    }
    return typeName;
  }

  // Regular content nodes — show text preview
  if (Array.isArray(el.children)) {
    const text = extractTextFromChildren(el.children as unknown[]).trim();
    if (text) return text.slice(0, 50);
  }

  return typeof el.type === "string" ? (el.type as string) : "(不明なノード)";
}

// ---------------------------------------------------------------------------
// Merge algorithm
// ---------------------------------------------------------------------------

/**
 * Perform a 3-way merge on Plate node arrays.
 *
 * **IMPORTANT**: All three inputs MUST have a stable `nodeId` pre-assigned on
 * every top-level node. Call `ensureNodeIds()` on each array **before** passing
 * it here, and ensure all three arrays received their IDs from the same source
 * (e.g. the server). The internal `ensureNodeIds` call below is purely
 * defensive — if nodes lack IDs, fresh UUIDs are generated per-copy, meaning
 * the same logical node in base/local/remote will get **different** IDs and be
 * treated as three separate nodes (producing duplicates, not a merge).
 *
 * The merge works at the **top-level node** granularity — if the same node
 * changed in both local and remote (and the changes differ), it is reported
 * as a conflict.
 */
export function mergePlateContent(
  baseRaw: unknown[],
  localRaw: unknown[],
  remoteRaw: unknown[],
): MergePlateResult {
  // Defensive clone + ID assignment. Callers MUST pre-assign stable nodeIds;
  // see JSDoc above for why relying on this fallback produces incorrect results.
  const clone = (v: unknown) => structuredClone(v);
  const base = ensureNodeIds(baseRaw.map(clone));
  const local = ensureNodeIds(localRaw.map(clone));
  const remote = ensureNodeIds(remoteRaw.map(clone));

  const baseMap = buildNodeMap(base);
  const localMap = buildNodeMap(local);
  const remoteMap = buildNodeMap(remote);

  const baseOrder = buildOrderList(base);
  const localOrder = buildOrderList(local);
  const remoteOrder = buildOrderList(remote);

  const allIds = new Set([...baseOrder, ...localOrder, ...remoteOrder]);

  const conflicts: PlateNodeConflict[] = [];
  // Collect the final set of nodes (keyed by nodeId) before ordering
  const mergedMap = new Map<string, PlateNode>();
  // Track which IDs are deleted in the merged result
  const deletedIds = new Set<string>();

  for (const id of allIds) {
    const inBase = baseMap.has(id);
    const inLocal = localMap.has(id);
    const inRemote = remoteMap.has(id);

    const baseNode = baseMap.get(id) ?? null;
    const localNode = localMap.get(id) ?? null;
    const remoteNode = remoteMap.get(id) ?? null;

    // --- Addition ---
    if (!inBase && inLocal && !inRemote) {
      // Added only in local
      mergedMap.set(id, localNode as PlateNode);
      continue;
    }
    if (!inBase && !inLocal && inRemote) {
      // Added only in remote
      mergedMap.set(id, remoteNode as PlateNode);
      continue;
    }
    if (!inBase && inLocal && inRemote) {
      // Added in both — if identical keep one copy; otherwise it's a conflict
      // (default to local while awaiting user resolution).
      // If they're identical, keep one
      if (nodeContentEqual(localNode, remoteNode)) {
        mergedMap.set(id, remoteNode as PlateNode);
      } else {
        // Both added the same nodeId with different content — conflict
        conflicts.push({
          nodeId: id,
          conflictType: "modified_both",
          base: null,
          local: localNode,
          remote: remoteNode,
          displayLabel: nodeDisplayLabel(localNode ?? remoteNode),
        });
        // Default: keep local for conflicts
        mergedMap.set(id, localNode as PlateNode);
      }
      continue;
    }

    // --- Deletion ---
    if (inBase && !inLocal && !inRemote) {
      // Deleted by both — agree on deletion
      deletedIds.add(id);
      continue;
    }
    if (inBase && !inLocal && inRemote) {
      // Deleted by local
      if (nodeContentEqual(baseNode, remoteNode)) {
        // Remote didn't change, local deleted → delete
        deletedIds.add(id);
      } else {
        // Remote modified, local deleted → conflict
        conflicts.push({
          nodeId: id,
          conflictType: "deleted_vs_modified",
          base: baseNode,
          local: null,
          remote: remoteNode,
          displayLabel: nodeDisplayLabel(remoteNode ?? baseNode),
        });
        // Default: keep remote (don't delete modified node)
        mergedMap.set(id, remoteNode as PlateNode);
      }
      continue;
    }
    if (inBase && inLocal && !inRemote) {
      // Deleted by remote
      if (nodeContentEqual(baseNode, localNode)) {
        // Local didn't change, remote deleted → delete
        deletedIds.add(id);
      } else {
        // Local modified, remote deleted → conflict
        conflicts.push({
          nodeId: id,
          conflictType: "deleted_vs_modified",
          base: baseNode,
          local: localNode,
          remote: null,
          displayLabel: nodeDisplayLabel(localNode ?? baseNode),
        });
        // Default: keep local (don't delete modified node)
        mergedMap.set(id, localNode as PlateNode);
      }
      continue;
    }

    // --- Both present (base, local, remote all exist) ---
    if (inBase && inLocal && inRemote) {
      const localChanged = !nodeContentEqual(baseNode, localNode);
      const remoteChanged = !nodeContentEqual(baseNode, remoteNode);

      if (!localChanged && !remoteChanged) {
        // Neither changed
        mergedMap.set(id, baseNode as PlateNode);
      } else if (localChanged && !remoteChanged) {
        // Only local changed
        mergedMap.set(id, localNode as PlateNode);
      } else if (!localChanged && remoteChanged) {
        // Only remote changed
        mergedMap.set(id, remoteNode as PlateNode);
      } else {
        // Both changed
        if (nodeContentEqual(localNode, remoteNode)) {
          // Same change — no conflict
          mergedMap.set(id, localNode as PlateNode);
        } else {
          // Different changes — conflict
          conflicts.push({
            nodeId: id,
            conflictType: "modified_both",
            base: baseNode,
            local: localNode,
            remote: remoteNode,
            displayLabel: nodeDisplayLabel(localNode),
          });
          // Default: keep local for conflicts
          mergedMap.set(id, localNode as PlateNode);
        }
      }
    }
  }

  // --- Ordering ---
  // Use remote order as the base, then insert local-only additions
  // at their original relative positions.
  const merged = mergeOrder(
    baseOrder,
    localOrder,
    remoteOrder,
    mergedMap,
    deletedIds,
  );

  return {
    merged,
    hasConflict: conflicts.length > 0,
    conflicts,
  };
}

/**
 * Merge node ordering from base, local, and remote.
 *
 * Strategy:
 * - Start with remote order (it's the latest server state)
 * - Insert local-only additions at their original position relative to
 *   neighboring nodes that also exist in the merged set
 * - Remove deleted nodes
 */
function mergeOrder(
  baseOrder: string[],
  localOrder: string[],
  remoteOrder: string[],
  mergedMap: Map<string, PlateNode>,
  deletedIds: Set<string>,
): unknown[] {
  const baseSet = new Set(baseOrder);
  const remoteSet = new Set(remoteOrder);

  // Identify nodes added only in local (not in base or remote)
  const localOnlyAdded: string[] = [];
  for (const id of localOrder) {
    if (!baseSet.has(id) && !remoteSet.has(id) && mergedMap.has(id)) {
      localOnlyAdded.push(id);
    }
  }

  // Start with remote order, filtering out deleted nodes
  const result: unknown[] = [];
  const placed = new Set<string>();

  for (const id of remoteOrder) {
    if (deletedIds.has(id)) continue;
    const node = mergedMap.get(id);
    if (node) {
      result.push(node);
      placed.add(id);
    }
  }

  // Insert local-only additions. For each, find the best position:
  // look at the node that preceded it in localOrder and insert after that.
  // Build lookup maps for O(1) index resolution.
  const positionMap = new Map<string, number>();
  for (let i = 0; i < result.length; i++) {
    const id = getNodeId(result[i]);
    if (id) positionMap.set(id, i);
  }
  const localOrderIndexMap = new Map<string, number>();
  for (let i = 0; i < localOrder.length; i++) {
    const lid = localOrder[i];
    if (lid !== undefined) localOrderIndexMap.set(lid, i);
  }

  for (const addedId of localOnlyAdded) {
    if (placed.has(addedId)) continue;
    const node = mergedMap.get(addedId);
    if (!node) continue;

    const localIdx = localOrderIndexMap.get(addedId) ?? -1;
    let insertIdx = result.length; // default: append at end

    // Walk backward in localOrder to find the preceding node that exists in result
    for (let i = localIdx - 1; i >= 0; i--) {
      const prevId = localOrder[i];
      if (prevId !== undefined && positionMap.has(prevId)) {
        insertIdx = (positionMap.get(prevId) as number) + 1;
        break;
      }
    }

    result.splice(insertIdx, 0, node);
    placed.add(addedId);
    // Incremental update: only shift entries at indices >= insertIdx
    for (const [nid, idx] of positionMap) {
      if (idx >= insertIdx) positionMap.set(nid, idx + 1);
    }
    positionMap.set(addedId, insertIdx);
  }

  // Insert nodes that were in base, kept/modified by local, but deleted by
  // remote (e.g. "deleted_vs_modified" conflicts). These aren't in remoteOrder
  // and aren't "local-only added", so they need their own placement pass using
  // the same neighbour-walk logic based on local position.
  const localKeptFromBase: string[] = [];
  for (const id of localOrder) {
    if (
      baseSet.has(id) &&
      !remoteSet.has(id) &&
      mergedMap.has(id) &&
      !placed.has(id)
    ) {
      localKeptFromBase.push(id);
    }
  }

  for (const keptId of localKeptFromBase) {
    const node = mergedMap.get(keptId);
    if (!node) continue;

    const localIdx = localOrderIndexMap.get(keptId) ?? -1;
    let insertIdx = result.length;

    for (let i = localIdx - 1; i >= 0; i--) {
      const prevId = localOrder[i];
      if (prevId !== undefined && positionMap.has(prevId)) {
        insertIdx = (positionMap.get(prevId) as number) + 1;
        break;
      }
    }

    result.splice(insertIdx, 0, node);
    placed.add(keptId);
    for (const [nid, idx] of positionMap) {
      if (idx >= insertIdx) positionMap.set(nid, idx + 1);
    }
    positionMap.set(keptId, insertIdx);
  }

  // Also add any remaining nodes in mergedMap that weren't placed
  // (e.g., nodes added in both local and remote with same nodeId)
  for (const [id, node] of mergedMap) {
    if (!placed.has(id) && !deletedIds.has(id)) {
      result.push(node);
    }
  }

  return result;
}

/**
 * Apply conflict resolutions to a merge result.
 *
 * Takes the original merge result and a map of nodeId → chosen version
 * ("local" or "remote"), and returns a new node array with the resolutions
 * applied.
 */
export function applyConflictResolutions(
  mergeResult: MergePlateResult,
  resolutions: Record<string, "local" | "remote">,
): unknown[] {
  // Build a lookup map for O(1) conflict resolution instead of O(M×C) scan
  const conflictMap = new Map(mergeResult.conflicts.map((c) => [c.nodeId, c]));

  const resolved = mergeResult.merged.map((node) => {
    const id = getNodeId(node);
    if (!id) return node;

    const conflict = conflictMap.get(id);
    if (!conflict) return node;

    const choice = resolutions[id];
    if (!choice) return node; // unresolved — keep mergedMap default

    if (choice === "local") {
      // For "deleted_vs_modified" where local=null, we need to remove the node
      if (conflict.local === null) return null;
      return conflict.local;
    }
    // choice === "remote"
    if (conflict.remote === null) return null;
    return conflict.remote;
  });

  // Filter out nulls (nodes that were resolved to "delete")
  return resolved.filter((n) => n !== null);
}
