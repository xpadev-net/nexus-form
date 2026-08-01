import type { ResponseRelationGraphResponse } from "@nexus-form/shared";
import { isAggregateOnlyLink } from "@nexus-form/shared";
import { useQuery } from "@tanstack/react-query";
import {
  type Force,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { AlertTriangle, Link2, Loader2, Network, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { client, rpc } from "@/lib/api";
import { formatJapanLocaleDateTime } from "@/lib/formatters";
import { ResponseDetailView } from "./response-detail-view";
import { ResponseSuspicionGroups } from "./response-suspicion-groups";

type ResponseRelationGraphProps = {
  formId: string;
  canManageResponses: boolean;
};

type GraphNode = ResponseRelationGraphResponse["nodes"][number];
type GraphEdge = ResponseRelationGraphResponse["edges"][number];
type DenseCluster = ResponseRelationGraphResponse["denseClusters"][number];

/**
 * A d3-force simulation node backing one rendered graph node. `id` is the
 * response id (or `cluster:<id>` for a dense-cluster hub). `node` is the API
 * response data, `null` for hub nodes. `hidden` hub nodes exist purely to
 * pull dense-cluster members together via links and are never rendered.
 * `x`/`y`/`vx`/`vy`/`fx`/`fy` (from `SimulationNodeDatum`) are graph
 * coordinates mutated in place by the simulation each tick.
 */
export type LayoutNode = SimulationNodeDatum & {
  id: string;
  node: GraphNode | null;
  hidden: boolean;
  clusterId?: string;
  /** Number of responses merged into this node (responses whose answers are
   * identical apart from `submittedAt`). 1 (or undefined) for an ordinary
   * single-response node. */
  memberCount?: number;
  /** responseIds of every response merged into this node, `node.responseId`
   * (the representative) included. */
  memberResponseIds?: string[];
};

type LayoutLink = SimulationLinkDatum<LayoutNode> & {
  /** A real (unmodified) edge representing this line visually — the
   * strongest of `collapsedEdges` when more than one original edge
   * collapsed onto this pair, so styling never depends on fabricated data.
   * `null` only for hidden dense-cluster hub links, which are never
   * rendered as a visible line. */
  edge: GraphEdge | null;
  /** Every original edge that collapsed onto this pair (length 1 when no
   * merging occurred, empty for hidden hub links). Each entry keeps its own
   * true endpoints/evidence — nothing here is combined or rewritten, so the
   * evidence popup can show exactly what was actually found without
   * misattributing one pair's relation to another. */
  collapsedEdges: GraphEdge[];
  cluster: DenseCluster | null;
  sourceId: string;
  targetId: string;
};

type PositionedLayoutNode = LayoutNode & { x: number; y: number };

type PositionedLayoutLink = LayoutLink & {
  edge: GraphEdge;
  source: PositionedLayoutNode;
  target: PositionedLayoutNode;
};

/** A point in graph/simulation coordinate space (unaffected by pan/zoom). */
type GraphPoint = { x: number; y: number };

/** The canvas's pan/zoom state: translate (`x`, `y`) then scale (`k`). */
type Camera = { x: number; y: number; k: number };

const graphKeyboardPanStep = 56;
const cameraMinScale = 0.15;
const cameraMaxScale = 4;
const nodeDragThreshold = 4;
const nonRelationMinDistance = 90;
const nonRelationStrength = 0.6;
const groupCohesionStrength = 0.025;
const heavyGraphElementCount = 150;
const graphFocusMargin = 56;

const reasonLabels: Record<string, string> = {
  "hard:session": "同一セッション",
  "strong:telemetry:v6": "IPv6一致",
  "strong:visitorId-with-device-family": "visitorId + 独立端末特徴",
  "strong:respondentUuid-with-device": "回答者UUID + 端末特徴",
  "strong:multiple-device-families": "複数端末特徴",
  "support:visitorId": "visitorId一致",
  "support:device": "端末特徴一致",
  "support:telemetry:v4": "IPv4一致",
  "support:userAgent": "User-Agent一致",
  "support:respondentUuid": "回答者UUID一致",
  "dense:pair-links-omitted": "高密度クラスタ",
  "duplicate-content": "送信日時以外が同一の回答",
};

function reasonLabel(reasonCode: string): string {
  const mapped = reasonLabels[reasonCode];
  if (mapped) return mapped;
  if (reasonCode.startsWith("match:")) return reasonCode.replace("match:", "");
  return reasonCode;
}

function strengthLabel(strength: string): string {
  switch (strength) {
    case "HARD":
      return "確定的";
    case "STRONG":
      return "強い疑い";
    case "SUPPORT":
      return "補助";
    default:
      return "なし";
  }
}

function familyLabel(family: string): string {
  switch (family) {
    case "composite":
      return "複合ID";
    case "rendering":
      return "描画";
    case "fonts":
      return "フォント";
    case "display":
      return "画面";
    case "system":
      return "システム";
    case "hardware":
      return "ハードウェア";
    case "audio":
      return "音声";
    default:
      return family;
  }
}

function edgeStrokeClass(strength: string): string {
  switch (strength) {
    case "HARD":
      return "stroke-rose-600";
    case "STRONG":
      return "stroke-amber-600";
    case "SUPPORT":
      return "stroke-sky-500";
    default:
      return "stroke-muted-foreground";
  }
}

function edgeWidth(strength: string): number {
  switch (strength) {
    case "HARD":
      return 5;
    case "STRONG":
      return 2;
    case "SUPPORT":
      return 1;
    default:
      return 1;
  }
}

/** Per-tick link-force strength coefficient (0–1), ordered so HARD pulls the
 * hardest, STRONG noticeably weaker, and SUPPORT weaker still. */
function edgeLinkStrength(strength: string): number {
  switch (strength) {
    case "HARD":
      return 0.45;
    case "STRONG":
      return 0.18;
    case "SUPPORT":
      return 0.12;
    default:
      return 0.12;
  }
}

function strengthRank(strength: string): number {
  switch (strength) {
    case "HARD":
      return 3;
    case "STRONG":
      return 2;
    case "SUPPORT":
      return 1;
    default:
      return 0;
  }
}

function strongerStrength<T extends string>(a: T, b: T): T {
  return strengthRank(a) >= strengthRank(b) ? a : b;
}

/** Narrows a `GraphNode.strongestStrength` (which includes "NONE") down to
 * the visible-only strength used by `DenseCluster.strength`, treating "NONE"
 * as the weakest visible tier for display purposes. */
function toVisibleStrength(
  strength: GraphNode["strongestStrength"],
): DenseCluster["strength"] {
  switch (strength) {
    case "HARD":
      return "HARD";
    case "STRONG":
      return "STRONG";
    default:
      return "SUPPORT";
  }
}

/** Orders `edges` by strength then evidence, strongest last (used to pick a
 * single real edge to represent a collapsed group visually — stroke color,
 * width, hover title — without fabricating combined data attributed to a
 * pair the evidence doesn't actually describe). */
function isStrongerEdge(candidate: GraphEdge, current: GraphEdge): boolean {
  const rankDiff =
    strengthRank(candidate.strength) - strengthRank(current.strength);
  if (rankDiff !== 0) return rankDiff > 0;
  return candidate.deviceEvidence > current.deviceEvidence;
}

/** Picks the strongest edge among several original edges that collapsed
 * onto the same pair of merged nodes, ordering ties by declaration order.
 * The pick is used only for the line's visual styling — every collapsed
 * edge is still shown, unmodified and separately, in its evidence popup.
 * Takes a non-empty tuple so the result is provably defined without a cast. */
function strongestOf(collapsedEdges: [GraphEdge, ...GraphEdge[]]): GraphEdge {
  let strongest = collapsedEdges[0];
  for (const edge of collapsedEdges) {
    if (isStrongerEdge(edge, strongest)) strongest = edge;
  }
  return strongest;
}

function edgeKey(edge: GraphEdge): string {
  return `${edge.responseIdA}:${edge.responseIdB}`;
}

function edgeTitle(edge: GraphEdge): string {
  return [
    `${responseShortId(edge.responseIdA)} / ${responseShortId(edge.responseIdB)}`,
    ...edge.reasonCodes.map(reasonLabel),
    ...edge.familyContributions.flatMap((family) =>
      family.reasonCodes.map(
        (reason) => `${familyLabel(family.family)}: ${reasonLabel(reason)}`,
      ),
    ),
  ].join(" / ");
}

function nodeFillClass(strength: string, selected: boolean): string {
  if (selected) return "fill-primary";
  switch (strength) {
    case "HARD":
      return "fill-rose-600";
    case "STRONG":
      return "fill-amber-600";
    case "SUPPORT":
      return "fill-sky-600";
    default:
      return "fill-muted-foreground";
  }
}

const nodeMaxRadiusGrowth = 16;

/** Base circle radius for a node representing `memberCount` merged
 * responses — grows sub-linearly so a handful of extra members is visible
 * without letting very large groups dominate the layout. */
function nodeBaseRadius(memberCount: number): number {
  if (memberCount <= 1) return 9;
  return 9 + Math.min(nodeMaxRadiusGrowth, Math.sqrt(memberCount - 1) * 4);
}

function responseShortId(responseId: string): string {
  return responseId.slice(0, 8);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Adjacency set (by node id) used to exempt already-linked pairs from `forceMinSeparation`. */
export type LinkedNeighbors = Map<string, Set<string>>;

/** Records `a` and `b` as linked in both directions of `neighbors`. */
export function addLinkedPair(
  neighbors: LinkedNeighbors,
  a: string,
  b: string,
): void {
  let neighborsOfA = neighbors.get(a);
  if (!neighborsOfA) {
    neighborsOfA = new Set();
    neighbors.set(a, neighborsOfA);
  }
  neighborsOfA.add(b);
  let neighborsOfB = neighbors.get(b);
  if (!neighborsOfB) {
    neighborsOfB = new Set();
    neighbors.set(b, neighborsOfB);
  }
  neighborsOfB.add(a);
}

function isPositionedNode(node: LayoutNode): node is PositionedLayoutNode {
  return typeof node.x === "number" && typeof node.y === "number";
}

/**
 * A d3-force `Force` that pushes apart any two nodes NOT present in
 * `linkedNeighbors` once they get closer than `options.minDistance` (graph
 * coordinate units) — and applies no force at all once they clear that
 * distance. Because the repulsion has a hard cutoff instead of decaying
 * indefinitely like `forceManyBody`, unrelated clusters settle at a bounded
 * distance apart rather than drifting away from each other forever.
 * `options.strength` is a d3-force-style per-tick velocity coefficient
 * (0–1), not a physical unit.
 */
export function forceMinSeparation(
  linkedNeighbors: LinkedNeighbors,
  options: { minDistance: number; strength: number },
): Force<LayoutNode, LayoutLink> {
  let nodes: LayoutNode[] = [];
  function force(alpha: number) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (!a || typeof a.x !== "number" || typeof a.y !== "number") continue;
      const neighborsOfA = linkedNeighbors.get(a.id);
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (!b || typeof b.x !== "number" || typeof b.y !== "number") continue;
        if (neighborsOfA?.has(b.id)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        if (dist >= options.minDistance) continue;
        const push =
          ((options.minDistance - dist) / dist) * options.strength * alpha;
        const ox = dx * push;
        const oy = dy * push;
        a.vx = (a.vx ?? 0) - ox;
        a.vy = (a.vy ?? 0) - oy;
        b.vx = (b.vx ?? 0) + ox;
        b.vy = (b.vy ?? 0) + oy;
      }
    }
  }
  force.initialize = (initializedNodes: LayoutNode[]) => {
    nodes = initializedNodes;
  };
  return force;
}

/**
 * A d3-force `Force` that gently pulls every node in `components` toward
 * that component's current centroid. `components` maps an arbitrary
 * representative id to the (non-hidden) node ids of one connected component
 * of the evidence graph — i.e. one suspicion group — for every component
 * with 2+ members. Unlike the `link` force (which only pulls directly
 * linked pairs together), this keeps a whole group visually near each
 * other even when two of its members are related only through a chain of
 * other responses, without needing a rest distance of its own — the `link`,
 * `charge`, and `collide` forces still decide the group's internal layout.
 */
export function forceGroupCohesion(
  components: Map<string, string[]>,
  options: { strength: number },
): Force<LayoutNode, LayoutLink> {
  let nodesById = new Map<string, LayoutNode>();
  function force(alpha: number) {
    for (const members of components.values()) {
      let cx = 0;
      let cy = 0;
      let count = 0;
      for (const id of members) {
        const node = nodesById.get(id);
        if (!node || typeof node.x !== "number" || typeof node.y !== "number")
          continue;
        cx += node.x;
        cy += node.y;
        count += 1;
      }
      if (count < 2) continue;
      cx /= count;
      cy /= count;
      for (const id of members) {
        const node = nodesById.get(id);
        if (!node || typeof node.x !== "number" || typeof node.y !== "number")
          continue;
        node.vx = (node.vx ?? 0) + (cx - node.x) * options.strength * alpha;
        node.vy = (node.vy ?? 0) + (cy - node.y) * options.strength * alpha;
      }
    }
  }
  force.initialize = (initializedNodes: LayoutNode[]) => {
    nodesById = new Map(initializedNodes.map((node) => [node.id, node]));
  };
  return force;
}

function orientation(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): -1 | 0 | 1 {
  const value = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : -1;
}

function onSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  return (
    Math.min(ax, cx) <= bx &&
    bx <= Math.max(ax, cx) &&
    Math.min(ay, cy) <= by &&
    by <= Math.max(ay, cy)
  );
}

