// @vitest-environment jsdom

import type { ResponseRelationGraphResponse } from "@nexus-form/shared";
import { fireEvent, getByRole } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLayout,
  ResponseRelationGraphCanvas,
} from "./response-relation-graph";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type GraphNode = ResponseRelationGraphResponse["nodes"][number];
type GraphEdge = ResponseRelationGraphResponse["edges"][number];
type Layout = ReturnType<typeof buildLayout>;

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

function renderCanvas(layout: Layout, options?: { onSelectEdge?: () => void }) {
  container = document.createElement("div");
  document.body.append(container);
  const onHoverEdge = vi.fn();
  const onSelectEdge = options?.onSelectEdge ?? vi.fn();
  const onSelectResponse = vi.fn();
  root = createRoot(container);

  act(() => {
    root?.render(
      <ResponseRelationGraphCanvas
        layout={layout}
        selectedEdge={null}
        selectedResponseId={null}
        onHoverEdge={onHoverEdge}
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

function isSvgCircleElement(element: Element): element is SVGCircleElement {
  return element.tagName.toLowerCase() === "circle";
}

function isSvgLineElement(element: Element): element is SVGLineElement {
  return element.tagName.toLowerCase() === "line";
}

function isSvgAnchorElement(element: Element): element is SVGAElement {
  return element.tagName.toLowerCase() === "a";
}

describe("buildLayout", () => {
  it("keeps related nodes in the visible center area instead of pinning them to the outer frame", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => graphNode(index));
    const edges = nodes.map((node, index) => {
      const nextNode = nodes[(index + 1) % nodes.length];
      if (!nextNode) {
        throw new Error("Expected ring graph node fixture to be present");
      }
      return graphEdge(node.responseId, nextNode.responseId);
    });

    const layout = buildLayout(nodes, edges, []);
    const distancesFromCenter = layout.nodes.map((node) =>
      Math.hypot(node.x - 660, node.y - 380),
    );

    expect(layout.nodes).toHaveLength(nodes.length);
    expect(Math.max(...distancesFromCenter)).toBeLessThan(220);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThan(32);
      expect(node.x).toBeLessThan(1288);
      expect(node.y).toBeGreaterThan(32);
      expect(node.y).toBeLessThan(728);
    }
  });
});

describe("ResponseRelationGraphCanvas", () => {
  it("pans the wide graph canvas only when dragging the background", () => {
    const nodes = [graphNode(0), graphNode(1)];
    const [sourceNode, targetNode] = nodes;
    if (!sourceNode || !targetNode) {
      throw new Error("Expected graph node fixtures to be present");
    }
    const edge = graphEdge(sourceNode.responseId, targetNode.responseId);
    const layout = buildLayout(nodes, [edge], []);
    const { container, onSelectEdge, onSelectResponse, svg } =
      renderCanvas(layout);
    const background = getRequiredElement(
      container,
      "rect",
      isSvgRectElement,
      "graph background",
    );
    const nodeCircle = getRequiredElement(
      container,
      "circle",
      isSvgCircleElement,
      "node circle",
    );
    const edgeHitArea = getRequiredElement(
      container,
      `a[href="#relation-${edge.responseIdA}:${edge.responseIdB}"] line[stroke-width="18"]`,
      isSvgLineElement,
      "edge hit area",
    );

    expect(svg.getAttribute("viewBox")).toBe("210 120 900 520");

    act(() => {
      fireEvent.pointerDown(background, {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1,
      });
      fireEvent.pointerMove(svg, {
        clientX: 0,
        clientY: 0,
        pointerId: 2,
      });
    });
    expect(svg.getAttribute("viewBox")).toBe("210 120 900 520");

    act(() => {
      fireEvent.pointerMove(svg, {
        clientX: 0,
        clientY: 50,
        pointerId: 1,
      });
      fireEvent.pointerUp(svg, {
        pointerId: 1,
      });
    });
    expect(svg.getAttribute("viewBox")).toBe("310 170 900 520");

    act(() => {
      fireEvent.pointerDown(nodeCircle, {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1,
      });
      fireEvent.pointerMove(svg, {
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      });
      fireEvent.click(nodeCircle);
    });
    expect(svg.getAttribute("viewBox")).toBe("310 170 900 520");
    expect(onSelectResponse).toHaveBeenCalledWith(sourceNode.responseId);

    act(() => {
      fireEvent.pointerDown(edgeHitArea, {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1,
      });
      fireEvent.pointerMove(svg, {
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      });
      fireEvent.click(edgeHitArea);
    });
    expect(svg.getAttribute("viewBox")).toBe("310 170 900 520");
    expect(onSelectEdge).toHaveBeenCalledWith(edge);
  });

  it("keeps pointer panning aligned when the responsive SVG is letterboxed", () => {
    const nodes = [graphNode(0), graphNode(1)];
    const [sourceNode, targetNode] = nodes;
    if (!sourceNode || !targetNode) {
      throw new Error("Expected graph node fixtures to be present");
    }
    const layout = buildLayout(
      nodes,
      [graphEdge(sourceNode.responseId, targetNode.responseId)],
      [],
    );
    const { container, svg } = renderCanvas(layout);
    const background = getRequiredElement(
      container,
      "rect",
      isSvgRectElement,
      "graph background",
    );
    svg.getBoundingClientRect = vi.fn(() => ({
      bottom: 520,
      height: 520,
      left: 0,
      right: 1800,
      top: 0,
      width: 1800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));

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
        clientX: 0,
        clientY: 50,
        pointerId: 1,
      });
      fireEvent.pointerUp(svg, {
        pointerId: 1,
      });
    });

    expect(svg.getAttribute("viewBox")).toBe("310 170 900 520");
  });

  it("supports keyboard panning and keeps focused nodes visible", () => {
    const nodes = [graphNode(0), graphNode(1)];
    const [sourceNode, targetNode] = nodes;
    if (!sourceNode || !targetNode) {
      throw new Error("Expected graph node fixtures to be present");
    }
    const layout = buildLayout(
      nodes,
      [graphEdge(sourceNode.responseId, targetNode.responseId)],
      [],
    );
    const firstLayoutNode = layout.nodes[0];
    if (!firstLayoutNode) {
      throw new Error("Expected a layout node to be present");
    }
    firstLayoutNode.x = 1260;
    firstLayoutNode.y = 380;
    const { container, svg } = renderCanvas(layout);
    const nodeLink = getRequiredElement(
      container,
      `a[href="#response-${sourceNode.responseId}"]`,
      isSvgAnchorElement,
      "node link",
    );

    act(() => {
      fireEvent.focusIn(nodeLink);
    });
    expect(svg.getAttribute("viewBox")).toBe("416 120 900 520");

    act(() => {
      fireEvent.keyDown(nodeLink, { key: "ArrowRight" });
    });
    expect(svg.getAttribute("viewBox")).toBe("420 120 900 520");
  });
});
