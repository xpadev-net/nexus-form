import type { ResponseRelationGraphResponse } from "@nexus-form/shared";
import { useQuery } from "@tanstack/react-query";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { AlertTriangle, Loader2, Network } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { client, rpc } from "@/lib/api";
import { formatJapanLocaleDateTime } from "@/lib/formatters";

type ResponseRelationGraphProps = {
  formId: string;
  selectedResponseId: string | null;
  onSelectResponse: (responseId: string) => void;
};

type GraphNode = ResponseRelationGraphResponse["nodes"][number];
type GraphEdge = ResponseRelationGraphResponse["edges"][number];
type DenseCluster = ResponseRelationGraphResponse["denseClusters"][number];

type LayoutNode = SimulationNodeDatum & {
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

type PositionedLayoutLink = LayoutLink & {
  edge: GraphEdge;
  source: LayoutNode;
  target: LayoutNode;
};

type LayoutResult = {
  nodes: Array<LayoutNode & { x: number; y: number }>;
  links: PositionedLayoutLink[];
};

const graphWidth = 900;
const graphHeight = 520;

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

function buildLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  denseClusters: DenseCluster[],
): LayoutResult {
  const layoutNodes: LayoutNode[] = nodes.map((node, index) => {
    const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2;
    return {
      id: node.responseId,
      node,
      hidden: false,
      x: graphWidth / 2 + Math.cos(angle) * 180,
      y: graphHeight / 2 + Math.sin(angle) * 150,
    };
  });
  const nodeIds = new Set(layoutNodes.map((node) => node.id));
  const layoutLinks: LayoutLink[] = edges
    .filter(
      (edge) => nodeIds.has(edge.responseIdA) && nodeIds.has(edge.responseIdB),
    )
    .map((edge) => ({
      source: edge.responseIdA,
      target: edge.responseIdB,
      sourceId: edge.responseIdA,
      targetId: edge.responseIdB,
      edge,
      cluster: null,
    }));

  for (const cluster of denseClusters) {
    const memberIds = cluster.responseIds.filter((responseId) =>
      nodeIds.has(responseId),
    );
    if (memberIds.length < 2) continue;
    const hubId = `cluster:${cluster.id}`;
    layoutNodes.push({
      id: hubId,
      node: null,
      hidden: true,
      clusterId: cluster.id,
      x: graphWidth / 2,
      y: graphHeight / 2,
    });
    for (const responseId of memberIds) {
      layoutLinks.push({
        source: hubId,
        target: responseId,
        sourceId: hubId,
        targetId: responseId,
        edge: null,
        cluster,
      });
    }
  }

  forceSimulation(layoutNodes)
    .force(
      "link",
      forceLink<LayoutNode, LayoutLink>(layoutLinks)
        .id((node) => node.id)
        .distance((link) => (link.cluster ? 48 : 120))
        .strength((link) => (link.cluster ? 0.6 : 0.25)),
    )
    .force("charge", forceManyBody<LayoutNode>().strength(-260))
    .force("center", forceCenter(graphWidth / 2, graphHeight / 2))
    .force("collide", forceCollide<LayoutNode>().radius(24))
    .stop()
    .tick(180);

  for (const node of layoutNodes) {
    node.x = Math.min(graphWidth - 28, Math.max(28, node.x ?? graphWidth / 2));
    node.y = Math.min(
      graphHeight - 28,
      Math.max(28, node.y ?? graphHeight / 2),
    );
  }

  return {
    nodes: layoutNodes.filter(
      (node): node is LayoutNode & { x: number; y: number } =>
        !node.hidden &&
        typeof node.x === "number" &&
        typeof node.y === "number",
    ),
    links: layoutLinks.filter(
      (link): link is PositionedLayoutLink =>
        link.edge !== null &&
        typeof link.source !== "string" &&
        typeof link.source !== "number" &&
        typeof link.target !== "string" &&
        typeof link.target !== "number",
    ),
  };
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

type ResponseRelationGraphCanvasProps = {
  layout: LayoutResult;
  selectedEdge: GraphEdge | null;
  selectedResponseId: string | null;
  onHoverEdge: (edge: GraphEdge | null) => void;
  onSelectEdge: (edge: GraphEdge) => void;
  onSelectResponse: (responseId: string) => void;
};

function ResponseRelationGraphCanvas({
  layout,
  selectedEdge,
  selectedResponseId,
  onHoverEdge,
  onSelectEdge,
  onSelectResponse,
}: ResponseRelationGraphCanvasProps) {
  return (
    <div className="relative overflow-hidden rounded-md border bg-background">
      <svg
        role="img"
        aria-label="回答の関係グラフ"
        viewBox={`0 0 ${graphWidth} ${graphHeight}`}
        className="h-[520px] w-full"
      >
        <rect
          width={graphWidth}
          height={graphHeight}
          className="fill-muted/20"
        />
        {layout.links.map((link) => {
          const edge = link.edge;
          const source = link.source;
          const target = link.target;
          const title = edgeTitle(edge);
          const isSelected = selectedEdge
            ? edgeKey(selectedEdge) === edgeKey(edge)
            : false;
          return (
            <g key={edgeKey(edge)}>
              <title>{title}</title>
              <line
                x1={source.x ?? graphWidth / 2}
                y1={source.y ?? graphHeight / 2}
                x2={target.x ?? graphWidth / 2}
                y2={target.y ?? graphHeight / 2}
                className={[
                  edgeStrokeClass(edge.strength),
                  isSelected ? "opacity-100" : "opacity-60",
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
                onFocus={() => onHoverEdge(edge)}
                onKeyDown={(event) => {
                  if (event.key !== " ") return;
                  event.preventDefault();
                  onSelectEdge(edge);
                }}
                onMouseEnter={() => onHoverEdge(edge)}
                onMouseLeave={() => onHoverEdge(null)}
                onBlur={() => onHoverEdge(null)}
              >
                <line
                  x1={source.x ?? graphWidth / 2}
                  y1={source.y ?? graphHeight / 2}
                  x2={target.x ?? graphWidth / 2}
                  y2={target.y ?? graphHeight / 2}
                  className="cursor-pointer stroke-transparent"
                  pointerEvents="stroke"
                  strokeWidth={18}
                />
              </a>
            </g>
          );
        })}
        {layout.nodes.map((layoutNode) => {
          const node = layoutNode.node;
          if (!node) return null;
          return (
            <a
              key={node.responseId}
              href={`#response-${node.responseId}`}
              aria-label={`回答 ${responseShortId(node.responseId)} を表示`}
              onClick={(event) => {
                event.preventDefault();
                onSelectResponse(node.responseId);
              }}
              onKeyDown={(event) => {
                if (event.key !== " ") return;
                event.preventDefault();
                onSelectResponse(node.responseId);
              }}
            >
              <title>
                {responseShortId(node.responseId)} /{" "}
                {strengthLabel(node.strongestStrength)}
              </title>
              <circle
                cx={layoutNode.x}
                cy={layoutNode.y}
                r={selectedResponseId === node.responseId ? 12 : 9}
                className={[
                  nodeFillClass(
                    node.strongestStrength,
                    selectedResponseId === node.responseId,
                  ),
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
      </svg>
    </div>
  );
}

type ResponseRelationGraphSidebarProps = {
  graph: ResponseRelationGraphResponse;
  selectedEdge: GraphEdge | null;
  selectedCluster: DenseCluster | null;
  onSelectCluster: (cluster: DenseCluster) => void;
  onSelectResponse: (responseId: string) => void;
};

function ResponseRelationGraphSidebar({
  graph,
  selectedEdge,
  selectedCluster,
  onSelectCluster,
  onSelectResponse,
}: ResponseRelationGraphSidebarProps) {
  return (
    <aside className="space-y-4">
      <div className="rounded-md border p-3">
        <h3 className="text-sm font-semibold">リンク根拠</h3>
        {selectedEdge ? (
          <div className="mt-3 space-y-3">
            <p className="break-all font-mono text-xs text-muted-foreground">
              {selectedEdge.responseIdA} / {selectedEdge.responseIdB}
            </p>
            <EdgeEvidence edge={selectedEdge} />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onSelectResponse(selectedEdge.responseIdA)}
              >
                Aを表示
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onSelectResponse(selectedEdge.responseIdB)}
              >
                Bを表示
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            edgeにマウスを重ねると、合致した要素を表示します。
          </p>
        )}
      </div>

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

export function ResponseRelationGraph({
  formId,
  onSelectResponse,
  selectedResponseId,
}: ResponseRelationGraphProps) {
  const [hoveredEdge, setHoveredEdge] = useState<GraphEdge | null>(null);
  const [pinnedEdge, setPinnedEdge] = useState<GraphEdge | null>(null);
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
  const nodesById = useMemo(
    () =>
      new Map(
        (graph?.nodes ?? []).map((node) => [node.responseId, node] as const),
      ),
    [graph?.nodes],
  );
  const layout = useMemo(
    () =>
      buildLayout(
        graph?.nodes ?? [],
        graph?.edges ?? [],
        graph?.denseClusters ?? [],
      ),
    [graph?.nodes, graph?.edges, graph?.denseClusters],
  );
  const selectedEdge = hoveredEdge ?? pinnedEdge;

  const selectEdgeResponse = (edge: GraphEdge) => {
    setPinnedEdge(edge);
    const leftNode = nodesById.get(edge.responseIdA);
    const rightNode = nodesById.get(edge.responseIdB);
    const nextResponseId =
      leftNode && rightNode && leftNode.submittedAt < rightNode.submittedAt
        ? rightNode.responseId
        : edge.responseIdA;
    onSelectResponse(nextResponseId);
  };

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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <ResponseRelationGraphCanvas
          layout={layout}
          selectedEdge={selectedEdge}
          selectedResponseId={selectedResponseId}
          onHoverEdge={setHoveredEdge}
          onSelectEdge={selectEdgeResponse}
          onSelectResponse={onSelectResponse}
        />
        <ResponseRelationGraphSidebar
          graph={graph}
          selectedEdge={selectedEdge}
          selectedCluster={selectedCluster}
          onSelectCluster={setSelectedCluster}
          onSelectResponse={onSelectResponse}
        />
      </div>
    </div>
  );
}