/** True if segment (x1,y1)-(x2,y2) crosses segment (x3,y3)-(x4,y4), using the
 * standard orientation-test line-segment intersection algorithm. */
function segmentsIntersect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
): boolean {
  const o1 = orientation(x1, y1, x2, y2, x3, y3);
  const o2 = orientation(x1, y1, x2, y2, x4, y4);
  const o3 = orientation(x3, y3, x4, y4, x1, y1);
  const o4 = orientation(x3, y3, x4, y4, x2, y2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(x1, y1, x3, y3, x2, y2)) return true;
  if (o2 === 0 && onSegment(x1, y1, x4, y4, x2, y2)) return true;
  if (o3 === 0 && onSegment(x3, y3, x1, y1, x4, y4)) return true;
  if (o4 === 0 && onSegment(x3, y3, x2, y2, x4, y4)) return true;
  return false;
}

// Above this many links the O(E²) pairwise crossing check gets too costly to
// run every tick, so the force is skipped entirely for very dense graphs.
const edgeCrossingLinkLimit = 260;

/**
 * A d3-force `Force` that nudges the endpoints of two link segments apart
 * whenever those segments currently cross, so unrelated edges settle beside
 * each other instead of visually overlapping. Links sharing an endpoint are
 * skipped (they legitimately meet at that shared node). Unlike
 * `forceMinSeparation`, this operates on link endpoints directly rather than
 * through d3's node-only `Force.initialize`, so it reads `layoutLinks` from
 * closure — it must be re-created (and re-registered) whenever the link
 * array changes, and must be registered after the `link` force so
 * `link.source`/`link.target` have already been resolved to node objects.
 */
function forceEdgeCrossingRepulsion(
  layoutLinks: LayoutLink[],
  options: { strength: number },
): Force<LayoutNode, LayoutLink> {
  function force(alpha: number) {
    if (layoutLinks.length > edgeCrossingLinkLimit) return;
    for (let i = 0; i < layoutLinks.length; i++) {
      const linkA = layoutLinks[i];
      if (!linkA) continue;
      const aSource = linkA.source;
      const aTarget = linkA.target;
      if (typeof aSource !== "object" || typeof aTarget !== "object") continue;
      if (typeof aSource.x !== "number" || typeof aSource.y !== "number")
        continue;
      if (typeof aTarget.x !== "number" || typeof aTarget.y !== "number")
        continue;
      for (let j = i + 1; j < layoutLinks.length; j++) {
        const linkB = layoutLinks[j];
        if (!linkB) continue;
        const bSource = linkB.source;
        const bTarget = linkB.target;
        if (typeof bSource !== "object" || typeof bTarget !== "object")
          continue;
        if (typeof bSource.x !== "number" || typeof bSource.y !== "number")
          continue;
        if (typeof bTarget.x !== "number" || typeof bTarget.y !== "number")
          continue;
        if (
          aSource === bSource ||
          aSource === bTarget ||
          aTarget === bSource ||
          aTarget === bTarget
        )
          continue;
        if (
          !segmentsIntersect(
            aSource.x,
            aSource.y,
            aTarget.x,
            aTarget.y,
            bSource.x,
            bSource.y,
            bTarget.x,
            bTarget.y,
          )
        )
          continue;
        const dx = aTarget.x - aSource.x;
        const dy = aTarget.y - aSource.y;
        const length = Math.hypot(dx, dy) || 1;
        const nx = -dy / length;
        const ny = dx / length;
        const push = options.strength * alpha;
        aSource.vx = (aSource.vx ?? 0) - nx * push;
        aSource.vy = (aSource.vy ?? 0) - ny * push;
        aTarget.vx = (aTarget.vx ?? 0) - nx * push;
        aTarget.vy = (aTarget.vy ?? 0) - ny * push;
        bSource.vx = (bSource.vx ?? 0) + nx * push;
        bSource.vy = (bSource.vy ?? 0) + ny * push;
        bTarget.vx = (bTarget.vx ?? 0) + nx * push;
        bTarget.vy = (bTarget.vy ?? 0) + ny * push;
      }
    }
  }
  force.initialize = () => {};
  return force;
}

function readSnapshot(
  layoutNodes: LayoutNode[],
  layoutLinks: LayoutLink[],
): { nodes: PositionedLayoutNode[]; links: PositionedLayoutLink[] } {
  return {
    nodes: layoutNodes.filter(
      (node): node is PositionedLayoutNode =>
        !node.hidden && isPositionedNode(node),
    ),
    links: layoutLinks.filter((link): link is PositionedLayoutLink => {
      if (link.edge === null) return false;
      const source = link.source;
      const target = link.target;
      if (typeof source !== "object" || typeof target !== "object")
        return false;
      return isPositionedNode(source) && isPositionedNode(target);
    }),
  };
}

type ForceGraphLayout = {
  nodes: PositionedLayoutNode[];
  links: PositionedLayoutLink[];
  beginDrag: (id: string) => void;
  dragNodeTo: (id: string, x: number, y: number) => void;
  endDrag: (id: string) => void;
};

