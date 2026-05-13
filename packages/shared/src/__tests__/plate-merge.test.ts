import { describe, expect, it } from "vitest";
import { ensureNodeIds } from "../plate-content-utils";
import { applyConflictResolutions, mergePlateContent } from "../plate-merge";

type Node = Record<string, unknown>;
type Children = Array<Node>;

/** Helper: create a simple paragraph node */
function p(nodeId: string, text: string) {
  return { type: "p", nodeId, children: [{ text }] };
}

/** Helper: create a form question node */
function question(
  blockId: string,
  type: string,
  title: string,
  validation?: Record<string, unknown>,
) {
  return {
    type: `form_${type}`,
    blockId,
    nodeId: blockId,
    children: [{ type: "h2", children: [{ text: title }] }],
    validation: validation ?? { required: false },
  };
}

/** Extract nested text from question node children[0].children[0].text */
function getQuestionTitle(node: Node): unknown {
  const children = node.children as Children | undefined;
  const heading = children?.[0] as Node | undefined;
  const headingChildren = heading?.children as Children | undefined;
  return headingChildren?.[0]?.text;
}

describe("ensureNodeIds", () => {
  it("should add nodeId to nodes without one", () => {
    const nodes: Node[] = [
      { type: "p", children: [{ text: "hello" }] },
      { type: "form_short_text", blockId: "b1", children: [{ text: "q1" }] },
    ];
    ensureNodeIds(nodes);
    expect(typeof nodes[0]?.nodeId).toBe("string");
    expect((nodes[0]?.nodeId as string).length).toBeGreaterThan(0);
    expect(nodes[1]?.nodeId).toBe("b1");
  });

  it("should not overwrite existing nodeId", () => {
    const nodes: Node[] = [
      { type: "p", nodeId: "existing", children: [{ text: "" }] },
    ];
    ensureNodeIds(nodes);
    expect(nodes[0]?.nodeId).toBe("existing");
  });
});

