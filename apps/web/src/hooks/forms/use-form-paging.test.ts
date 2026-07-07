import {
  type PlatePage,
  resolveReachableFormContent,
} from "@nexus-form/shared";
import { describe, expect, it } from "vitest";
import { resolveReachablePageIndexes } from "./use-form-paging";

interface AnswerEntry {
  value?: unknown;
  values?: unknown[];
  responses?: Record<string, unknown>;
}

const pages: PlatePage[] = [
  {
    pageId: "default",
    nodes: [],
    questionIds: ["question-kind"],
    navigationRules: [
      {
        id: "rule-jump-vip",
        name: "VIP",
        conditions: [
          {
            question_id: "question-kind",
            operator: "equals",
            value: "vip",
          },
        ],
        condition_match: "all",
        action: { type: "jump_to_section", target_id: "section-vip" },
      },
    ],
    defaultAction: { type: "next" },
  },
  {
    pageId: "section-regular",
    nodes: [],
    questionIds: ["question-regular"],
    defaultAction: { type: "submit" },
  },
  {
    pageId: "section-vip",
    nodes: [],
    questionIds: ["question-vip"],
    defaultAction: { type: "submit" },
  },
];

function toAnswerMap(entries: Record<string, AnswerEntry>) {
  return new Map(Object.entries(entries));
}

describe("resolveReachablePageIndexes", () => {
  it("delegates reachability semantics to the shared helper", () => {
    const answers = toAnswerMap({ "question-kind": { value: "vip" } });
    const responses = { "question-kind": "vip" };

    expect(resolveReachablePageIndexes(pages, answers)).toEqual(
      resolveReachableFormContent(pages, responses).pageIndexes,
    );
    expect(resolveReachablePageIndexes(pages, answers)).toEqual([0, 2]);
  });
});