/**
 * Groups every id in `nodeIds` into a connected component (returned as
 * nodeId -> arbitrary root id), following the exact same "identity-anchored"
 * suspicion-group definition as `buildResponseSuspicionGroups` in
 * packages/shared: a pair-edge only unions its two responses if it's HARD,
 * or STRONG that isn't merely aggregate device-family similarity
 * (`isAggregateOnlyLink`). SUPPORT-only edges must NOT union responses here
 * — that function deliberately excludes them so a chain of coincidentally
 * similar device profiles (e.g. everyone on a school computer lab's
 * network) doesn't visually balloon into what looks like one confirmed
 * group. Dense-cluster hub links (`link.cluster` set, `link.edge` null)
 * always union their members — that grouping is a separate, already-vetted
 * server-side decision, not a SUPPORT-chain artifact.
 */
export function computeSuspicionGroupComponents(
  nodeIds: string[],
  links: {
    sourceId: string;
    targetId: string;
    edge: GraphEdge | null;
    cluster: DenseCluster | null;
  }[],
): Map<string, string> {
  const parent = new Map<string, string>();
  for (const id of nodeIds) parent.set(id, id);
  function find(id: string): string {
    const parentId = parent.get(id) ?? id;
    if (parentId === id) return id;
    const root = find(parentId);
    parent.set(id, root);
    return root;
  }
  for (const link of links) {
    if (!link.cluster) {
      const strength = link.edge?.strength ?? "NONE";
      const isIdentityAnchored =
        strength === "HARD" ||
        (strength === "STRONG" &&
          !!link.edge &&
          !isAggregateOnlyLink(link.edge));
      if (!isIdentityAnchored) continue;
    }
    const rootA = find(link.sourceId);
    const rootB = find(link.targetId);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }
  const result = new Map<string, string>();
  for (const id of nodeIds) result.set(id, find(id));
  return result;
}

function useForceGraphLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  denseClusters: DenseCluster[],
): ForceGraphLayout {
  const simulationRef = useRef<Simulation<LayoutNode, LayoutLink> | null>(null);
  const nodesByIdRef = useRef(new Map<string, LayoutNode>());
  const tickCountRef = useRef(0);
  const [snapshot, setSnapshot] = useState<{
    nodes: PositionedLayoutNode[];
    links: PositionedLayoutLink[];
  }>({ nodes: [], links: [] });

  useEffect(() => {
    const nodesById = nodesByIdRef.current;
    const nextIds = new Set<string>();

    // Responses whose answers are identical apart from `submittedAt` (same
    // `contentHash`) collapse onto a single visual node, sized by member
    // count. `responseIdToRepresentative` maps every original responseId
    // (including the representative itself) to that node's id, so edges and
    // dense-cluster membership below can be rewired onto the merged nodes.
    const groupsByContentHash = new Map<string, GraphNode[]>();
    for (const node of nodes) {
      const group = groupsByContentHash.get(node.contentHash);
      if (group) group.push(node);
      else groupsByContentHash.set(node.contentHash, [node]);
    }
    const responseIdToRepresentative = new Map<string, string>();
    const nodeGroups: { representative: GraphNode; members: GraphNode[] }[] =
      [];
    for (const members of groupsByContentHash.values()) {
      const sortedMembers = [...members].sort((a, b) =>
        a.responseId.localeCompare(b.responseId),
      );
      const representative = sortedMembers[0];
      if (!representative) continue;
      for (const member of sortedMembers) {
        responseIdToRepresentative.set(
          member.responseId,
          representative.responseId,
        );
      }
      nodeGroups.push({ representative, members: sortedMembers });
    }

    const layoutNodes: LayoutNode[] = nodeGroups.map(
      ({ representative, members }, index) => {
        nextIds.add(representative.responseId);
        let strongestEvidence = representative.strongestEvidence;
        let strongestStrength = representative.strongestStrength;
        for (const member of members) {
          strongestEvidence = Math.max(
            strongestEvidence,
            member.strongestEvidence,
          );
          strongestStrength = strongerStrength(
            strongestStrength,
            member.strongestStrength,
          );
        }
        const aggregatedNode: GraphNode = {
          ...representative,
          strongestEvidence,
          strongestStrength,
        };
        const memberResponseIds = members.map((member) => member.responseId);
        const existing = nodesById.get(representative.responseId);
        if (existing) {
          existing.node = aggregatedNode;
          existing.hidden = false;
          existing.clusterId = undefined;
          existing.memberCount = members.length;
          existing.memberResponseIds = memberResponseIds;
          return existing;
        }
        const angle = (index / Math.max(1, nodeGroups.length)) * Math.PI * 2;
        const created: LayoutNode = {
          id: representative.responseId,
          node: aggregatedNode,
          hidden: false,
          memberCount: members.length,
          memberResponseIds,
          x: Math.cos(angle) * 120,
          y: Math.sin(angle) * 120,
        };
        nodesById.set(representative.responseId, created);
        return created;
      },
    );

    const linkedNeighbors: LinkedNeighbors = new Map();
    // Multiple original edges can land on the same pair of merged nodes;
    // group them under that pair (rather than fabricating one combined edge,
    // which would misattribute evidence to a pair it was never actually
    // found for) so the popup can later show each real edge separately.
    const collapsedEdgesByPair = new Map<
      string,
      {
        edges: [GraphEdge, ...GraphEdge[]];
        sourceId: string;
        targetId: string;
      }
    >();
    for (const edge of edges) {
      const sourceId = responseIdToRepresentative.get(edge.responseIdA);
      const targetId = responseIdToRepresentative.get(edge.responseIdB);
      if (!sourceId || !targetId) continue;
      if (!nextIds.has(sourceId) || !nextIds.has(targetId)) continue;
      // Both endpoints merged into the same node — nothing to draw.
      if (sourceId === targetId) continue;
      const pairKey =
        sourceId < targetId
          ? `${sourceId} ${targetId}`
          : `${targetId} ${sourceId}`;
      const existing = collapsedEdgesByPair.get(pairKey);
      if (existing) {
        existing.edges.push(edge);
      } else {
        collapsedEdgesByPair.set(pairKey, {
          edges: [edge],
          sourceId,
          targetId,
        });
      }
    }
    const layoutLinks: LayoutLink[] = [...collapsedEdgesByPair.values()].map(
      ({ edges: collapsedEdges, sourceId, targetId }) => {
        addLinkedPair(linkedNeighbors, sourceId, targetId);
        return {
          source: sourceId,
          target: targetId,
          sourceId,
          targetId,
          edge: strongestOf(collapsedEdges),
          collapsedEdges,
          cluster: null,
        };
      },
    );

    for (const cluster of denseClusters) {
      const memberIds = [
        ...new Set(
          cluster.responseIds
            .map((responseId) => responseIdToRepresentative.get(responseId))
            .filter(
              (responseId): responseId is string =>
                !!responseId && nextIds.has(responseId),
            ),
        ),
      ];
      if (memberIds.length < 2) continue;
      const hubId = `cluster:${cluster.id}`;
      nextIds.add(hubId);
      let hub = nodesById.get(hubId);
      if (!hub) {
        hub = {
          id: hubId,
          node: null,
          hidden: true,
          clusterId: cluster.id,
          x: 0,
          y: 0,
        };
        nodesById.set(hubId, hub);
      }
      hub.hidden = true;
      hub.clusterId = cluster.id;
      layoutNodes.push(hub);
      for (const responseId of memberIds) {
        addLinkedPair(linkedNeighbors, hubId, responseId);
        layoutLinks.push({
          source: hubId,
          target: responseId,
          sourceId: hubId,
          targetId: responseId,
          edge: null,
          collapsedEdges: [],
          cluster,
        });
      }
      // Members of the same dense cluster are pulled together by the hub
      // link, so they must also be exempt from the min-separation force —
      // otherwise the two forces fight each other and the cluster never
      // settles.
      for (let i = 0; i < memberIds.length; i++) {
        const memberA = memberIds[i];
        if (!memberA) continue;
        for (let j = i + 1; j < memberIds.length; j++) {
          const memberB = memberIds[j];
          if (!memberB) continue;
          addLinkedPair(linkedNeighbors, memberA, memberB);
        }
      }
    }

    for (const id of Array.from(nodesById.keys())) {
      if (!nextIds.has(id)) nodesById.delete(id);
    }

    // Two responses in the same suspicion group but linked only indirectly
    // through qualifying edges — e.g. A-B by one edge, B-C by another, with
    // no A-C edge — still belong together and should end up near each
    // other, so `groupMembers` (via `computeSuspicionGroupComponents`)
    // collects each component's non-hidden member ids for use both as an
    // exemption from `forceMinSeparation` (below, mirroring the
    // dense-cluster exemption above) and as `forceGroupCohesion`'s pull
    // toward the shared centroid.
    const nodeComponents = computeSuspicionGroupComponents(
      layoutNodes.map((node) => node.id),
      layoutLinks,
    );
    const groupMembers = new Map<string, string[]>();
    for (const node of layoutNodes) {
      if (node.hidden) continue;
      const root = nodeComponents.get(node.id) ?? node.id;
      const members = groupMembers.get(root);
      if (members) members.push(node.id);
      else groupMembers.set(root, [node.id]);
    }
    for (const [root, members] of groupMembers) {
      if (members.length < 2) {
        groupMembers.delete(root);
        continue;
      }
      for (let i = 0; i < members.length; i++) {
        const memberA = members[i];
        if (!memberA) continue;
        for (let j = i + 1; j < members.length; j++) {
          const memberB = members[j];
          if (!memberB) continue;
          addLinkedPair(linkedNeighbors, memberA, memberB);
        }
      }
    }

    // A node connected by many SUPPORT edges (5, 10+ — common for shared
    // device/telemetry evidence) would otherwise be pulled by the sum of
    // every one of those edges' strength, clumping loosely-related nodes
    // together far harder than a single SUPPORT edge ever should. Dividing
    // each SUPPORT edge's strength by the higher of its two endpoints'
    // SUPPORT-degree keeps the *total* pull on a node from any number of
    // SUPPORT edges roughly bounded, matching how STRONG/HARD edges (rare
    // enough in practice not to need this) already behave.
    const supportDegree = new Map<string, number>();
    for (const link of layoutLinks) {
      if (link.cluster || link.edge?.strength !== "SUPPORT") continue;
      supportDegree.set(
        link.sourceId,
        (supportDegree.get(link.sourceId) ?? 0) + 1,
      );
      supportDegree.set(
        link.targetId,
        (supportDegree.get(link.targetId) ?? 0) + 1,
      );
    }

    let simulation = simulationRef.current;
    if (!simulation) {
      simulation = forceSimulation<LayoutNode, LayoutLink>();
      simulationRef.current = simulation;
    }

    simulation
      .nodes(layoutNodes)
      .force(
        "link",
        forceLink<LayoutNode, LayoutLink>(layoutLinks)
          .id((node) => node.id)
          .distance((link) => (link.cluster ? 44 : 96))
          .strength((link) => {
            if (link.cluster) return 0.7;
            const strength = link.edge?.strength ?? "NONE";
            const base = edgeLinkStrength(strength);
            if (strength !== "SUPPORT") return base;
            // The *higher* of the two endpoints' SUPPORT-degree, not the
            // lower: a hub node connected to 10 leaves each has its own
            // degree of 10 while every leaf's degree is 1, so dividing by
            // the min (matching d3-force's own default bias) would leave
            // every one of the hub's 10 edges at full strength — its total
            // pull would stay exactly as unbounded as before. Dividing by
            // the max instead caps the hub's summed pull at roughly one
            // edge's worth, regardless of how many SUPPORT edges it has.
            const degree = Math.max(
              1,
              supportDegree.get(link.sourceId) ?? 1,
              supportDegree.get(link.targetId) ?? 1,
            );
            return base / degree;
          }),
      )
      .force(
        "charge",
        forceManyBody<LayoutNode>().strength(-110).distanceMax(200),
      )
      .force("x", forceX<LayoutNode>(0).strength(0.02))
      .force("y", forceY<LayoutNode>(0).strength(0.02))
      .force(
        "collide",
        forceCollide<LayoutNode>().radius(
          (node) => nodeBaseRadius(node.memberCount ?? 1) + 15,
        ),
      )
      .force(
        "minSeparation",
        forceMinSeparation(linkedNeighbors, {
          minDistance: nonRelationMinDistance,
          strength: nonRelationStrength,
        }),
      )
      .force(
        "groupCohesion",
        forceGroupCohesion(groupMembers, { strength: groupCohesionStrength }),
      )
      .force(
        "edgeCrossing",
        forceEdgeCrossingRepulsion(layoutLinks, { strength: 1.5 }),
      )
      .alphaDecay(0.02)
      .alpha(Math.max(simulation.alpha(), 0.5))
      .on("tick", () => {
        tickCountRef.current += 1;
        const isHeavyGraph =
          layoutNodes.length + layoutLinks.length > heavyGraphElementCount;
        if (isHeavyGraph && tickCountRef.current % 2 !== 0) return;
        setSnapshot(readSnapshot(layoutNodes, layoutLinks));
      })
      .restart();

    setSnapshot(readSnapshot(layoutNodes, layoutLinks));
  }, [nodes, edges, denseClusters]);

  useEffect(() => {
    return () => {
      simulationRef.current?.stop();
    };
  }, []);

  const beginDrag = (_id: string) => {
    simulationRef.current?.alphaTarget(0.3).restart();
  };

  const dragNodeTo = (id: string, x: number, y: number) => {
    const node = nodesByIdRef.current.get(id);
    if (!node) return;
    node.fx = x;
    node.fy = y;
  };

  const endDrag = (id: string) => {
    const node = nodesByIdRef.current.get(id);
    if (node) {
      node.fx = null;
      node.fy = null;
    }
    simulationRef.current?.alphaTarget(0);
  };

  return { ...snapshot, beginDrag, dragNodeTo, endDrag };
}