describe("mergePlateContent", () => {
  describe("no conflicts", () => {
    it("should merge when different nodes are edited", () => {
      const base = [
        p("n1", "unchanged"),
        question("b1", "short_text", "Question 1"),
        question("b2", "radio", "Question 2"),
      ];
      const local = [
        p("n1", "unchanged"),
        question("b1", "short_text", "Question 1 - edited by A"),
        question("b2", "radio", "Question 2"),
      ];
      const remote = [
        p("n1", "unchanged"),
        question("b1", "short_text", "Question 1"),
        question("b2", "radio", "Question 2 - edited by B"),
      ];

      const result = mergePlateContent(base, local, remote);
      expect(result.hasConflict).toBe(false);
      expect(result.conflicts).toHaveLength(0);

      const mergedQ1 = result.merged.find(
        (n) => (n as Node).nodeId === "b1",
      ) as Node;
      const mergedQ2 = result.merged.find(
        (n) => (n as Node).nodeId === "b2",
      ) as Node;

      expect(getQuestionTitle(mergedQ1)).toBe("Question 1 - edited by A");
      expect(getQuestionTitle(mergedQ2)).toBe("Question 2 - edited by B");
    });

    it("should handle when no changes are made", () => {
      const base = [p("n1", "text"), question("b1", "short_text", "Q1")];
      const local = [p("n1", "text"), question("b1", "short_text", "Q1")];
      const remote = [p("n1", "text"), question("b1", "short_text", "Q1")];

      const result = mergePlateContent(base, local, remote);
      expect(result.hasConflict).toBe(false);
      expect(result.merged).toHaveLength(2);
    });

    it("should merge node addition by local only", () => {
      const base = [p("n1", "intro")];
      const local = [
        p("n1", "intro"),
        question("b-new", "short_text", "New question"),
      ];
      const remote = [p("n1", "intro")];

      const result = mergePlateContent(base, local, remote);
      expect(result.hasConflict).toBe(false);
      expect(result.merged).toHaveLength(2);
    });

    it("should merge node addition by remote only", () => {
      const base = [p("n1", "intro")];
      const local = [p("n1", "intro")];
      const remote = [
        p("n1", "intro"),
        question("b-new", "short_text", "New question"),
      ];

      const result = mergePlateContent(base, local, remote);
      expect(result.hasConflict).toBe(false);
      expect(result.merged).toHaveLength(2);
    });

    it("should merge deletion when node is unchanged", () => {
      const base = [p("n1", "intro"), p("n2", "to delete")];
      const local = [p("n1", "intro")]; // n2 deleted
      const remote = [p("n1", "intro"), p("n2", "to delete")];

      const result = mergePlateContent(base, local, remote);
      expect(result.hasConflict).toBe(false);
      expect(result.merged).toHaveLength(1);
    });

    it("should merge when both sides delete the same node", () => {
      const base = [p("n1", "intro"), p("n2", "to delete")];
      const local = [p("n1", "intro")]; // n2 deleted
      const remote = [p("n1", "intro")]; // n2 also deleted

      const result = mergePlateContent(base, local, remote);
      expect(result.hasConflict).toBe(false);
      expect(result.merged).toHaveLength(1);
    });

    it("should accept identical changes from both sides", () => {
      const base = [question("b1", "short_text", "Original")];
      const local = [question("b1", "short_text", "Same edit")];
      const remote = [question("b1", "short_text", "Same edit")];

      const result = mergePlateContent(base, local, remote);
      expect(result.hasConflict).toBe(false);
    });

    it("should ignore nested identity keys in content comparison", () => {
      const base = [question("b1", "short_text", "Original")];
      const local = [question("b1", "short_text", "Original")];
      const remote = [question("b1", "short_text", "Original")];

      const localHeading = (((local[0] as Node).children as Children)[0] ??
        {}) as Node;
      const remoteHeading = (((remote[0] as Node).children as Children)[0] ??
        {}) as Node;
      localHeading.nodeId = "heading-local";
      localHeading.blockId = "heading-local";
      remoteHeading.nodeId = "heading-remote";
      remoteHeading.blockId = "heading-remote";

      const result = mergePlateContent(base, local, remote);
      expect(result.hasConflict).toBe(false);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe("conflicts", () => {
    it("should detect conflict when same node is modified differently", () => {
      const base = [question("b1", "short_text", "Original")];
      const local = [question("b1", "short_text", "Edit by A")];
      const remote = [question("b1", "short_text", "Edit by B")];

      const result = mergePlateContent(base, local, remote);
      expect(result.hasConflict).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.nodeId).toBe("b1");
      expect(result.conflicts[0]?.conflictType).toBe("modified_both");
    });

    it("should detect conflict when one deletes and other modifies", () => {
      const base = [p("n1", "intro"), question("b1", "short_text", "Original")];
      const local = [p("n1", "intro")]; // b1 deleted
      const remote = [
        p("n1", "intro"),
        question("b1", "short_text", "Modified by B"),
      ];

      const result = mergePlateContent(base, local, remote);
      expect(result.hasConflict).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.conflictType).toBe("deleted_vs_modified");
      expect(result.conflicts[0]?.local).toBeNull();
    });

    it("should detect conflict when local modifies and remote deletes", () => {
      const base = [question("b1", "short_text", "Original")];
      const local = [question("b1", "short_text", "Modified by A")];
      const remote: ReturnType<typeof question>[] = []; // b1 deleted

      const result = mergePlateContent(base, local, remote);
      expect(result.hasConflict).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.conflictType).toBe("deleted_vs_modified");
      expect(result.conflicts[0]?.remote).toBeNull();
    });
  });

  describe("ordering", () => {
    it("should preserve remote ordering as base", () => {
      const base = [p("n1", "first"), p("n2", "second"), p("n3", "third")];
      const local = [p("n1", "first"), p("n2", "second"), p("n3", "third")];
      const remote = [p("n3", "third"), p("n1", "first"), p("n2", "second")];

      const result = mergePlateContent(base, local, remote);
      expect(result.hasConflict).toBe(false);
      const ids = result.merged.map((n) => (n as Node).nodeId);
      expect(ids).toEqual(["n3", "n1", "n2"]);
    });

    it("should insert local-only additions at correct position", () => {
      const base = [p("n1", "first"), p("n3", "third")];
      const local = [p("n1", "first"), p("n2", "new"), p("n3", "third")];
      const remote = [p("n1", "first"), p("n3", "third")];

      const result = mergePlateContent(base, local, remote);
      expect(result.hasConflict).toBe(false);
      const ids = result.merged.map((n) => (n as Node).nodeId);
      expect(ids).toEqual(["n1", "n2", "n3"]);
    });

    it("should preserve position of local-modified node when remote deleted it", () => {
      const base = [p("n1", "a"), p("n2", "b"), p("n3", "c")];
      const local = [p("n1", "a"), p("n2", "b-edited"), p("n3", "c")];
      const remote = [p("n1", "a"), p("n3", "c")]; // n2 deleted

      const result = mergePlateContent(base, local, remote);
      expect(result.hasConflict).toBe(true);
      const ids = result.merged.map((n) => (n as Node).nodeId);
      // n2 must stay between n1 and n3, not jump to the end
      expect(ids).toEqual(["n1", "n2", "n3"]);
    });
  });

  describe("nodes without nodeId", () => {
    it("should NOT be called without pre-assigned nodeIds (produces duplicates)", () => {
      // This test documents incorrect behavior when nodeIds are not
      // pre-assigned: each clone gets a fresh UUID, so the merge treats
      // one logical node as three separate additions → duplicates.
      // Callers MUST call ensureNodeIds() on shared content before merging.
      const base = [{ type: "p", children: [{ text: "no id" }] }];
      const local = [{ type: "p", children: [{ text: "no id" }] }];
      const remote = [{ type: "p", children: [{ text: "no id" }] }];

      const result = mergePlateContent(base, local, remote);
      // Without pre-assigned IDs, the result incorrectly contains 3 nodes
      // (each version's paragraph treated as a separate addition).
      // This is expected — callers must pre-assign stable IDs.
      expect(result.merged.length).toBeGreaterThan(1);
    });

    it("should merge correctly when nodeIds are pre-assigned", () => {
      const shared = [{ type: "p", nodeId: "p1", children: [{ text: "ok" }] }];
      const result = mergePlateContent(shared, shared, shared);
      expect(result.merged).toHaveLength(1);
      expect(result.hasConflict).toBe(false);
    });
  });
});

describe("applyConflictResolutions", () => {
  it("should apply local resolution for modified_both conflict", () => {
    const base = [question("b1", "short_text", "Original")];
    const local = [question("b1", "short_text", "Local edit")];
    const remote = [question("b1", "short_text", "Remote edit")];

    const result = mergePlateContent(base, local, remote);
    expect(result.hasConflict).toBe(true);

    const resolved = applyConflictResolutions(result, { b1: "local" });
    const node = resolved.find((n) => (n as Node).nodeId === "b1") as Node;
    expect(getQuestionTitle(node)).toBe("Local edit");
  });

  it("should apply remote resolution for modified_both conflict", () => {
    const base = [question("b1", "short_text", "Original")];
    const local = [question("b1", "short_text", "Local edit")];
    const remote = [question("b1", "short_text", "Remote edit")];

    const result = mergePlateContent(base, local, remote);
    const resolved = applyConflictResolutions(result, { b1: "remote" });
    const node = resolved.find((n) => (n as Node).nodeId === "b1") as Node;
    expect(getQuestionTitle(node)).toBe("Remote edit");
  });

  it("should remove node when resolution is local=delete", () => {
    const base = [p("n1", "intro"), question("b1", "short_text", "Original")];
    const local = [p("n1", "intro")]; // b1 deleted
    const remote = [p("n1", "intro"), question("b1", "short_text", "Modified")];

    const result = mergePlateContent(base, local, remote);
    expect(result.hasConflict).toBe(true);

    const resolved = applyConflictResolutions(result, { b1: "local" });
    expect(resolved).toHaveLength(1);
  });

  it("should keep modified node when resolution is remote for delete conflict", () => {
    const base = [p("n1", "intro"), question("b1", "short_text", "Original")];
    const local = [p("n1", "intro")]; // b1 deleted
    const remote = [p("n1", "intro"), question("b1", "short_text", "Modified")];

    const result = mergePlateContent(base, local, remote);
    const resolved = applyConflictResolutions(result, { b1: "remote" });
    expect(resolved).toHaveLength(2);
  });
});
