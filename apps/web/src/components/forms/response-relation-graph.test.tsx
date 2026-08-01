// @vitest-environment jsdom

import type { ResponseRelationGraphResponse } from "@nexus-form/shared";
import { fireEvent, getByRole } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addLinkedPair,
  computeSuspicionGroupComponents,
  forceGroupCohesion,
  forceMinSeparation,
  type LayoutNode,
  type LinkedNeighbors,
  ResponseRelationGraph,
  ResponseRelationGraphCanvas,
} from "./response-relation-graph";

const relationGraphApiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  client: {
    api: {
      forms: {
        ":id": {
          responses: {
            "relation-graph": { $get: relationGraphApiMocks.get },
          },
        },
      },
    },
  },
  rpc: relationGraphApiMocks.rpc,
}));

let relationGraphQueryData: ResponseRelationGraphResponse | undefined;

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: relationGraphQueryData,
    isError: false,
    isLoading: relationGraphQueryData === undefined,
  }),
}));

vi.mock("./response-detail-view", () => ({
  ResponseDetailView: ({ responseId }: { responseId: string }) => (
    <div data-testid="response-detail">{responseId}</div>
  ),
}));

type SuspicionGroupsOverlayProps = {
  onClose: () => void;
  onHoverResponses: (responseIds: string[] | null) => void;
};