function EdgeEvidence({ edge }: { edge: GraphEdge }) {
  const familyReasons = edge.familyContributions.flatMap((family) =>
    family.reasonCodes.map((reason) => ({
      family: family.family,
      id: `${family.family}:${family.score}:${reason}`,
      reason,
      score: family.score,
    })),
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{strengthLabel(edge.strength)}</Badge>
        <span className="text-xs text-muted-foreground">
          device {edge.deviceEvidence.toFixed(3)}
        </span>
        {edge.v6Strong && <Badge variant="secondary">IPv6一致</Badge>}
        {edge.v4Support && <Badge variant="secondary">IPv4一致</Badge>}
        {edge.stateSupport && <Badge variant="secondary">状態一致</Badge>}
      </div>
      <div className="flex flex-wrap gap-1">
        {edge.reasonCodes.map((reason) => (
          <Badge key={reason} variant="secondary">
            {reasonLabel(reason)}
          </Badge>
        ))}
        {familyReasons.map((item) => (
          <Badge key={item.id} variant="outline" title={item.reason}>
            {familyLabel(item.family)} {reasonLabel(item.reason)}{" "}
            {item.score.toFixed(2)}
          </Badge>
        ))}
      </div>
    </div>
  );
}

type TooltipState =
  | {
      kind: "edge";
      edge: GraphEdge;
      collapsedCount: number;
      x: number;
      y: number;
    }
  | {
      kind: "node";
      node: GraphNode;
      memberCount: number;
      x: number;
      y: number;
    };

function CursorTooltip({ tooltip }: { tooltip: TooltipState }) {
  const offset = 14;
  const left = clamp(
    tooltip.x + offset,
    8,
    Math.max(8, window.innerWidth - 288),
  );
  const top = clamp(
    tooltip.y + offset,
    8,
    Math.max(8, window.innerHeight - 200),
  );
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-72 rounded-md border bg-popover p-2 text-xs shadow-lg"
      style={{ left, top }}
    >
      {tooltip.kind === "edge" ? (
        <div className="space-y-2">
          <p className="break-all font-mono text-[10px] text-muted-foreground">
            {responseShortId(tooltip.edge.responseIdA)} /{" "}
            {responseShortId(tooltip.edge.responseIdB)}
            {tooltip.collapsedCount > 1 ? " (代表)" : ""}
          </p>
          <EdgeEvidence edge={tooltip.edge} />
          {tooltip.collapsedCount > 1 && (
            <p className="text-[10px] text-muted-foreground">
              ほか{tooltip.collapsedCount - 1}件のリンクが集約されています
              (クリックで全件表示)
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <p className="font-mono text-[10px] text-muted-foreground">
            {responseShortId(tooltip.node.responseId)}
          </p>
          <p>強度: {strengthLabel(tooltip.node.strongestStrength)}</p>
          <p>送信: {formatJapanLocaleDateTime(tooltip.node.submittedAt)}</p>
          {tooltip.memberCount > 1 && (
            <p>同一内容の回答: {tooltip.memberCount}件</p>
          )}
        </div>
      )}
    </div>
  );
}

type ResponseRelationGraphCanvasProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  denseClusters: DenseCluster[];
  openResponseIds: Set<string>;
  /** Fired with every original edge collapsed onto the activated line (a
   * single-element array when the line represents just one real edge). */
  onSelectEdge: (edges: GraphEdge[]) => void;
  onSelectResponse: (responseId: string) => void;
  /** Called (in addition to `onSelectResponse`) when a merged node
   * representing more than one response is activated, so the sidebar can
   * surface the other same-content responses that would otherwise be
   * unreachable from the graph. */
  onSelectGroup: (group: DenseCluster) => void;
  /** When set (e.g. by hovering a group or response in the suspicion-groups
   * overlay), overrides the graph's own hover-derived highlight: every
   * response id in this set is drawn at full opacity, every other node/edge
   * dimmed. `null`/omitted falls back to highlighting whatever's currently
   * hovered inside the graph itself. */
  highlightedResponseIds?: Set<string> | null;
};

type PanSession = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
};

type NodeDragSession = {
  pointerId: number;
  id: string;
  startClientX: number;
  startClientY: number;
  moved: boolean;
};

/**
 * Renders the response relation graph as an SVG driven by a continuously
 * ticking d3-force simulation (see `useForceGraphLayout`). Owns the pan/zoom
 * camera, node drag-vs-click detection, edge/node hover and keyboard-focus
 * tooltips, and reports node/edge activation via `onSelectResponse` /
 * `onSelectEdge` — it does not manage any popup-window state itself.
 */
