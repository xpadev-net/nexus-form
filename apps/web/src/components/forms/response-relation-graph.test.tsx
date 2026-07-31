// @vitest-environment jsdom

import type { ResponseRelationGraphResponse } from "@nexus-form/shared";
import { fireEvent, getByRole } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addLinkedPair,
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

function renderCanvas(nodes: GraphNode[], edges: GraphEdge[]) {
  container = document.createElement("div");
  document.body.append(container);
  const onSelectEdge = vi.fn();
  const onSelectResponse = vi.fn();
  root = createRoot(container);

  act(() => {
    root?.render(
      <ResponseRelationGraphCanvas
        nodes={nodes}
        edges={edges}
        denseClusters={[]}
        openResponseIds={new Set()}
        onSelectEdge={onSelectEdge}
        onSelectResponse={onSelectResponse}
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

  return { container, onSelectEdge, onSelectResponse, svg };
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
      `a[href="#relation-${edge.responseIdA}:${edge.responseIdB}"] line[stroke-width="18"]`,
      isSvgLineElement,
      "edge hit area",
    );

    act(() => {
      fireEvent.click(edgeHitArea);
    });

    expect(onSelectEdge).toHaveBeenCalledWith(edge);
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
        modelVersion: "response-link-v2-rarity-shadow",
        populationSize: nodes.length,
        skippedCandidateBucketCount: 0,
        statsVersion: null,
      },
    };
  }

  afterEach(() => {
    relationGraphQueryData = undefined;
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
      `a[href="#relation-${edge.responseIdA}:${edge.responseIdB}"] line[stroke-width="18"]`,
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
});
