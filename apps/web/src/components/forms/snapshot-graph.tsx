import { Globe, RotateCcw, Upload } from "lucide-react";
import { type FC, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatJapanShortDateTime } from "@/lib/formatters";

// ── Layout constants ────────────────────────────────────────────────

const LANE_W = 18; /* px */
const ROW_H = 52; /* px */
const NODE_R = 5; /* px, SVG circle radius */
const LANE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#ec4899",
];

function laneColor(lane: number) {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

function nodeX(lane: number) {
  return lane * LANE_W + LANE_W / 2;
}

function nodeY(row: number) {
  return row * ROW_H + ROW_H / 2;
}

// ── Lane assignment ─────────────────────────────────────────────────

interface SnapshotInput {
  version: number;
  parentVersion?: number | null;
}

interface LaneNode {
  version: number;
  lane: number;
  row: number;
}

interface Edge {
  fromLane: number;
  fromRow: number;
  toLane: number;
  toRow: number;
}

function computeLayout(snapshots: SnapshotInput[]): {
  nodes: LaneNode[];
  edges: Edge[];
  laneCount: number;
} {
  if (snapshots.length === 0) return { nodes: [], edges: [], laneCount: 0 };

  // Build children map: parentVersion → [child versions], sorted descending.
  // The highest-versioned child continues on the parent's lane (main branch).
  const childrenOf = new Map<number | null, number[]>();
  for (const s of snapshots) {
    const parent = s.parentVersion ?? null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)?.push(s.version);
  }
  for (const [, children] of childrenOf) {
    children.sort((a, b) => b - a);
  }

  // Assign lanes in ascending version order.
  const versionToLane = new Map<number, number>();
  let nextLane = 1;

  const sortedAsc = Array.from(snapshots).sort((a, b) => a.version - b.version);
  for (const s of sortedAsc) {
    if (s.parentVersion == null) {
      versionToLane.set(s.version, 0);
    } else {
      const parentLane = versionToLane.get(s.parentVersion) ?? 0;
      const sibling = childrenOf.get(s.parentVersion) ?? [];
      const isHighestChild = sibling[0] === s.version;
      if (isHighestChild) {
        versionToLane.set(s.version, parentLane);
      } else {
        versionToLane.set(s.version, nextLane++);
      }
    }
  }

  // Display newest first (row 0 = highest version).
  const sortedDesc = Array.from(snapshots).sort(
    (a, b) => b.version - a.version,
  );
  const versionToRow = new Map<number, number>();
  for (let i = 0; i < sortedDesc.length; i++) {
    const s = sortedDesc[i];
    if (s) versionToRow.set(s.version, i);
  }

  const nodes: LaneNode[] = sortedDesc.map((s, row) => ({
    version: s.version,
    lane: versionToLane.get(s.version) ?? 0,
    row,
  }));

  const edges: Edge[] = [];
  for (const s of sortedDesc) {
    if (s.parentVersion != null) {
      const fromRow = versionToRow.get(s.version) ?? 0;
      const toRow = versionToRow.get(s.parentVersion) ?? 0;
      const fromLane = versionToLane.get(s.version) ?? 0;
      const toLane = versionToLane.get(s.parentVersion) ?? 0;
      edges.push({ fromLane, fromRow, toLane, toRow });
    }
  }

  return { nodes, edges, laneCount: nextLane };
}

// ── SVG edge path ───────────────────────────────────────────────────

function edgePath(
  fromLane: number,
  fromRow: number,
  toLane: number,
  toRow: number,
): string {
  const x1 = nodeX(fromLane);
  const y1 = nodeY(fromRow);
  const x2 = nodeX(toLane);
  const y2 = nodeY(toRow);

  if (fromLane === toLane) {
    return `M ${x1},${y1} L ${x2},${y2}`;
  }

  // Angled path: descend straight, then curve diagonally.
  const offset = ROW_H * 0.4;
  return `M ${x1},${y1} L ${x1},${y2 - offset} Q ${x1},${y2} ${x2},${y2}`;
}

// ── Public API types ────────────────────────────────────────────────

export interface SnapshotGraphItem {
  id: string;
  version: number;
  parentVersion?: number | null;
  isActive: boolean;
  publishedAt: string | Date;
  changeLog?: string | null;
}

interface SnapshotGraphProps {
  snapshots: SnapshotGraphItem[];
  isMutating?: boolean;
  onActivate?: (version: number) => void;
  onRestore?: (version: number) => void;
  onPublish?: (version: number) => void;
  isNotPublished?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}