export function ResponseRelationGraphCanvas({
  nodes,
  edges,
  denseClusters,
  openResponseIds,
  onSelectEdge,
  onSelectResponse,
  onSelectGroup,
  highlightedResponseIds,
}: ResponseRelationGraphCanvasProps) {
  const {
    nodes: layoutNodes,
    links: layoutLinks,
    beginDrag,
    dragNodeTo,
    endDrag,
  } = useForceGraphLayout(nodes, edges, denseClusters);

  // Drawn (and hit-tested, since SVG resolves overlapping pointer targets
  // by paint order) weakest-first so HARD edges always render on top of
  // STRONG, which renders on top of SUPPORT — the strongest evidence for a
  // given pair should never be visually hidden or unclickable underneath a
  // weaker one.
  const sortedLayoutLinks = useMemo(
    () =>
      [...layoutLinks].sort(
        (a, b) => strengthRank(a.edge.strength) - strengthRank(b.edge.strength),
      ),
    [layoutLinks],
  );

  // Maps every response id to the response ids it shares a direct edge
  // with, used to expand a single hovered node into "itself + its
  // neighbors" for the hover highlight below.
  const nodeAdjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of layoutLinks) {
      const sourceId = link.source.id;
      const targetId = link.target.id;
      let sourceNeighbors = map.get(sourceId);
      if (!sourceNeighbors) {
        sourceNeighbors = new Set();
        map.set(sourceId, sourceNeighbors);
      }
      sourceNeighbors.add(targetId);
      let targetNeighbors = map.get(targetId);
      if (!targetNeighbors) {
        targetNeighbors = new Set();
        map.set(targetId, targetNeighbors);
      }
      targetNeighbors.add(sourceId);
    }
    return map;
  }, [layoutLinks]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, k: 1 });
  const [panSession, setPanSession] = useState<PanSession | null>(null);
  const [nodeDrag, setNodeDrag] = useState<NodeDragSession | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // What to highlight at full opacity while dimming everything else: an
  // externally supplied set (hovering the suspicion-groups overlay) takes
  // priority; otherwise fall back to whatever's hovered inside the graph
  // itself (a node highlights itself + neighbors, an edge its two
  // endpoints). `null` means "nothing dimmed" (the graph's resting state).
  const highlightedIds = useMemo(() => {
    if (highlightedResponseIds) return highlightedResponseIds;
    if (hoveredNodeId) {
      return new Set([
        hoveredNodeId,
        ...(nodeAdjacency.get(hoveredNodeId) ?? []),
      ]);
    }
    if (hoveredEdgeKey) {
      const link = layoutLinks.find((l) => edgeKey(l.edge) === hoveredEdgeKey);
      if (link) return new Set([link.source.id, link.target.id]);
    }
    return null;
  }, [
    highlightedResponseIds,
    hoveredNodeId,
    hoveredEdgeKey,
    nodeAdjacency,
    layoutLinks,
  ]);

  const clientToGraphPoint = (clientX: number, clientY: number): GraphPoint => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: (clientX - bounds.left - camera.x) / camera.k,
      y: (clientY - bounds.top - camera.y) / camera.k,
    };
  };

  const graphToClientPoint = (
    x: number,
    y: number,
    forCamera: Camera = camera,
  ): GraphPoint => {
    const bounds = svgRef.current?.getBoundingClientRect();
    const left = bounds?.left ?? 0;
    const top = bounds?.top ?? 0;
    return {
      x: left + forCamera.x + x * forCamera.k,
      y: top + forCamera.y + y * forCamera.k,
    };
  };

  // Computes the camera position needed to keep a graph point visible
  // (within a margin), without going through setCamera's async updater —
  // callers need the resulting camera synchronously to also reposition the
  // focus tooltip in the same event handler.
  const cameraKeepingPointVisible = (x: number, y: number): Camera => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return camera;
    const screenX = x * camera.k + camera.x;
    const screenY = y * camera.k + camera.y;
    let nextX = camera.x;
    let nextY = camera.y;
    if (screenX < graphFocusMargin) {
      nextX = camera.x + (graphFocusMargin - screenX);
    } else if (screenX > bounds.width - graphFocusMargin) {
      nextX = camera.x - (screenX - (bounds.width - graphFocusMargin));
    }
    if (screenY < graphFocusMargin) {
      nextY = camera.y + (graphFocusMargin - screenY);
    } else if (screenY > bounds.height - graphFocusMargin) {
      nextY = camera.y - (screenY - (bounds.height - graphFocusMargin));
    }
    if (nextX === camera.x && nextY === camera.y) return camera;
    return { ...camera, x: nextX, y: nextY };
  };

  // React registers its root "wheel" listener as passive, so calling
  // `event.preventDefault()` from a JSX `onWheel` handler is silently
  // ignored (with a console warning) and the page scrolls anyway. Zooming
  // the graph therefore needs a real native listener with `passive: false`,
  // attached directly to the SVG element.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheelNative = (event: WheelEvent): void => {
      event.preventDefault();
      const bounds = svg.getBoundingClientRect();
      const px = event.clientX - bounds.left;
      const py = event.clientY - bounds.top;
      const factor = Math.exp(-event.deltaY * 0.001);
      setCamera((current) => {
        const nextK = clamp(current.k * factor, cameraMinScale, cameraMaxScale);
        return {
          k: nextK,
          x: px - (px - current.x) * (nextK / current.k),
          y: py - (py - current.y) * (nextK / current.k),
        };
      });
    };
    svg.addEventListener("wheel", onWheelNative, { passive: false });
    return () => svg.removeEventListener("wheel", onWheelNative);
  }, []);

  const panByKeyboard = (event: KeyboardEvent<HTMLFieldSetElement>): void => {
    const deltaByKey: Record<string, { x: number; y: number } | undefined> = {
      ArrowDown: { x: 0, y: -graphKeyboardPanStep },
      ArrowLeft: { x: graphKeyboardPanStep, y: 0 },
      ArrowRight: { x: -graphKeyboardPanStep, y: 0 },
      ArrowUp: { x: 0, y: graphKeyboardPanStep },
    };
    const delta = deltaByKey[event.key];
    if (!delta) return;
    event.preventDefault();
    setCamera((current) => ({
      ...current,
      x: current.x + delta.x,
      y: current.y + delta.y,
    }));
  };

  const startPanning = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanSession({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: camera.x,
      startY: camera.y,
    });
  };

  const panCanvas = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!panSession || panSession.pointerId !== event.pointerId) return;
    setCamera((current) => ({
      ...current,
      x: panSession.startX + (event.clientX - panSession.startClientX),
      y: panSession.startY + (event.clientY - panSession.startClientY),
    }));
  };

  const stopPanning = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!panSession || panSession.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPanSession(null);
  };

  const startNodeDrag = (
    event: ReactPointerEvent<HTMLAnchorElement>,
    id: string,
  ): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setNodeDrag({
      pointerId: event.pointerId,
      id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    });
  };

  const moveNodeDrag = (event: ReactPointerEvent<HTMLAnchorElement>): void => {
    if (!nodeDrag || nodeDrag.pointerId !== event.pointerId) return;
    const dx = event.clientX - nodeDrag.startClientX;
    const dy = event.clientY - nodeDrag.startClientY;
    if (!nodeDrag.moved && Math.hypot(dx, dy) > nodeDragThreshold) {
      beginDrag(nodeDrag.id);
      setNodeDrag({ ...nodeDrag, moved: true });
    }
    if (nodeDrag.moved) {
      const point = clientToGraphPoint(event.clientX, event.clientY);
      dragNodeTo(nodeDrag.id, point.x, point.y);
    }
  };

  // Shared by both click/tap and keyboard activation: opens the response
  // window and, for a node merged from more than one identical-content
  // response, also surfaces the other members in the sidebar (via
  // `onSelectGroup`) since they have no node of their own to click.
  const activateNode = (id: string): void => {
    onSelectResponse(id);
    const activatedNode = layoutNodes.find((node) => node.id === id);
    if (
      activatedNode?.memberResponseIds &&
      activatedNode.memberResponseIds.length > 1 &&
      activatedNode.node
    ) {
      const memberCount = activatedNode.memberResponseIds.length;
      onSelectGroup({
        id: `content-group:${id}`,
        responseIds: activatedNode.memberResponseIds,
        strength: toVisibleStrength(activatedNode.node.strongestStrength),
        reasonCode: "duplicate-content",
        pairCount: (memberCount * (memberCount - 1)) / 2,
      });
    }
  };

  const endNodeDrag = (
    event: ReactPointerEvent<HTMLAnchorElement>,
    id: string,
    wasCancelled: boolean,
  ): void => {
    if (!nodeDrag || nodeDrag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (nodeDrag.moved) {
      endDrag(id);
    } else if (!wasCancelled) {
      // A pointercancel (e.g. browser-initiated gesture interruption) is not
      // a completed click, so it must not open a response window.
      activateNode(id);
    }
    setNodeDrag(null);
  };

  return (
    <fieldset
      aria-label="回答の関係グラフの表示位置"
      className="relative overflow-hidden rounded-md border bg-background"
      onKeyDown={panByKeyboard}
    >
      <svg
        ref={svgRef}
        role="img"
        aria-label="回答の関係グラフ"
        className={[
          "h-[calc(100vh-260px)] min-h-[480px] w-full touch-none select-none",
          panSession ? "cursor-grabbing" : "cursor-grab",
        ].join(" ")}
        onPointerDown={startPanning}
        onPointerMove={panCanvas}
        onPointerUp={stopPanning}
        onPointerCancel={stopPanning}
      >
        <rect
          x={-100000}
          y={-100000}
          width={200000}
          height={200000}
          className="fill-muted/20"
        />
        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.k})`}>
          {sortedLayoutLinks.map((link) => {
            const edge = link.edge;
            const collapsedEdges = link.collapsedEdges;
            const source = link.source;
            const target = link.target;
            const title = edgeTitle(edge);
            const isHovered = hoveredEdgeKey === edgeKey(edge);
            const isEdgeHighlighted =
              !highlightedIds ||
              (highlightedIds.has(source.id) && highlightedIds.has(target.id));
            return (
              <g key={edgeKey(edge)}>
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  className={[
                    edgeStrokeClass(edge.strength),
                    isEdgeHighlighted
                      ? isHovered
                        ? "opacity-100"
                        : "opacity-60"
                      : "opacity-10",
                  ].join(" ")}
                  strokeWidth={edgeWidth(edge.strength)}
                />
                <a
                  href={`#relation-${edgeKey(edge)}`}
                  aria-label={`リンク ${title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onSelectEdge(collapsedEdges);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== " ") return;
                    event.preventDefault();
                    onSelectEdge(collapsedEdges);
                  }}
                  onFocus={() => {
                    const midX = (source.x + target.x) / 2;
                    const midY = (source.y + target.y) / 2;
                    setHoveredEdgeKey(edgeKey(edge));
                    const nextCamera = cameraKeepingPointVisible(midX, midY);
                    setCamera(nextCamera);
                    const screen = graphToClientPoint(midX, midY, nextCamera);
                    setTooltip({
                      kind: "edge",
                      edge,
                      collapsedCount: collapsedEdges.length,
                      x: screen.x,
                      y: screen.y,
                    });
                  }}
                  onBlur={() => {
                    setHoveredEdgeKey(null);
                    setTooltip(null);
                  }}
                  onMouseEnter={(event) => {
                    setHoveredEdgeKey(edgeKey(edge));
                    setTooltip({
                      kind: "edge",
                      edge,
                      collapsedCount: collapsedEdges.length,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onMouseMove={(event) =>
                    setTooltip({
                      kind: "edge",
                      edge,
                      collapsedCount: collapsedEdges.length,
                      x: event.clientX,
                      y: event.clientY,
                    })
                  }
                  onMouseLeave={() => {
                    setHoveredEdgeKey(null);
                    setTooltip(null);
                  }}
                >
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    className="cursor-pointer stroke-transparent"
                    pointerEvents="stroke"
                    strokeWidth={8}
                  />
                </a>
              </g>
            );
          })}
          {layoutNodes.map((layoutNode) => {
            const node = layoutNode.node;
            if (!node) return null;
            const isOpen = openResponseIds.has(node.responseId);
            const memberCount = layoutNode.memberCount ?? 1;
            const radius = nodeBaseRadius(memberCount) + (isOpen ? 3 : 0);
            const label =
              memberCount > 1
                ? `回答 ${responseShortId(node.responseId)} を表示 (同一内容の回答 計${memberCount}件)`
                : `回答 ${responseShortId(node.responseId)} を表示`;
            return (
              <a
                key={node.responseId}
                href={`#response-${node.responseId}`}
                aria-label={label}
                onPointerDown={(event) => startNodeDrag(event, node.responseId)}
                onPointerMove={moveNodeDrag}
                onPointerUp={(event) =>
                  endNodeDrag(event, node.responseId, false)
                }
                onPointerCancel={(event) =>
                  endNodeDrag(event, node.responseId, true)
                }
                onKeyDown={(event) => {
                  if (event.key !== " " && event.key !== "Enter") return;
                  // Prevent the native anchor navigation to "#response-…"
                  // (which would add a history entry) for both activation
                  // keys, matching the edge links' onClick behavior.
                  event.preventDefault();
                  activateNode(node.responseId);
                }}
                onFocus={() => {
                  const nextCamera = cameraKeepingPointVisible(
                    layoutNode.x,
                    layoutNode.y,
                  );
                  setCamera(nextCamera);
                  const screen = graphToClientPoint(
                    layoutNode.x,
                    layoutNode.y,
                    nextCamera,
                  );
                  setHoveredNodeId(node.responseId);
                  setTooltip({
                    kind: "node",
                    node,
                    memberCount,
                    x: screen.x,
                    y: screen.y,
                  });
                }}
                onBlur={() => {
                  setHoveredNodeId(null);
                  setTooltip(null);
                }}
                onMouseEnter={(event) => {
                  setHoveredNodeId(node.responseId);
                  setTooltip({
                    kind: "node",
                    node,
                    memberCount,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                onMouseMove={(event) =>
                  setTooltip({
                    kind: "node",
                    node,
                    memberCount,
                    x: event.clientX,
                    y: event.clientY,
                  })
                }
                onMouseLeave={() => {
                  setHoveredNodeId(null);
                  setTooltip(null);
                }}
              >
                <circle
                  cx={layoutNode.x}
                  cy={layoutNode.y}
                  r={radius}
                  className={[
                    nodeFillClass(node.strongestStrength, isOpen),
                    "cursor-pointer stroke-background stroke-2",
                    !highlightedIds || highlightedIds.has(node.responseId)
                      ? "opacity-100"
                      : "opacity-25",
                  ].join(" ")}
                />
                <text
                  x={layoutNode.x}
                  y={layoutNode.y + radius + 14}
                  textAnchor="middle"
                  className="pointer-events-none fill-muted-foreground text-[10px]"
                >
                  {responseShortId(node.responseId)}
                  {memberCount > 1 ? ` ×${memberCount}` : ""}
                </text>
              </a>
            );
          })}
        </g>
      </svg>
      {tooltip && <CursorTooltip tooltip={tooltip} />}
    </fieldset>
  );
}