vi.mock("./response-suspicion-groups", () => ({
  ResponseSuspicionGroups: ({
    onClose,
    onHoverResponses,
  }: SuspicionGroupsOverlayProps) => (
    <div data-testid="suspicion-groups-overlay">
      <button type="button" onClick={() => onHoverResponses(["response-0"])}>
        hover response-0
      </button>
      <button type="button" onClick={onClose}>
        close overlay
      </button>
    </div>
  ),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type GraphNode = ResponseRelationGraphResponse["nodes"][number];
type GraphEdge = ResponseRelationGraphResponse["edges"][number];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn((pointerId: number) => {
    return pointerId === 1;
  });
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

function graphNode(index: number): GraphNode {
  return {
    responseId: `response-${index}`,
    submittedAt: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
    respondentUuid: `respondent-${index}`,
    strongestStrength: "STRONG",
    strongestEvidence: 0.9,
    contentHash: `content-hash-${index}`,
  };
}

function graphEdge(responseIdA: string, responseIdB: string): GraphEdge {
  return {
    responseIdA,
    responseIdB,
    strength: "STRONG",
    deviceEvidence: 0.82,
    v4Support: false,
    v6Strong: false,
    stateSupport: false,
    reasonCodes: ["support:device"],
    familyContributions: [],
  };
}

function twoNodeEdgeFixture(): {
  nodes: GraphNode[];
  nodeA: GraphNode;
  nodeB: GraphNode;
  edge: GraphEdge;
} {
  const nodes = [graphNode(0), graphNode(1)];
  const [nodeA, nodeB] = nodes;
  if (!nodeA || !nodeB) {
    throw new Error("Expected graph node fixtures to be present");
  }
  return {
    nodes,
    nodeA,
    nodeB,
    edge: graphEdge(nodeA.responseId, nodeB.responseId),
  };
}

function renderCanvas(
  nodes: GraphNode[],
  edges: GraphEdge[],
  denseClusters: ResponseRelationGraphResponse["denseClusters"] = [],
) {
  container = document.createElement("div");
  document.body.append(container);
  const onSelectEdge = vi.fn();
  const onSelectResponse = vi.fn();
  const onSelectGroup = vi.fn();
  root = createRoot(container);

  act(() => {
    root?.render(
      <ResponseRelationGraphCanvas
        nodes={nodes}
        edges={edges}
        denseClusters={denseClusters}
        openResponseIds={new Set()}
        onSelectEdge={onSelectEdge}
        onSelectResponse={onSelectResponse}
        onSelectGroup={onSelectGroup}
      />,
    );
  });

  const graphImage = getByRole(container, "img", {
    name: "回答の関係グラフ",
  });
  if (!(graphImage instanceof SVGSVGElement)) {
    throw new Error("Expected relation graph image to be an SVG element");
  }
  const svg = graphImage;
  svg.getBoundingClientRect = vi.fn(() => ({
    bottom: 520,
    height: 520,
    left: 0,
    right: 900,
    top: 0,
    width: 900,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }));

  return { container, onSelectEdge, onSelectResponse, onSelectGroup, svg };
}

function getRequiredElement<TElement extends Element>(
  parent: ParentNode,
  selector: string,
  isExpectedElement: (element: Element) => element is TElement,
  description: string,
): TElement {
  const element = parent.querySelector(selector);
  if (!element) {
    throw new Error(`Expected ${description} to be present`);
  }
  if (!isExpectedElement(element)) {
    throw new Error(
      `Expected ${description} to match the required element type`,
    );
  }
  return element;
}

function isSvgRectElement(element: Element): element is SVGRectElement {
  return element.tagName.toLowerCase() === "rect";
}

function isSvgLineElement(element: Element): element is SVGLineElement {
  return element.tagName.toLowerCase() === "line";
}

function isSvgAnchorElement(element: Element): element is SVGAElement {
  return element.tagName.toLowerCase() === "a";
}

function isSvgGroupElement(element: Element): element is SVGGElement {
  return element.tagName.toLowerCase() === "g";
}

function parseTransform(element: SVGGElement): {
  x: number;
  y: number;
  k: number;
} {
  const raw = element.getAttribute("transform") ?? "";
  const number = "[-\\d.]+(?:[eE][-+]?\\d+)?";
  const match = raw.match(
    new RegExp(`translate\\((${number}) (${number})\\) scale\\((${number})\\)`),
  );
  if (!match) {
    throw new Error(`Unexpected transform value: ${raw}`);
  }
  const [, x, y, k] = match;
  return { x: Number(x), y: Number(y), k: Number(k) };
}

describe("ResponseRelationGraphCanvas", () => {
  it("pans the canvas only when dragging the background", () => {
    const { nodes, edge } = twoNodeEdgeFixture();
    const { container, svg } = renderCanvas(nodes, [edge]);
    const background = getRequiredElement(
      container,
      "rect",
      isSvgRectElement,
      "graph background",
    );
    const group = getRequiredElement(
      container,
      "svg > g",
      isSvgGroupElement,
      "camera transform group",
    );

    expect(parseTransform(group)).toEqual({ x: 0, y: 0, k: 1 });

    act(() => {
      fireEvent.pointerDown(background, {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerMove(svg, {
        clientX: 140,
        clientY: 160,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerUp(svg, { pointerId: 1 });
    });

    expect(parseTransform(group)).toEqual({ x: 40, y: 60, k: 1 });
  });

  it("zooms toward the pointer position on wheel", () => {
    const { nodes, edge } = twoNodeEdgeFixture();
    const { container, svg } = renderCanvas(nodes, [edge]);
    const group = getRequiredElement(
      container,
      "svg > g",
      isSvgGroupElement,
      "camera transform group",
    );

    act(() => {
      fireEvent.wheel(svg, { deltaY: -100, clientX: 450, clientY: 260 });
    });

    const transform = parseTransform(group);
    expect(transform.k).toBeGreaterThan(1);
  });

  it("opens the response window on a plain node click, not on drag", () => {
    const { nodes, nodeA: sourceNode, edge } = twoNodeEdgeFixture();
    const { container, onSelectResponse } = renderCanvas(nodes, [edge]);
    const nodeAnchor = getRequiredElement(
      container,
      `a[href="#response-${sourceNode.responseId}"]`,
      isSvgAnchorElement,
      "node link",
    );

    act(() => {
      fireEvent.pointerDown(nodeAnchor, {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerUp(nodeAnchor, { pointerId: 1 });
    });

    expect(onSelectResponse).toHaveBeenCalledWith(sourceNode.responseId);

    onSelectResponse.mockClear();

    act(() => {
      fireEvent.pointerDown(nodeAnchor, {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerMove(nodeAnchor, {
        clientX: 200,
        clientY: 200,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerUp(nodeAnchor, { pointerId: 1 });
    });

    expect(onSelectResponse).not.toHaveBeenCalled();
  });

  it("selects an edge when its hit area is clicked", () => {
    const { nodes, edge } = twoNodeEdgeFixture();
    const { container, onSelectEdge } = renderCanvas(nodes, [edge]);
    const edgeHitArea = getRequiredElement(
      container,
      `a[href="#relation-${edge.responseIdA}:${edge.responseIdB}"] line[stroke-width="8"]`,
      isSvgLineElement,
      "edge hit area",
    );

    act(() => {
      fireEvent.click(edgeHitArea);
    });

    expect(onSelectEdge).toHaveBeenCalledWith([edge]);
  });

  it("collapses multiple edges onto one visual line without fabricating combined evidence for a pair they don't describe", () => {
    const nodeX = graphNode(0);
    const nodeY1 = graphNode(1);
    // response-2 merges into response-1 (the lower id wins as
    // representative), so both edge1 and edge2 below collapse onto the same
    // rendered (nodeX, nodeY1) pair even though edge2 was really found
    // between nodeX and response-2, not nodeX and response-1.
    const nodeY2 = { ...graphNode(2), contentHash: nodeY1.contentHash };
    const edge1: GraphEdge = {
      ...graphEdge(nodeX.responseId, nodeY1.responseId),
      strength: "SUPPORT",
      deviceEvidence: 0.3,
      reasonCodes: ["support:device"],
    };
    const edge2: GraphEdge = {
      ...graphEdge(nodeX.responseId, nodeY2.responseId),
      strength: "STRONG",
      deviceEvidence: 0.9,
      reasonCodes: ["support:visitorId"],
    };
    const { container, onSelectEdge } = renderCanvas(
      [nodeX, nodeY1, nodeY2],
      [edge1, edge2],
    );

    // Only one hit area is rendered for the collapsed pair, not two.
    const hitAreas = container.querySelectorAll(
      'a[href^="#relation-"] line[stroke-width="8"]',
    );
    expect(hitAreas).toHaveLength(1);

    act(() => {
      fireEvent.click(hitAreas[0] as SVGLineElement);
    });

    expect(onSelectEdge).toHaveBeenCalledTimes(1);
    // Every original edge is passed through unmodified — not merged into
    // one synthetic edge — so each keeps its own real endpoints/evidence.
    const selectedEdges = onSelectEdge.mock.calls[0]?.[0] as GraphEdge[];
    expect(selectedEdges).toHaveLength(2);
    expect(selectedEdges).toEqual(expect.arrayContaining([edge1, edge2]));
    expect(
      selectedEdges.find(
        (selectedEdge) => selectedEdge.responseIdB === nodeY2.responseId,
      ),
    ).toEqual(edge2);
  });

  it("supports keyboard panning", () => {
    const { nodes, edge } = twoNodeEdgeFixture();
    const { container } = renderCanvas(nodes, [edge]);
    const group = getRequiredElement(
      container,
      "svg > g",
      isSvgGroupElement,
      "camera transform group",
    );
    const fieldset = container.querySelector("fieldset");
    if (!fieldset) {
      throw new Error("Expected fieldset wrapper to be present");
    }

    act(() => {
      fireEvent.keyDown(fieldset, { key: "ArrowRight" });
    });

    expect(parseTransform(group)).toEqual({ x: -56, y: 0, k: 1 });
  });

  it("shows a tooltip and pans an off-screen node into view on keyboard focus", () => {
    const { nodes, nodeA: sourceNode, edge } = twoNodeEdgeFixture();
    const { container, svg } = renderCanvas(nodes, [edge]);
    const group = getRequiredElement(
      container,
      "svg > g",
      isSvgGroupElement,
      "camera transform group",
    );
    const background = getRequiredElement(
      container,
      "rect",
      isSvgRectElement,
      "graph background",
    );
    const nodeAnchor = getRequiredElement(
      container,
      `a[href="#response-${sourceNode.responseId}"]`,
      isSvgAnchorElement,
      "node link",
    );

    // Pan the camera far away so every node ends up outside the viewport.
    act(() => {
      fireEvent.pointerDown(background, {
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerMove(svg, {
        clientX: -5000,
        clientY: -5000,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerUp(svg, { pointerId: 1 });
    });
    const pannedAwayTransform = parseTransform(group);
    expect(pannedAwayTransform).toEqual({ x: -5000, y: -5000, k: 1 });

    expect(container.querySelector("[role='tooltip']")).toBeNull();

    act(() => {
      fireEvent.focusIn(nodeAnchor);
    });

    expect(container.querySelector("[role='tooltip']")).not.toBeNull();
    expect(container.textContent).toContain(
      responseShortIdForTest(sourceNode.responseId),
    );
    const focusedTransform = parseTransform(group);
    expect(focusedTransform).not.toEqual(pannedAwayTransform);

    act(() => {
      fireEvent.focusOut(nodeAnchor);
    });

    expect(container.querySelector("[role='tooltip']")).toBeNull();
  });
});

function responseShortIdForTest(responseId: string): string {
  return responseId.slice(0, 8);
}

describe("forceMinSeparation", () => {
  function layoutNode(id: string, x: number, y: number): LayoutNode {
    return { id, node: null, hidden: false, x, y, vx: 0, vy: 0 };
  }

  it("pushes apart unlinked nodes that are closer than the minimum distance", () => {
    const a = layoutNode("a", 0, 0);
    const b = layoutNode("b", 10, 0);
    const force = forceMinSeparation(new Map(), {
      minDistance: 90,
      strength: 0.6,
    });
    force.initialize?.([a, b], Math.random);
    force(1);

    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
  });

  it("does not push apart nodes once they clear the minimum distance", () => {
    const a = layoutNode("a", 0, 0);
    const b = layoutNode("b", 200, 0);
    const force = forceMinSeparation(new Map(), {
      minDistance: 90,
      strength: 0.6,
    });
    force.initialize?.([a, b], Math.random);
    force(1);

    expect(a.vx).toBe(0);
    expect(b.vx).toBe(0);
  });

  it("does not push apart pairs that are exempted as linked (e.g. same dense cluster)", () => {
    const a = layoutNode("a", 0, 0);
    const b = layoutNode("b", 10, 0);
    const linkedNeighbors: LinkedNeighbors = new Map();
    addLinkedPair(linkedNeighbors, "a", "b");
    const force = forceMinSeparation(linkedNeighbors, {
      minDistance: 90,
      strength: 0.6,
    });
    force.initialize?.([a, b], Math.random);
    force(1);

    expect(a.vx).toBe(0);
    expect(b.vx).toBe(0);
  });
});

describe("forceGroupCohesion", () => {
  function layoutNode(id: string, x: number, y: number): LayoutNode {
    return { id, node: null, hidden: false, x, y, vx: 0, vy: 0 };
  }

  it("pulls a component's members toward their shared centroid", () => {
    // Centroid of (0,0), (100,0), (50,0) is (50,0), so the leftmost and
    // rightmost members should be pulled toward each other and the middle
    // one should stay put.
    const a = layoutNode("a", 0, 0);
    const b = layoutNode("b", 100, 0);
    const c = layoutNode("c", 50, 0);
    const force = forceGroupCohesion(new Map([["a", ["a", "b", "c"]]]), {
      strength: 0.5,
    });
    force.initialize?.([a, b, c], Math.random);
    force(1);

    expect(a.vx).toBeGreaterThan(0);
    expect(b.vx).toBeLessThan(0);
    expect(c.vx).toBe(0);
  });

  it("does nothing for a singleton component", () => {
    const a = layoutNode("a", 0, 0);
    const force = forceGroupCohesion(new Map([["a", ["a"]]]), {
      strength: 0.5,
    });
    force.initialize?.([a], Math.random);
    force(1);

    expect(a.vx).toBe(0);
    expect(a.vy).toBe(0);
  });
});

describe("computeSuspicionGroupComponents", () => {
  function link(
    sourceId: string,
    targetId: string,
    strength: "SUPPORT" | "STRONG" | "HARD",
    reasonCodes: string[] = [],
  ): {
    sourceId: string;
    targetId: string;
    edge: GraphEdge;
    cluster: null;
  } {
    return {
      sourceId,
      targetId,
      cluster: null,
      edge: {
        ...graphEdge(sourceId, targetId),
        strength,
        reasonCodes,
      },
    };
  }

  it("unions responses linked by a HARD edge", () => {
    const components = computeSuspicionGroupComponents(
      ["a", "b"],
      [link("a", "b", "HARD", ["hard:session"])],
    );

    expect(components.get("a")).toBe(components.get("b"));
  });

  it("unions responses linked by an identity-anchored STRONG edge", () => {
    const components = computeSuspicionGroupComponents(
      ["a", "b"],
      [link("a", "b", "STRONG", ["strong:telemetry:v6"])],
    );

    expect(components.get("a")).toBe(components.get("b"));
  });

  it("does not union responses linked only by SUPPORT edges, even chained through a middle node", () => {
    // a-b and b-c are each SUPPORT-only, so despite the chain, a and c (and
    // b) must NOT end up in the same group — a school computer lab sharing
    // coincidentally similar device fingerprints must not visually balloon
    // into one confirmed suspicion group.
    const components = computeSuspicionGroupComponents(
      ["a", "b", "c"],
      [
        link("a", "b", "SUPPORT", ["support:device"]),
        link("b", "c", "SUPPORT", ["support:device"]),
      ],
    );

    expect(components.get("a")).not.toBe(components.get("b"));
    expect(components.get("b")).not.toBe(components.get("c"));
    expect(components.get("a")).not.toBe(components.get("c"));
  });

  it("does not union responses linked only by an aggregate-only STRONG edge (multiple-device-families without an identity anchor)", () => {
    const components = computeSuspicionGroupComponents(
      ["a", "b"],
      [link("a", "b", "STRONG", ["strong:multiple-device-families"])],
    );

    expect(components.get("a")).not.toBe(components.get("b"));
  });

  it("always unions members of a dense-cluster hub link regardless of edge strength", () => {
    // A hub link is identified by `cluster` being set (`edge` is always
    // null for it), not by edge strength — so even though these carry no
    // identity-anchored edge at all, the hub must still union them.
    const cluster = {
      id: "cluster-1",
      responseIds: ["a", "b"],
      strength: "SUPPORT" as const,
      reasonCode: "dense:pair-links-omitted",
      pairCount: 1,
    };
    const components = computeSuspicionGroupComponents(
      ["hub", "a", "b"],
      [
        { sourceId: "hub", targetId: "a", edge: null, cluster },
        { sourceId: "hub", targetId: "b", edge: null, cluster },
      ],
    );

    expect(components.get("hub")).toBe(components.get("a"));
    expect(components.get("hub")).toBe(components.get("b"));
  });
});

describe("ResponseRelationGraph", () => {
  beforeEach(() => {
    relationGraphApiMocks.get.mockReset();
    relationGraphApiMocks.rpc.mockReset();
  });

  function renderGraph(data: ResponseRelationGraphResponse) {
    relationGraphQueryData = data;
    const graphContainer = document.createElement("div");
    document.body.append(graphContainer);
    const graphRoot = createRoot(graphContainer);
    act(() => {
      graphRoot.render(<ResponseRelationGraph formId="form-1" />);
    });
    return { graphContainer, graphRoot };
  }

  function graphResponse(
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): ResponseRelationGraphResponse {
    return {
      denseClusters: [],
      edges,
      hasNextEdges: false,
      hasNextNodes: false,
      nodes,
      run: {
        candidatePairLimitExceeded: false,
        completedAt: "2026-01-01T00:00:00.000Z",
        id: "run-1",
        modelVersion: "response-link-v2-rarity-shadow-agg-tier",
        populationSize: nodes.length,
        skippedCandidateBucketCount: 0,
        statsVersion: null,
      },
    };
  }

  afterEach(() => {
    relationGraphQueryData = undefined;
  });

  it("dims non-highlighted nodes while the suspicion-groups overlay reports a hover, and clears the dimming when the overlay is closed", () => {
    const { nodes, nodeB, edge } = twoNodeEdgeFixture();
    const { graphContainer, graphRoot } = renderGraph(
      graphResponse(nodes, [edge]),
    );

    const toggleButton = Array.from(
      graphContainer.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("疑義グループ"));
    if (!toggleButton) {
      throw new Error("Expected the suspicion-groups toggle button");
    }
    act(() => {
      fireEvent.click(toggleButton);
    });

    const otherNodeCircle = graphContainer.querySelector(
      `a[href="#response-${nodeB.responseId}"] circle`,
    );
    if (!otherNodeCircle) {
      throw new Error("Expected the non-hovered node's circle to exist");
    }
    expect(otherNodeCircle.classList.contains("opacity-100")).toBe(true);

    const hoverButton = Array.from(
      graphContainer.querySelectorAll("button"),
    ).find((button) => button.textContent === "hover response-0");
    if (!hoverButton) {
      throw new Error("Expected the mocked overlay's hover button");
    }
    act(() => {
      fireEvent.click(hoverButton);
    });

    // response-0 is highlighted by the overlay, so response-1 (nodeB) must
    // be dimmed even though nothing in the graph itself is being hovered.
    expect(otherNodeCircle.classList.contains("opacity-25")).toBe(true);

    const closeButton = Array.from(
      graphContainer.querySelectorAll("button"),
    ).find((button) => button.textContent === "close overlay");
    if (!closeButton) {
      throw new Error("Expected the mocked overlay's close button");
    }
    act(() => {
      fireEvent.click(closeButton);
    });

    // Closing the overlay while a hover was still active must not leave the
    // graph permanently dimmed — there's no more overlay to un-hover from.
    expect(otherNodeCircle.classList.contains("opacity-100")).toBe(true);
    expect(otherNodeCircle.classList.contains("opacity-25")).toBe(false);

    act(() => graphRoot.unmount());
    graphContainer.remove();
  });

  it("also clears the dimming when the overlay is closed via the toolbar toggle button, not just its own close button", () => {
    const { nodes, nodeB, edge } = twoNodeEdgeFixture();
    const { graphContainer, graphRoot } = renderGraph(
      graphResponse(nodes, [edge]),
    );

    const toggleButton = Array.from(
      graphContainer.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("疑義グループ"));
    if (!toggleButton) {
      throw new Error("Expected the suspicion-groups toggle button");
    }
    act(() => {
      fireEvent.click(toggleButton);
    });

    const hoverButton = Array.from(
      graphContainer.querySelectorAll("button"),
    ).find((button) => button.textContent === "hover response-0");
    if (!hoverButton) {
      throw new Error("Expected the mocked overlay's hover button");
    }
    act(() => {
      fireEvent.click(hoverButton);
    });

    const otherNodeCircle = graphContainer.querySelector(
      `a[href="#response-${nodeB.responseId}"] circle`,
    );
    if (!otherNodeCircle) {
      throw new Error("Expected the non-hovered node's circle to exist");
    }
    expect(otherNodeCircle.classList.contains("opacity-25")).toBe(true);

    // Close via the toolbar toggle (the same button that opened it), not
    // the overlay's own close button.
    act(() => {
      fireEvent.click(toggleButton);
    });

    expect(otherNodeCircle.classList.contains("opacity-100")).toBe(true);
    expect(otherNodeCircle.classList.contains("opacity-25")).toBe(false);

    act(() => graphRoot.unmount());
    graphContainer.remove();
  });

  it("clears the dimming when the active form changes while the overlay is still open with a highlight active", () => {
    const { nodes, nodeB, edge } = twoNodeEdgeFixture();
    const { graphContainer, graphRoot } = renderGraph(
      graphResponse(nodes, [edge]),
    );

    const toggleButton = Array.from(
      graphContainer.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("疑義グループ"));
    if (!toggleButton) {
      throw new Error("Expected the suspicion-groups toggle button");
    }
    act(() => {
      fireEvent.click(toggleButton);
    });

    const hoverButton = Array.from(
      graphContainer.querySelectorAll("button"),
    ).find((button) => button.textContent === "hover response-0");
    if (!hoverButton) {
      throw new Error("Expected the mocked overlay's hover button");
    }
    act(() => {
      fireEvent.click(hoverButton);
    });

    const otherNodeCircle = graphContainer.querySelector(
      `a[href="#response-${nodeB.responseId}"] circle`,
    );
    if (!otherNodeCircle) {
      throw new Error("Expected the non-hovered node's circle to exist");
    }
    expect(otherNodeCircle.classList.contains("opacity-25")).toBe(true);

    // Navigate to a different form without the overlay closing — the
    // previous form's highlighted response id matches nothing in the newly
    // loaded graph, so it must not leave every node dimmed indefinitely.
    act(() => {
      graphRoot.render(<ResponseRelationGraph formId="form-2" />);
    });

    const otherNodeCircleAfterFormChange = graphContainer.querySelector(
      `a[href="#response-${nodeB.responseId}"] circle`,
    );
    if (!otherNodeCircleAfterFormChange) {
      throw new Error("Expected the node's circle to still exist");
    }
    expect(
      otherNodeCircleAfterFormChange.classList.contains("opacity-100"),
    ).toBe(true);
    expect(
      otherNodeCircleAfterFormChange.classList.contains("opacity-25"),
    ).toBe(false);

    act(() => graphRoot.unmount());
    graphContainer.remove();
  });

  it("opens multiple floating response windows and closes them independently", () => {
    const { nodes, nodeA, nodeB, edge } = twoNodeEdgeFixture();
    const { graphContainer, graphRoot } = renderGraph(
      graphResponse(nodes, [edge]),
    );

    const nodeAnchorA = getRequiredElement(
      graphContainer,
      `a[href="#response-${nodeA.responseId}"]`,
      isSvgAnchorElement,
      "node A link",
    );
    const nodeAnchorB = getRequiredElement(
      graphContainer,
      `a[href="#response-${nodeB.responseId}"]`,
      isSvgAnchorElement,
      "node B link",
    );

    act(() => {
      fireEvent.pointerDown(nodeAnchorA, {
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerUp(nodeAnchorA, { pointerId: 1 });
    });
    act(() => {
      fireEvent.pointerDown(nodeAnchorB, {
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerUp(nodeAnchorB, { pointerId: 1 });
    });

    const detailPanels = Array.from(
      graphContainer.querySelectorAll("[data-testid='response-detail']"),
    ).map((element) => element.textContent);
    expect(detailPanels).toEqual([nodeA.responseId, nodeB.responseId]);

    const closeButtons = graphContainer.querySelectorAll(
      "button[aria-label='回答ウィンドウを閉じる']",
    );
    expect(closeButtons).toHaveLength(2);
    const firstCloseButton = closeButtons[0];
    if (!firstCloseButton) {
      throw new Error("Expected a close button to be present");
    }

    act(() => {
      fireEvent.click(firstCloseButton);
    });

    const remainingPanels = Array.from(
      graphContainer.querySelectorAll("[data-testid='response-detail']"),
    ).map((element) => element.textContent);
    expect(remainingPanels).toEqual([nodeB.responseId]);

    act(() => graphRoot.unmount());
    graphContainer.remove();
  });

  it("opens a persistent edge evidence window on edge click, reachable without hover", () => {
    const { nodes, nodeA, edge } = twoNodeEdgeFixture();
    const { graphContainer, graphRoot } = renderGraph(
      graphResponse(nodes, [edge]),
    );

    const edgeHitArea = getRequiredElement(
      graphContainer,
      `a[href="#relation-${edge.responseIdA}:${edge.responseIdB}"] line[stroke-width="8"]`,
      isSvgLineElement,
      "edge hit area",
    );

    expect(
      graphContainer.querySelector(
        "button[aria-label='リンク根拠ウィンドウを閉じる']",
      ),
    ).toBeNull();

    act(() => {
      fireEvent.click(edgeHitArea);
    });

    expect(
      graphContainer.querySelector(
        "button[aria-label='リンク根拠ウィンドウを閉じる']",
      ),
    ).not.toBeNull();
    expect(graphContainer.textContent).toContain("端末特徴一致");

    const showAButton = Array.from(
      graphContainer.querySelectorAll("button"),
    ).find((button) => button.textContent === "Aを表示");
    if (!showAButton) {
      throw new Error("Expected the 'Aを表示' button to be present");
    }

    act(() => {
      fireEvent.click(showAButton);
    });

    expect(
      graphContainer.querySelector("[data-testid='response-detail']")
        ?.textContent,
    ).toBe(nodeA.responseId);

    act(() => graphRoot.unmount());
    graphContainer.remove();
  });

  it("re-clamps popup window positions when the viewport shrinks", () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;

    try {
      const { nodes, nodeA, edge } = twoNodeEdgeFixture();
      const { graphContainer, graphRoot } = renderGraph(
        graphResponse(nodes, [edge]),
      );

      const nodeAnchor = getRequiredElement(
        graphContainer,
        `a[href="#response-${nodeA.responseId}"]`,
        isSvgAnchorElement,
        "node link",
      );
      act(() => {
        fireEvent.pointerDown(nodeAnchor, {
          button: 0,
          clientX: 0,
          clientY: 0,
          pointerId: 1,
        });
      });
      act(() => {
        fireEvent.pointerUp(nodeAnchor, { pointerId: 1 });
      });

      const header = getRequiredElement(
        graphContainer,
        "div.cursor-grab",
        (element): element is HTMLDivElement =>
          element instanceof HTMLDivElement,
        "floating window header",
      );

      // Drag the window far into the bottom-right corner; moves are clamped
      // to the (large, default jsdom) viewport as they happen.
      act(() => {
        fireEvent.pointerDown(header, {
          button: 0,
          clientX: 0,
          clientY: 0,
          pointerId: 1,
        });
      });
      act(() => {
        fireEvent.pointerMove(header, {
          clientX: 5000,
          clientY: 5000,
          pointerId: 1,
        });
      });
      act(() => {
        fireEvent.pointerUp(header, { pointerId: 1 });
      });

      const windowElement = header.closest("div.fixed");
      if (!(windowElement instanceof HTMLElement)) {
        throw new Error("Expected the floating window element to be present");
      }
      const positionBeforeResize = {
        left: Number.parseFloat(windowElement.style.left),
        top: Number.parseFloat(windowElement.style.top),
      };
      expect(positionBeforeResize.left).toBeGreaterThan(200);
      expect(positionBeforeResize.top).toBeGreaterThan(100);

      // Shrink the viewport well below the window's current position and
      // fire resize — the window must be pulled back so its header stays
      // reachable.
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 400,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 300,
      });
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });

      // With a 400x300 viewport and the response window's own 420px width
      // (shrunk to fit within the viewport minus its 32px margin), only 32px
      // of horizontal slack remains; vertically only the header height
      // (48px) needs to stay on-screen.
      expect(Number.parseFloat(windowElement.style.left)).toBeLessThanOrEqual(
        32,
      );
      expect(Number.parseFloat(windowElement.style.top)).toBeLessThanOrEqual(
        252,
      );

      act(() => graphRoot.unmount());
      graphContainer.remove();
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      });
    }
  });

  it("does not start a window drag when pressing the close button, so the button stays clickable", () => {
    const { nodes, nodeA } = twoNodeEdgeFixture();
    const { graphContainer, graphRoot } = renderGraph(graphResponse(nodes, []));

    const nodeAnchor = getRequiredElement(
      graphContainer,
      `a[href="#response-${nodeA.responseId}"]`,
      isSvgAnchorElement,
      "node link",
    );
    act(() => {
      fireEvent.pointerDown(nodeAnchor, {
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerUp(nodeAnchor, { pointerId: 1 });
    });

    const closeButton = getRequiredElement(
      graphContainer,
      "button[aria-label='回答ウィンドウを閉じる']",
      (element): element is HTMLButtonElement =>
        element instanceof HTMLButtonElement,
      "close button",
    );
    const windowElement = closeButton.closest("div.fixed");
    if (!(windowElement instanceof HTMLElement)) {
      throw new Error("Expected the floating window element to be present");
    }
    const positionBefore = {
      left: windowElement.style.left,
      top: windowElement.style.top,
    };

    // A press-and-drag starting on the close button itself: without
    // stopPropagation on the button's pointerdown, this bubbles into the
    // header's drag handler (React dispatches pointer events along the real
    // DOM ancestor chain regardless of setPointerCapture) and moves the
    // window — which is exactly the bug that made the button unclickable.
    act(() => {
      fireEvent.pointerDown(closeButton, {
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerId: 2,
      });
    });
    act(() => {
      fireEvent.pointerMove(closeButton, {
        clientX: 400,
        clientY: 400,
        pointerId: 2,
      });
    });
    act(() => {
      fireEvent.pointerUp(closeButton, { pointerId: 2 });
    });

    expect(windowElement.style.left).toBe(positionBefore.left);
    expect(windowElement.style.top).toBe(positionBefore.top);

    act(() => {
      fireEvent.click(closeButton);
    });

    expect(
      graphContainer.querySelector("[data-testid='response-detail']"),
    ).toBeNull();

    act(() => graphRoot.unmount());
    graphContainer.remove();
  });

  it("resizes a floating window by dragging its resize handle", () => {
    const { nodes, nodeA } = twoNodeEdgeFixture();
    const { graphContainer, graphRoot } = renderGraph(graphResponse(nodes, []));

    const nodeAnchor = getRequiredElement(
      graphContainer,
      `a[href="#response-${nodeA.responseId}"]`,
      isSvgAnchorElement,
      "node link",
    );
    act(() => {
      fireEvent.pointerDown(nodeAnchor, {
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerUp(nodeAnchor, { pointerId: 1 });
    });

    const resizeHandle = getRequiredElement(
      graphContainer,
      "[aria-label='回答ウィンドウのサイズを変更']",
      (element): element is HTMLButtonElement =>
        element instanceof HTMLButtonElement,
      "resize handle",
    );
    const windowElement = resizeHandle.closest("div.fixed");
    if (!(windowElement instanceof HTMLElement)) {
      throw new Error("Expected the floating window element to be present");
    }
    const widthBefore = Number.parseFloat(windowElement.style.width);
    const heightBefore = Number.parseFloat(windowElement.style.height);

    act(() => {
      fireEvent.pointerDown(resizeHandle, {
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 3,
      });
    });
    act(() => {
      fireEvent.pointerMove(resizeHandle, {
        clientX: 120,
        clientY: 80,
        pointerId: 3,
      });
    });
    act(() => {
      fireEvent.pointerUp(resizeHandle, { pointerId: 3 });
    });

    expect(Number.parseFloat(windowElement.style.width)).toBe(
      widthBefore + 120,
    );
    expect(Number.parseFloat(windowElement.style.height)).toBe(
      heightBefore + 80,
    );

    act(() => graphRoot.unmount());
    graphContainer.remove();
  });

  it("merges responses sharing identical answer content into one larger node, reachable in full via the sidebar", () => {
    const nodeA = graphNode(0);
    const nodeB = { ...graphNode(1), contentHash: nodeA.contentHash };
    const { graphContainer, graphRoot } = renderGraph(
      graphResponse([nodeA, nodeB], []),
    );

    // The two responses share a contentHash, so only one visual node is
    // rendered for the pair instead of two.
    const nodeAnchors = graphContainer.querySelectorAll(
      'svg a[href^="#response-"]',
    );
    expect(nodeAnchors).toHaveLength(1);

    const mergedAnchor = nodeAnchors[0];
    if (!mergedAnchor || !isSvgAnchorElement(mergedAnchor)) {
      throw new Error("Expected the merged node anchor to be an SVG <a>");
    }
    expect(mergedAnchor.getAttribute("href")).toBe(
      `#response-${nodeA.responseId}`,
    );
    expect(mergedAnchor.getAttribute("aria-label")).toContain("計2件");

    act(() => {
      fireEvent.pointerDown(mergedAnchor, {
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerUp(mergedAnchor, { pointerId: 1 });
    });

    // Clicking the merged node opens the representative response...
    expect(
      graphContainer.querySelector("[data-testid='response-detail']")
        ?.textContent,
    ).toBe(nodeA.responseId);

    // ...and surfaces every merged response in the sidebar, so the other
    // member — otherwise unreachable, since it has no node of its own on
    // the graph — can still be opened.
    const groupMemberButtons = Array.from(
      graphContainer.querySelectorAll("aside button.font-mono"),
    ).map((button) => button.textContent);
    expect(groupMemberButtons).toEqual(
      expect.arrayContaining([nodeA.responseId, nodeB.responseId]),
    );

    // The sidebar heading names this specific reason (duplicate answer
    // content), not the generic dense-cluster heading it reuses the UI from.
    expect(graphContainer.querySelector("aside h3")?.textContent).toBe(
      "送信日時以外が同一の回答",
    );

    act(() => graphRoot.unmount());
    graphContainer.remove();
  });

  it("surfaces the merged group in the sidebar on keyboard activation too, not just pointer clicks", () => {
    const nodeA = graphNode(0);
    const nodeB = { ...graphNode(1), contentHash: nodeA.contentHash };
    const { graphContainer, graphRoot } = renderGraph(
      graphResponse([nodeA, nodeB], []),
    );

    const mergedAnchor = getRequiredElement(
      graphContainer,
      `a[href="#response-${nodeA.responseId}"]`,
      isSvgAnchorElement,
      "merged node link",
    );

    act(() => {
      fireEvent.keyDown(mergedAnchor, { key: "Enter" });
    });

    expect(
      graphContainer.querySelector("[data-testid='response-detail']")
        ?.textContent,
    ).toBe(nodeA.responseId);
    const groupMemberButtons = Array.from(
      graphContainer.querySelectorAll("aside button.font-mono"),
    ).map((button) => button.textContent);
    expect(groupMemberButtons).toEqual(
      expect.arrayContaining([nodeA.responseId, nodeB.responseId]),
    );

    act(() => graphRoot.unmount());
    graphContainer.remove();
  });

  it("keeps a resized window's edges within the viewport even when it was previously dragged away from the top-left corner", () => {
    const { nodes, nodeA } = twoNodeEdgeFixture();
    const { graphContainer, graphRoot } = renderGraph(graphResponse(nodes, []));

    const nodeAnchor = getRequiredElement(
      graphContainer,
      `a[href="#response-${nodeA.responseId}"]`,
      isSvgAnchorElement,
      "node link",
    );
    act(() => {
      fireEvent.pointerDown(nodeAnchor, {
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerUp(nodeAnchor, { pointerId: 1 });
    });

    const header = getRequiredElement(
      graphContainer,
      "div.cursor-grab",
      (element): element is HTMLDivElement => element instanceof HTMLDivElement,
      "floating window header",
    );

    // Drag the window well away from the top-left corner first.
    act(() => {
      fireEvent.pointerDown(header, {
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerMove(header, {
        clientX: 600,
        clientY: 400,
        pointerId: 1,
      });
    });
    act(() => {
      fireEvent.pointerUp(header, { pointerId: 1 });
    });

    const resizeHandle = getRequiredElement(
      graphContainer,
      "[aria-label='回答ウィンドウのサイズを変更']",
      (element): element is HTMLButtonElement =>
        element instanceof HTMLButtonElement,
      "resize handle",
    );
    const windowElement = resizeHandle.closest("div.fixed");
    if (!(windowElement instanceof HTMLElement)) {
      throw new Error("Expected the floating window element to be present");
    }
    const positionAfterDrag = {
      left: Number.parseFloat(windowElement.style.left),
      top: Number.parseFloat(windowElement.style.top),
    };

    // Now try to resize it by an amount that, from this position, would
    // push it far past the (large, default jsdom) viewport if the resize
    // itself didn't account for where the window currently sits.
    act(() => {
      fireEvent.pointerDown(resizeHandle, {
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 3,
      });
    });
    act(() => {
      fireEvent.pointerMove(resizeHandle, {
        clientX: 5000,
        clientY: 5000,
        pointerId: 3,
      });
    });
    act(() => {
      fireEvent.pointerUp(resizeHandle, { pointerId: 3 });
    });

    // Dragging never changes the window's stored top-left position...
    expect(Number.parseFloat(windowElement.style.left)).toBe(
      positionAfterDrag.left,
    );
    expect(Number.parseFloat(windowElement.style.top)).toBe(
      positionAfterDrag.top,
    );
    // ...so the resize handle (right/bottom edge) must itself have been
    // capped to keep the window within the viewport from that position,
    // rather than growing without bound.
    const width = Number.parseFloat(windowElement.style.width);
    const height = Number.parseFloat(windowElement.style.height);
    expect(positionAfterDrag.left + width).toBeLessThanOrEqual(
      window.innerWidth,
    );
    expect(positionAfterDrag.top + height).toBeLessThanOrEqual(
      window.innerHeight,
    );

    act(() => graphRoot.unmount());
    graphContainer.remove();
  });
});