// ── Component ───────────────────────────────────────────────────────

export const SnapshotGraph: FC<SnapshotGraphProps> = ({
  snapshots,
  isMutating = false,
  onActivate,
  onRestore,
  onPublish,
  isNotPublished = false,
  selectedId,
  onSelect,
}) => {
  const [localSelected, setLocalSelected] = useState<string | null>(null);

  const selected = selectedId !== undefined ? selectedId : localSelected;
  const setSelected = onSelect !== undefined ? onSelect : setLocalSelected;

  const { nodes, edges, laneCount } = computeLayout(snapshots);
  const svgWidth = Math.max(laneCount, 1) * LANE_W;
  const svgHeight = snapshots.length * ROW_H;

  if (snapshots.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">履歴はまだありません。</p>
    );
  }

  const versionToNode = new Map(nodes.map((n) => [n.version, n]));
  const snapshotByVersion = new Map(snapshots.map((s) => [s.version, s]));

  return (
    <div className="flex min-w-0">
      {/* Graph SVG */}
      <div className="shrink-0" style={{ width: svgWidth }}>
        <svg
          width={svgWidth}
          height={svgHeight}
          aria-label="バージョン履歴グラフ"
          role="img"
          style={{ display: "block", overflow: "visible" }}
        >
          <title>バージョン履歴グラフ</title>
          {/* Edges */}
          {edges.map((e, i) => (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: stable layout order
              key={i}
              d={edgePath(e.fromLane, e.fromRow, e.toLane, e.toRow)}
              fill="none"
              stroke={laneColor(e.fromLane)}
              strokeWidth={1.5}
              opacity={0.6}
            />
          ))}

          {/* Nodes rendered as foreignObject buttons for full accessibility */}
          {nodes.map((n) => {
            const snap = snapshotByVersion.get(n.version);
            const isSelected = snap?.id === selected;
            const cx = nodeX(n.lane);
            const cy = nodeY(n.row);
            return (
              <circle
                key={n.version}
                cx={cx}
                cy={cy}
                r={NODE_R}
                fill={isSelected ? "var(--background)" : laneColor(n.lane)}
                stroke={laneColor(n.lane)}
                strokeWidth={isSelected ? 2 : 0}
              />
            );
          })}
        </svg>
      </div>

      {/* Content rows */}
      <div className="flex-1 min-w-0">
        {nodes.map((n) => {
          const snap = snapshotByVersion.get(n.version);
          if (!snap) return null;
          const node = versionToNode.get(n.version);
          const isSelected = snap.id === selected;
          const color = laneColor(node?.lane ?? 0);

          return (
            <div
              key={snap.id}
              style={{ height: ROW_H }}
              className="flex flex-col justify-center"
            >
              <button
                type="button"
                className={`flex items-start gap-1.5 px-1.5 py-1 rounded text-left w-full transition-colors hover:bg-accent/60 ${
                  isSelected ? "bg-accent" : ""
                }`}
                onClick={() => setSelected(isSelected ? null : snap.id)}
              >
                <Badge
                  variant="secondary"
                  className="font-mono text-xs shrink-0 mt-px"
                  style={{ borderLeft: `3px solid ${color}` }}
                >
                  v{snap.version}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    {snap.isActive && (
                      <Badge variant="default" className="text-xs h-4 px-1">
                        公開版
                      </Badge>
                    )}
                    {snap.changeLog && (
                      <span className="text-xs text-muted-foreground truncate">
                        {snap.changeLog}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatJapanShortDateTime(snap.publishedAt)}
                  </p>
                </div>
              </button>

              {isSelected && (onActivate ?? onRestore ?? onPublish) && (
                <div className="flex gap-1 px-1.5 pb-1 flex-wrap">
                  {!snap.isActive && onActivate && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs px-2"
                      disabled={isMutating}
                      onClick={() => onActivate(snap.version)}
                    >
                      <Globe className="h-3 w-3 mr-1" />
                      公開版にする
                    </Button>
                  )}
                  {isNotPublished && onPublish && (
                    <Button
                      size="sm"
                      className="h-6 text-xs px-2"
                      disabled={isMutating}
                      onClick={() => onPublish(snap.version)}
                    >
                      <Upload className="h-3 w-3 mr-1" />
                      公開する
                    </Button>
                  )}
                  {onRestore && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs px-2"
                      disabled={isMutating}
                      onClick={() => onRestore(snap.version)}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      編集を復元
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