type ResponseRelationGraphSidebarProps = {
  graph: ResponseRelationGraphResponse;
  selectedCluster: DenseCluster | null;
  onSelectCluster: (cluster: DenseCluster) => void;
  onSelectResponse: (responseId: string) => void;
};

function ResponseRelationGraphSidebar({
  graph,
  selectedCluster,
  onSelectCluster,
  onSelectResponse,
}: ResponseRelationGraphSidebarProps) {
  if (graph.denseClusters.length === 0 && !selectedCluster) return null;

  return (
    <aside className="space-y-4">
      {graph.denseClusters.length > 0 && (
        <div className="rounded-md border p-3">
          <h3 className="text-sm font-semibold">クラスタ</h3>
          <div className="mt-2 space-y-2">
            {graph.denseClusters.map((cluster) => (
              <button
                key={cluster.id}
                type="button"
                className={[
                  "w-full rounded-md border p-2 text-left text-sm hover:bg-muted/40",
                  selectedCluster?.id === cluster.id
                    ? "border-primary bg-primary/5"
                    : "",
                ].join(" ")}
                onClick={() => onSelectCluster(cluster)}
              >
                <span className="font-medium">
                  {cluster.responseIds.length}件 /{" "}
                  {strengthLabel(cluster.strength)}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {reasonLabel(cluster.reasonCode)} / {cluster.pairCount}ペア
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedCluster && (
        <div className="rounded-md border p-3">
          <h3 className="text-sm font-semibold">
            {selectedCluster.reasonCode === "duplicate-content"
              ? reasonLabel(selectedCluster.reasonCode)
              : "クラスタ内回答"}
          </h3>
          <div className="mt-2 max-h-64 space-y-1 overflow-auto">
            {selectedCluster.responseIds.map((responseId) => (
              <button
                key={responseId}
                type="button"
                className="block w-full rounded px-2 py-1 text-left font-mono text-xs hover:bg-muted"
                onClick={() => onSelectResponse(responseId)}
              >
                {responseId}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function useFloatingWindowDrag(
  position: { x: number; y: number },
  onMove: (position: { x: number; y: number }) => void,
) {
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: position.x,
      startY: position.y,
    };
  };

  const onHeaderPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onMove({
      x: drag.startX + (event.clientX - drag.startClientX),
      y: drag.startY + (event.clientY - drag.startClientY),
    });
  };

  const onHeaderPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  return { onHeaderPointerDown, onHeaderPointerMove, onHeaderPointerUp };
}

type WindowSize = { width: number; height: number };

const windowMinWidth = 280;
const windowMinHeight = 200;

/**
 * Tracks a pointer drag on the window's bottom-right resize handle, growing
 * or shrinking `size` from its value at drag-start. The resulting size is
 * clamped to `windowMinWidth`/`windowMinHeight` and — since the window's
 * top-left `position` does not move while resizing — to whatever the
 * viewport can still show measured from that fixed position, so a window
 * can never be resized into a size its own position can't fit on screen
 * (which would otherwise strand its resize handle, and for height its whole
 * body, off-screen with no way to shrink it back).
 */
function useFloatingWindowResize(
  position: { x: number; y: number },
  size: WindowSize,
  onResize: (size: WindowSize) => void,
) {
  const resizeRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  const onResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: size.width,
      startHeight: size.height,
    };
  };

  const onResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const { width: viewportWidth, height: viewportHeight } = viewportSize();
    const maxWidth = viewportWidth - position.x - windowViewportMargin;
    const maxHeight = viewportHeight - position.y - windowViewportMargin;
    onResize({
      width: clamp(
        resize.startWidth + (event.clientX - resize.startClientX),
        windowMinWidth,
        Math.max(windowMinWidth, maxWidth),
      ),
      height: clamp(
        resize.startHeight + (event.clientY - resize.startClientY),
        windowMinHeight,
        Math.max(windowMinHeight, maxHeight),
      ),
    });
  };

  const onResizePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeRef.current = null;
  };

  return { onResizePointerDown, onResizePointerMove, onResizePointerUp };
}

type FloatingWindowProps = {
  title: string;
  closeLabel: string;
  resizeLabel: string;
  size: WindowSize;
  position: { x: number; y: number };
  zIndex: number;
  isFront: boolean;
  onClose: () => void;
  onFocus: () => void;
  onMove: (position: { x: number; y: number }) => void;
  onResize: (size: WindowSize) => void;
  children: ReactNode;
};

/** Shared draggable, closable, resizable floating window shell used by both
 * the response-detail and edge-evidence popups. */
function FloatingWindow({
  title,
  closeLabel,
  resizeLabel,
  size,
  position,
  zIndex,
  isFront,
  onClose,
  onFocus,
  onMove,
  onResize,
  children,
}: FloatingWindowProps) {
  const drag = useFloatingWindowDrag(position, onMove);
  const resize = useFloatingWindowResize(position, size, onResize);

  return (
    <div
      className="fixed flex max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] flex-col rounded-lg border bg-card shadow-xl"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        zIndex,
      }}
      onPointerDownCapture={onFocus}
    >
      <div
        className={[
          "flex shrink-0 cursor-grab items-center justify-between rounded-t-lg border-b px-3 py-2 active:cursor-grabbing",
          isFront ? "bg-muted" : "bg-muted/50",
        ].join(" ")}
        onPointerDown={drag.onHeaderPointerDown}
        onPointerMove={drag.onHeaderPointerMove}
        onPointerUp={drag.onHeaderPointerUp}
        onPointerCancel={drag.onHeaderPointerUp}
      >
        <span className="truncate font-mono text-xs text-muted-foreground">
          {title}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          aria-label={closeLabel}
          onClick={onClose}
          onPointerDown={(event) => {
            // Without this, the pointerdown bubbles to the header's drag
            // handler, which calls setPointerCapture on the header — that
            // retargets the resulting click away from this button, so the
            // window could never actually be closed.
            event.stopPropagation();
          }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {children}
      </div>
      <button
        type="button"
        aria-label={resizeLabel}
        tabIndex={-1}
        className="absolute bottom-0 right-0 h-4 w-4 touch-none cursor-nwse-resize bg-transparent p-0 after:absolute after:bottom-0.5 after:right-0.5 after:h-2 after:w-2 after:border-b-2 after:border-r-2 after:border-muted-foreground/50 after:content-['']"
        onPointerDown={resize.onResizePointerDown}
        onPointerMove={resize.onResizePointerMove}
        onPointerUp={resize.onResizePointerUp}
        onPointerCancel={resize.onResizePointerUp}
      />
    </div>
  );
}

type FloatingResponseWindowProps = {
  formId: string;
  responseId: string;
  canManageResponses: boolean;
  size: WindowSize;
  position: { x: number; y: number };
  zIndex: number;
  isFront: boolean;
  onClose: () => void;
  onFocus: () => void;
  onMove: (position: { x: number; y: number }) => void;
  onResize: (size: WindowSize) => void;
};

function FloatingResponseWindow({
  formId,
  responseId,
  canManageResponses,
  size,
  position,
  zIndex,
  isFront,
  onClose,
  onFocus,
  onMove,
  onResize,
}: FloatingResponseWindowProps) {
  return (
    <FloatingWindow
      title={`回答 ${responseShortId(responseId)}`}
      closeLabel="回答ウィンドウを閉じる"
      resizeLabel="回答ウィンドウのサイズを変更"
      size={size}
      position={position}
      zIndex={zIndex}
      isFront={isFront}
      onClose={onClose}
      onFocus={onFocus}
      onMove={onMove}
      onResize={onResize}
    >
      <ResponseDetailView
        formId={formId}
        responseId={responseId}
        canManageResponses={canManageResponses}
      />
    </FloatingWindow>
  );
}

type FloatingEdgeWindowProps = {
  /** Every original edge collapsed onto the activated line, shown as
   * separate entries — never merged into one, so evidence is never
   * attributed to a pair it wasn't actually found for. */
  edges: GraphEdge[];
  size: WindowSize;
  position: { x: number; y: number };
  zIndex: number;
  isFront: boolean;
  onClose: () => void;
  onFocus: () => void;
  onMove: (position: { x: number; y: number }) => void;
  onResize: (size: WindowSize) => void;
  onSelectResponse: (responseId: string) => void;
};

function FloatingEdgeWindow({
  edges,
  size,
  position,
  zIndex,
  isFront,
  onClose,
  onFocus,
  onMove,
  onResize,
  onSelectResponse,
}: FloatingEdgeWindowProps) {
  const firstEdge = edges[0];
  const title =
    edges.length <= 1 && firstEdge
      ? `リンク根拠 ${responseShortId(firstEdge.responseIdA)} / ${responseShortId(firstEdge.responseIdB)}`
      : `リンク根拠 (${edges.length}件を集約表示)`;
  return (
    <FloatingWindow
      title={title}
      closeLabel="リンク根拠ウィンドウを閉じる"
      resizeLabel="リンク根拠ウィンドウのサイズを変更"
      size={size}
      position={position}
      zIndex={zIndex}
      isFront={isFront}
      onClose={onClose}
      onFocus={onFocus}
      onMove={onMove}
      onResize={onResize}
    >
      {edges.map((edge) => (
        <div key={edgeKey(edge)} className="space-y-2 rounded-md border p-2">
          <p className="break-all font-mono text-[10px] text-muted-foreground">
            {responseShortId(edge.responseIdA)} /{" "}
            {responseShortId(edge.responseIdB)}
          </p>
          <EdgeEvidence edge={edge} />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onSelectResponse(edge.responseIdA)}
            >
              Aを表示
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onSelectResponse(edge.responseIdB)}
            >
              Bを表示
            </Button>
          </div>
        </div>
      ))}
    </FloatingWindow>
  );
}

type OpenResponseWindow = {
  responseId: string;
  position: { x: number; y: number };
  size: WindowSize;
  zIndex: number;
};

type OpenEdgeWindow = {
  key: string;
  edges: GraphEdge[];
  position: { x: number; y: number };
  size: WindowSize;
  zIndex: number;
};

// Floating response/edge windows are draggable popups the user actively
// opened and must always render above the suspicion-groups overlay panel
// (which uses Tailwind's `z-30`) rather than being hidden behind it —
// starting the counter here, comfortably above 30, keeps every window
// above the panel without the two having to coordinate on every change.
const floatingWindowBaseZIndex = 40;
const windowCascadeStep = 32;
const windowInitialPosition = { x: 80, y: 96 };
const defaultResponseWindowSize: WindowSize = { width: 420, height: 480 };
const defaultEdgeWindowSize: WindowSize = { width: 360, height: 420 };
// Matches the `max-w-[calc(100vw-2rem)]` on FloatingWindow: on a narrow
// viewport the window itself shrinks to fit within this margin.
const windowViewportMargin = 32;
// Height reserved so the header row (drag handle + close button) stays
// reachable even if the window's body would otherwise run off the bottom.
const windowHeaderHeight = 48;

function viewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 1280, height: 800 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Clamps a window's top-left position so its header — including the
 * right-aligned close button — stays fully within the viewport, taking the
 * window's actual (possibly viewport-shrunk, per `max-w-[calc(100vw-2rem)]`)
 * rendered width into account rather than a fixed margin.
 */
function clampWindowPosition(
  position: { x: number; y: number },
  windowWidth: number,
): { x: number; y: number } {
  const { width, height } = viewportSize();
  const renderedWidth = Math.min(
    windowWidth,
    Math.max(0, width - windowViewportMargin),
  );
  return {
    x: clamp(position.x, 0, Math.max(0, width - renderedWidth)),
    y: clamp(position.y, 0, Math.max(0, height - windowHeaderHeight)),
  };
}

// Cascades new windows diagonally without ever letting the offset grow
// past what the current viewport can keep reachable — once it would run
// out of room, it wraps back to the start instead of drifting off-screen.
function cascadeWindowPosition(
  index: number,
  windowWidth: number,
): { x: number; y: number } {
  const { width, height } = viewportSize();
  const maxStepsX = Math.floor(
    (width - windowInitialPosition.x - windowWidth) / windowCascadeStep,
  );
  const maxStepsY = Math.floor(
    (height - windowInitialPosition.y - windowHeaderHeight) / windowCascadeStep,
  );
  const maxSteps = Math.max(1, Math.min(maxStepsX, maxStepsY));
  const step = index % maxSteps;
  return clampWindowPosition(
    {
      x: windowInitialPosition.x + step * windowCascadeStep,
      y: windowInitialPosition.y + step * windowCascadeStep,
    },
    windowWidth,
  );
}

type SuspicionGroupsOverlay = {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
  highlightedResponseIds: Set<string> | null;
  handleHoverResponses: (responseIds: string[] | null) => void;
};

/**
 * Owns the suspicion-groups overlay's open/closed state and the
 * hover-driven highlight it feeds into the graph. Bundling `close` with the
 * highlight reset makes "closing the overlay always clears any highlight
 * it set" a property of the hook itself, rather than something every call
 * site has to remember to do — closing while a group/response is still
 * hovered must not leave the graph permanently dimmed, since there's no
 * more overlay left to un-hover it from. `formId` is watched for the same
 * reason: if it changes while the overlay is open with a highlight active
 * (e.g. navigating to a different form without unmounting this component),
 * the previous form's response ids match nothing in the newly loaded
 * graph and would otherwise leave every node dimmed indefinitely.
 */
function useSuspicionGroupsOverlay(formId: string): SuspicionGroupsOverlay {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedResponseIds, setHighlightedResponseIds] =
    useState<Set<string> | null>(null);

  // The overlay can close two ways — its own close button (`close`) and the
  // toolbar toggle button (`toggle`) — and a hover can be in flight when
  // either happens. Clearing the highlight here, keyed only on `isOpen`
  // going false, makes that true regardless of which path closed it (and
  // for any future one), rather than requiring every closer to remember to
  // reset it individually.
  useEffect(() => {
    if (!isOpen) setHighlightedResponseIds(null);
  }, [isOpen]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset the highlight when the active form changes.
  useEffect(() => {
    setHighlightedResponseIds(null);
  }, [formId]);

  const toggle = useCallback(() => setIsOpen((current) => !current), []);
  const close = useCallback(() => setIsOpen(false), []);
  // Stable identity so it doesn't re-trigger the hover effect inside
  // `ResponseSuspicionGroups` on every render (which would otherwise call
  // back into `setHighlightedResponseIds` with a fresh `Set` each time and
  // loop).
  const handleHoverResponses = useCallback((responseIds: string[] | null) => {
    setHighlightedResponseIds(responseIds ? new Set(responseIds) : null);
  }, []);

  return {
    isOpen,
    toggle,
    close,
    highlightedResponseIds,
    handleHoverResponses,
  };
}

export function ResponseRelationGraph({
  formId,
  canManageResponses,
}: ResponseRelationGraphProps) {
  const [openWindows, setOpenWindows] = useState<OpenResponseWindow[]>([]);
  const [openEdgeWindows, setOpenEdgeWindows] = useState<OpenEdgeWindow[]>([]);
  const zIndexCounterRef = useRef(floatingWindowBaseZIndex);
  const [selectedCluster, setSelectedCluster] = useState<DenseCluster | null>(
    null,
  );
  const suspicionGroupsOverlay = useSuspicionGroupsOverlay(formId);
  const graphQuery = useQuery({
    queryKey: ["responseRelationGraph", formId],
    queryFn: (): Promise<ResponseRelationGraphResponse> =>
      rpc(
        client.api.forms[":id"].responses["relation-graph"].$get({
          param: { id: formId },
        }),
      ),
  });

  const graph = graphQuery.data;

  // Re-clamp every open window whenever the viewport is resized, so a
  // popup positioned near the edge of a large viewport can't end up with
  // its header (its only move/close controls) stranded off-screen after
  // the window shrinks.
  useEffect(() => {
    const handleResize = () => {
      setOpenWindows((current) =>
        current.map((win) => ({
          ...win,
          position: clampWindowPosition(win.position, win.size.width),
        })),
      );
      setOpenEdgeWindows((current) =>
        current.map((win) => ({
          ...win,
          position: clampWindowPosition(win.position, win.size.width),
        })),
      );
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const openResponseWindow = (responseId: string) => {
    const nextZ = ++zIndexCounterRef.current;
    setOpenWindows((current) => {
      const existing = current.find((win) => win.responseId === responseId);
      if (existing) {
        return current.map((win) =>
          win.responseId === responseId ? { ...win, zIndex: nextZ } : win,
        );
      }
      const position = cascadeWindowPosition(
        current.length + openEdgeWindows.length,
        defaultResponseWindowSize.width,
      );
      return [
        ...current,
        {
          responseId,
          position,
          size: defaultResponseWindowSize,
          zIndex: nextZ,
        },
      ];
    });
  };

  const closeResponseWindow = (responseId: string) => {
    setOpenWindows((current) =>
      current.filter((win) => win.responseId !== responseId),
    );
  };

  const focusResponseWindow = (responseId: string) => {
    const nextZ = ++zIndexCounterRef.current;
    setOpenWindows((current) =>
      current.map((win) =>
        win.responseId === responseId ? { ...win, zIndex: nextZ } : win,
      ),
    );
  };

  const moveResponseWindow = (
    responseId: string,
    position: { x: number; y: number },
  ) => {
    setOpenWindows((current) =>
      current.map((win) =>
        win.responseId === responseId
          ? {
              ...win,
              position: clampWindowPosition(position, win.size.width),
            }
          : win,
      ),
    );
  };

  const resizeResponseWindow = (responseId: string, size: WindowSize) => {
    setOpenWindows((current) =>
      current.map((win) =>
        win.responseId === responseId ? { ...win, size } : win,
      ),
    );
  };

  const openEdgeWindow = (edges: GraphEdge[]) => {
    // The rendered line's identity is the set of original edges it
    // collapsed (order-independent), not any single member edge's ids —
    // this keeps reopening the same line reusing its existing window.
    const key = edges.map(edgeKey).sort().join("|");
    const nextZ = ++zIndexCounterRef.current;
    setOpenEdgeWindows((current) => {
      const existing = current.find((win) => win.key === key);
      if (existing) {
        return current.map((win) =>
          win.key === key ? { ...win, edges, zIndex: nextZ } : win,
        );
      }
      const position = cascadeWindowPosition(
        current.length + openWindows.length,
        defaultEdgeWindowSize.width,
      );
      return [
        ...current,
        {
          key,
          edges,
          position,
          size: defaultEdgeWindowSize,
          zIndex: nextZ,
        },
      ];
    });
  };

  const closeEdgeWindow = (key: string) => {
    setOpenEdgeWindows((current) => current.filter((win) => win.key !== key));
  };

  const focusEdgeWindow = (key: string) => {
    const nextZ = ++zIndexCounterRef.current;
    setOpenEdgeWindows((current) =>
      current.map((win) => (win.key === key ? { ...win, zIndex: nextZ } : win)),
    );
  };

  const moveEdgeWindow = (key: string, position: { x: number; y: number }) => {
    setOpenEdgeWindows((current) =>
      current.map((win) =>
        win.key === key
          ? { ...win, position: clampWindowPosition(position, win.size.width) }
          : win,
      ),
    );
  };

  const resizeEdgeWindow = (key: string, size: WindowSize) => {
    setOpenEdgeWindows((current) =>
      current.map((win) => (win.key === key ? { ...win, size } : win)),
    );
  };

  const openResponseIds = useMemo(
    () => new Set(openWindows.map((win) => win.responseId)),
    [openWindows],
  );

  const frontZIndex = useMemo(() => {
    const zIndexes = [
      ...openWindows.map((win) => win.zIndex),
      ...openEdgeWindows.map((win) => win.zIndex),
    ];
    return zIndexes.length === 0 ? null : Math.max(...zIndexes);
  }, [openWindows, openEdgeWindows]);

  if (graphQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        関係グラフを読み込み中...
      </div>
    );
  }

  if (graphQuery.isError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        関係グラフの取得に失敗しました
      </div>
    );
  }

  if (!graph?.run || graph.nodes.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
        表示できる関係グラフはありません。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Network className="h-4 w-4" />
          <span>
            最終計算:{" "}
            {graph.run.completedAt
              ? formatJapanLocaleDateTime(graph.run.completedAt)
              : "-"}{" "}
            / 母数 {graph.run.populationSize}件
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-6 bg-sky-500" />
            SUPPORT
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-6 bg-amber-600" />
            STRONG
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-6 bg-rose-600" />
            HARD
          </span>
          <Button
            type="button"
            variant={suspicionGroupsOverlay.isOpen ? "default" : "outline"}
            size="sm"
            className="h-7"
            aria-pressed={suspicionGroupsOverlay.isOpen}
            onClick={suspicionGroupsOverlay.toggle}
          >
            <Link2 className="mr-1 h-3.5 w-3.5" />
            疑義グループ
          </Button>
        </div>
      </div>

      {(graph.hasNextNodes || graph.hasNextEdges) && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          role="status"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>表示上限により、一部の回答またはリンクを省略しています。</p>
        </div>
      )}

      <div
        className={[
          "grid gap-4",
          graph.denseClusters.length > 0 || selectedCluster
            ? "xl:grid-cols-[minmax(0,1fr)_280px]"
            : "",
        ].join(" ")}
      >
        <div className="relative">
          <ResponseRelationGraphCanvas
            nodes={graph.nodes}
            edges={graph.edges}
            denseClusters={graph.denseClusters}
            openResponseIds={openResponseIds}
            onSelectEdge={openEdgeWindow}
            onSelectResponse={openResponseWindow}
            onSelectGroup={setSelectedCluster}
            highlightedResponseIds={
              suspicionGroupsOverlay.highlightedResponseIds
            }
          />
          {suspicionGroupsOverlay.isOpen && (
            <ResponseSuspicionGroups
              formId={formId}
              canManageResponses={canManageResponses}
              onClose={suspicionGroupsOverlay.close}
              onHoverResponses={suspicionGroupsOverlay.handleHoverResponses}
              onSelectResponse={openResponseWindow}
            />
          )}
        </div>
        <ResponseRelationGraphSidebar
          graph={graph}
          selectedCluster={selectedCluster}
          onSelectCluster={setSelectedCluster}
          onSelectResponse={openResponseWindow}
        />
      </div>

      {openWindows.map((win) => (
        <FloatingResponseWindow
          key={win.responseId}
          formId={formId}
          responseId={win.responseId}
          canManageResponses={canManageResponses}
          size={win.size}
          position={win.position}
          zIndex={win.zIndex}
          isFront={win.zIndex === frontZIndex}
          onClose={() => closeResponseWindow(win.responseId)}
          onFocus={() => focusResponseWindow(win.responseId)}
          onMove={(position) => moveResponseWindow(win.responseId, position)}
          onResize={(size) => resizeResponseWindow(win.responseId, size)}
        />
      ))}

      {openEdgeWindows.map((win) => (
        <FloatingEdgeWindow
          key={win.key}
          edges={win.edges}
          size={win.size}
          position={win.position}
          zIndex={win.zIndex}
          isFront={win.zIndex === frontZIndex}
          onClose={() => closeEdgeWindow(win.key)}
          onFocus={() => focusEdgeWindow(win.key)}
          onMove={(position) => moveEdgeWindow(win.key, position)}
          onResize={(size) => resizeEdgeWindow(win.key, size)}
          onSelectResponse={openResponseWindow}
        />
      ))}
    </div>
  );
}
