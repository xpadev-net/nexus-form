import type { ResponseRelationGraphResponse } from "@nexus-form/shared";
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
import { AlertTriangle, Loader2, Network, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
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

type ResponseRelationGraphProps = {
  formId: string;
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
};

type LayoutLink = SimulationLinkDatum<LayoutNode> & {
  edge: GraphEdge | null;
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
      return 4;
    case "STRONG":
      return 3;
    case "SUPPORT":
      return 1.5;
    default:
      return 1;
  }
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

    const layoutNodes: LayoutNode[] = nodes.map((node, index) => {
      nextIds.add(node.responseId);
      const existing = nodesById.get(node.responseId);
      if (existing) {
        existing.node = node;
        existing.hidden = false;
        existing.clusterId = undefined;
        return existing;
      }
      const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2;
      const created: LayoutNode = {
        id: node.responseId,
        node,
        hidden: false,
        x: Math.cos(angle) * 120,
        y: Math.sin(angle) * 120,
      };
      nodesById.set(node.responseId, created);
      return created;
    });

    const linkedNeighbors: LinkedNeighbors = new Map();
    const layoutLinks: LayoutLink[] = edges
      .filter(
        (edge) =>
          nextIds.has(edge.responseIdA) && nextIds.has(edge.responseIdB),
      )
      .map((edge) => {
        addLinkedPair(linkedNeighbors, edge.responseIdA, edge.responseIdB);
        return {
          source: edge.responseIdA,
          target: edge.responseIdB,
          sourceId: edge.responseIdA,
          targetId: edge.responseIdB,
          edge,
          cluster: null,
        };
      });

    for (const cluster of denseClusters) {
      const memberIds = cluster.responseIds.filter((responseId) =>
        nextIds.has(responseId),
      );
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
          .strength((link) => (link.cluster ? 0.7 : 0.35)),
      )
      .force(
        "charge",
        forceManyBody<LayoutNode>().strength(-110).distanceMax(200),
      )
      .force("x", forceX<LayoutNode>(0).strength(0.02))
      .force("y", forceY<LayoutNode>(0).strength(0.02))
      .force("collide", forceCollide<LayoutNode>().radius(24))
      .force(
        "minSeparation",
        forceMinSeparation(linkedNeighbors, {
          minDistance: nonRelationMinDistance,
          strength: nonRelationStrength,
        }),
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
  | { kind: "edge"; edge: GraphEdge; x: number; y: number }
  | { kind: "node"; node: GraphNode; x: number; y: number };

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
          </p>
          <EdgeEvidence edge={tooltip.edge} />
        </div>
      ) : (
        <div className="space-y-1">
          <p className="font-mono text-[10px] text-muted-foreground">
            {responseShortId(tooltip.node.responseId)}
          </p>
          <p>強度: {strengthLabel(tooltip.node.strongestStrength)}</p>
          <p>送信: {formatJapanLocaleDateTime(tooltip.node.submittedAt)}</p>
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
  onSelectEdge: (edge: GraphEdge) => void;
  onSelectResponse: (responseId: string) => void;
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
}: ResponseRelationGraphCanvasProps) {
  const {
    nodes: layoutNodes,
    links: layoutLinks,
    beginDrag,
    dragNodeTo,
    endDrag,
  } = useForceGraphLayout(nodes, edges, denseClusters);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, k: 1 });
  const [panSession, setPanSession] = useState<PanSession | null>(null);
  const [nodeDrag, setNodeDrag] = useState<NodeDragSession | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

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

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>): void => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
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
      onSelectResponse(id);
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
          "h-[560px] w-full touch-none select-none",
          panSession ? "cursor-grabbing" : "cursor-grab",
        ].join(" ")}
        onWheel={handleWheel}
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
          {layoutLinks.map((link) => {
            const edge = link.edge;
            const source = link.source;
            const target = link.target;
            const title = edgeTitle(edge);
            const isHovered = hoveredEdgeKey === edgeKey(edge);
            return (
              <g key={edgeKey(edge)}>
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  className={[
                    edgeStrokeClass(edge.strength),
                    isHovered ? "opacity-100" : "opacity-60",
                  ].join(" ")}
                  strokeWidth={edgeWidth(edge.strength)}
                />
                <a
                  href={`#relation-${edgeKey(edge)}`}
                  aria-label={`リンク ${title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onSelectEdge(edge);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== " ") return;
                    event.preventDefault();
                    onSelectEdge(edge);
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
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onMouseMove={(event) =>
                    setTooltip({
                      kind: "edge",
                      edge,
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
                    strokeWidth={18}
                  />
                </a>
              </g>
            );
          })}
          {layoutNodes.map((layoutNode) => {
            const node = layoutNode.node;
            if (!node) return null;
            const isOpen = openResponseIds.has(node.responseId);
            return (
              <a
                key={node.responseId}
                href={`#response-${node.responseId}`}
                aria-label={`回答 ${responseShortId(node.responseId)} を表示`}
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
                  onSelectResponse(node.responseId);
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
                  setTooltip({ kind: "node", node, x: screen.x, y: screen.y });
                }}
                onBlur={() => setTooltip(null)}
                onMouseEnter={(event) =>
                  setTooltip({
                    kind: "node",
                    node,
                    x: event.clientX,
                    y: event.clientY,
                  })
                }
                onMouseMove={(event) =>
                  setTooltip({
                    kind: "node",
                    node,
                    x: event.clientX,
                    y: event.clientY,
                  })
                }
                onMouseLeave={() => setTooltip(null)}
              >
                <circle
                  cx={layoutNode.x}
                  cy={layoutNode.y}
                  r={isOpen ? 12 : 9}
                  className={[
                    nodeFillClass(node.strongestStrength, isOpen),
                    "cursor-pointer stroke-background stroke-2",
                  ].join(" ")}
                />
                <text
                  x={layoutNode.x}
                  y={layoutNode.y + 23}
                  textAnchor="middle"
                  className="pointer-events-none fill-muted-foreground text-[10px]"
                >
                  {responseShortId(node.responseId)}
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
  return (
    <aside className="space-y-4">
      {graph.denseClusters.length > 0 ? (
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
      ) : (
        <div className="rounded-md border p-3 text-sm text-muted-foreground">
          ノードやリンクにマウスを重ねると詳細が表示されます。
        </div>
      )}

      {selectedCluster && (
        <div className="rounded-md border p-3">
          <h3 className="text-sm font-semibold">クラスタ内回答</h3>
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

type FloatingWindowProps = {
  title: string;
  closeLabel: string;
  width: number;
  position: { x: number; y: number };
  zIndex: number;
  isFront: boolean;
  onClose: () => void;
  onFocus: () => void;
  onMove: (position: { x: number; y: number }) => void;
  children: ReactNode;
};

/** Shared draggable, closable floating window shell used by both the
 * response-detail and edge-evidence popups. */
function FloatingWindow({
  title,
  closeLabel,
  width,
  position,
  zIndex,
  isFront,
  onClose,
  onFocus,
  onMove,
  children,
}: FloatingWindowProps) {
  const drag = useFloatingWindowDrag(position, onMove);

  return (
    <div
      className="fixed max-w-[calc(100vw-2rem)] rounded-lg border bg-card shadow-xl"
      style={{ left: position.x, top: position.y, width, zIndex }}
      onPointerDownCapture={onFocus}
    >
      <div
        className={[
          "flex cursor-grab items-center justify-between rounded-t-lg border-b px-3 py-2 active:cursor-grabbing",
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
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="max-h-[70vh] space-y-3 overflow-auto p-3">{children}</div>
    </div>
  );
}

type FloatingResponseWindowProps = {
  formId: string;
  responseId: string;
  position: { x: number; y: number };
  zIndex: number;
  isFront: boolean;
  onClose: () => void;
  onFocus: () => void;
  onMove: (position: { x: number; y: number }) => void;
};

function FloatingResponseWindow({
  formId,
  responseId,
  position,
  zIndex,
  isFront,
  onClose,
  onFocus,
  onMove,
}: FloatingResponseWindowProps) {
  return (
    <FloatingWindow
      title={`回答 ${responseShortId(responseId)}`}
      closeLabel="回答ウィンドウを閉じる"
      width={responseWindowWidth}
      position={position}
      zIndex={zIndex}
      isFront={isFront}
      onClose={onClose}
      onFocus={onFocus}
      onMove={onMove}
    >
      <ResponseDetailView formId={formId} responseId={responseId} />
    </FloatingWindow>
  );
}

type FloatingEdgeWindowProps = {
  edge: GraphEdge;
  position: { x: number; y: number };
  zIndex: number;
  isFront: boolean;
  onClose: () => void;
  onFocus: () => void;
  onMove: (position: { x: number; y: number }) => void;
  onSelectResponse: (responseId: string) => void;
};

function FloatingEdgeWindow({
  edge,
  position,
  zIndex,
  isFront,
  onClose,
  onFocus,
  onMove,
  onSelectResponse,
}: FloatingEdgeWindowProps) {
  return (
    <FloatingWindow
      title={`リンク根拠 ${responseShortId(edge.responseIdA)} / ${responseShortId(edge.responseIdB)}`}
      closeLabel="リンク根拠ウィンドウを閉じる"
      width={edgeWindowWidth}
      position={position}
      zIndex={zIndex}
      isFront={isFront}
      onClose={onClose}
      onFocus={onFocus}
      onMove={onMove}
    >
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
    </FloatingWindow>
  );
}

type OpenResponseWindow = {
  responseId: string;
  position: { x: number; y: number };
  zIndex: number;
};

type OpenEdgeWindow = {
  key: string;
  edge: GraphEdge;
  position: { x: number; y: number };
  zIndex: number;
};

const windowCascadeStep = 32;
const windowInitialPosition = { x: 80, y: 96 };
const responseWindowWidth = 420;
const edgeWindowWidth = 360;
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

export function ResponseRelationGraph({ formId }: ResponseRelationGraphProps) {
  const [openWindows, setOpenWindows] = useState<OpenResponseWindow[]>([]);
  const [openEdgeWindows, setOpenEdgeWindows] = useState<OpenEdgeWindow[]>([]);
  const zIndexCounterRef = useRef(1);
  const [selectedCluster, setSelectedCluster] = useState<DenseCluster | null>(
    null,
  );
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
          position: clampWindowPosition(win.position, responseWindowWidth),
        })),
      );
      setOpenEdgeWindows((current) =>
        current.map((win) => ({
          ...win,
          position: clampWindowPosition(win.position, edgeWindowWidth),
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
        responseWindowWidth,
      );
      return [
        ...current,
        {
          responseId,
          position,
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
              position: clampWindowPosition(position, responseWindowWidth),
            }
          : win,
      ),
    );
  };

  const openEdgeWindow = (edge: GraphEdge) => {
    const key = edgeKey(edge);
    const nextZ = ++zIndexCounterRef.current;
    setOpenEdgeWindows((current) => {
      const existing = current.find((win) => win.key === key);
      if (existing) {
        return current.map((win) =>
          win.key === key ? { ...win, edge, zIndex: nextZ } : win,
        );
      }
      const position = cascadeWindowPosition(
        current.length + openWindows.length,
        edgeWindowWidth,
      );
      return [
        ...current,
        {
          key,
          edge,
          position,
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
          ? { ...win, position: clampWindowPosition(position, edgeWindowWidth) }
          : win,
      ),
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
        <div className="flex flex-wrap gap-2 text-xs">
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <ResponseRelationGraphCanvas
          nodes={graph.nodes}
          edges={graph.edges}
          denseClusters={graph.denseClusters}
          openResponseIds={openResponseIds}
          onSelectEdge={openEdgeWindow}
          onSelectResponse={openResponseWindow}
        />
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
          position={win.position}
          zIndex={win.zIndex}
          isFront={win.zIndex === frontZIndex}
          onClose={() => closeResponseWindow(win.responseId)}
          onFocus={() => focusResponseWindow(win.responseId)}
          onMove={(position) => moveResponseWindow(win.responseId, position)}
        />
      ))}

      {openEdgeWindows.map((win) => (
        <FloatingEdgeWindow
          key={win.key}
          edge={win.edge}
          position={win.position}
          zIndex={win.zIndex}
          isFront={win.zIndex === frontZIndex}
          onClose={() => closeEdgeWindow(win.key)}
          onFocus={() => focusEdgeWindow(win.key)}
          onMove={(position) => moveEdgeWindow(win.key, position)}
          onSelectResponse={openResponseWindow}
        />
      ))}
    </div>
  );
}
