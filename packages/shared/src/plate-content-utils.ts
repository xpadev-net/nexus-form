/**
 * Utility functions for working with Plate.js document content.
 * Used by both the API server and frontend.
 */

import type { FormLogicRule } from "./forms/condition-evaluator";
import {
  type AnswerableBlockTypeValue,
  FORM_QUESTION_TYPES,
  fromPlateQuestionType,
  isAnswerableBlockType,
  isPlateQuestionType,
} from "./forms/form-block";

export { FORM_QUESTION_TYPES };

export interface ExtractedQuestion {
  blockId: string;
  type: string;
  title: string;
  validation: Record<string, unknown>;
}

export interface ExtractedAnswerableQuestion extends ExtractedQuestion {
  type: AnswerableBlockTypeValue;
}

const HEADING_TYPES = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

/**
 * Recursively extract all text content from a Plate node's children.
 */
const MAX_DEPTH = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function createEmptyParagraphNode() {
  return {
    type: "p",
    children: [{ text: "" }],
  };
}

export function extractTextFromChildren(
  children: unknown[],
  depth = 0,
): string {
  if (depth > MAX_DEPTH) return "";
  const parts: string[] = [];

  for (const child of children) {
    if (child == null || typeof child !== "object") continue;
    const node = child as Record<string, unknown>;

    // Leaf text node
    if (typeof node.text === "string") {
      parts.push(node.text);
      continue;
    }

    // Element node with children
    if (Array.isArray(node.children)) {
      parts.push(extractTextFromChildren(node.children, depth + 1));
    }
  }

  return parts.join("");
}

/**
 * Extract a title from a Plate node's children, prioritizing heading blocks.
 * If no non-empty heading exists, fall back to all visible child text.
 */
export function extractTitleFromChildren(children: unknown[]): string {
  let bestHeading: {
    headingIndex: number;
    node: Record<string, unknown>;
  } | null = null;

  for (const child of children) {
    if (child == null || typeof child !== "object") continue;
    const node = child as Record<string, unknown>;
    const type = node.type;
    if (typeof type === "string") {
      const headingIndex = (HEADING_TYPES as readonly string[]).indexOf(type);
      if (headingIndex !== -1) {
        if (bestHeading === null || headingIndex < bestHeading.headingIndex) {
          bestHeading = { headingIndex, node };
        }
      }
    }
  }

  if (bestHeading !== null) {
    const headingText = Array.isArray(bestHeading.node.children)
      ? extractTextFromChildren(bestHeading.node.children as unknown[]).trim()
      : "";
    if (headingText) return headingText;
  }

  return extractTextFromChildren(children).trim();
}

/**
 * Extract form question nodes from a Plate Value JSON document.
 * Recursively walks the document tree to find all form question elements.
 */
export function extractQuestionsFromPlateContent(
  plateContent: unknown[],
): ExtractedQuestion[] {
  const questions: ExtractedQuestion[] = [];

  function walk(nodes: unknown[], depth = 0): void {
    if (depth > MAX_DEPTH) return;
    for (const node of nodes) {
      if (node == null || typeof node !== "object") continue;
      const el = node as Record<string, unknown>;

      if (isPlateQuestionType(el.type)) {
        const blockId = typeof el.blockId === "string" ? el.blockId : "";
        const title = Array.isArray(el.children)
          ? extractTitleFromChildren(el.children as unknown[])
          : "";
        const validation =
          el.validation != null && typeof el.validation === "object"
            ? (el.validation as Record<string, unknown>)
            : {};

        questions.push({
          blockId,
          type: fromPlateQuestionType(el.type),
          title,
          validation,
        });
      }

      // Recurse into children (e.g., columns, toggles may contain questions)
      if (Array.isArray(el.children)) {
        walk(el.children, depth + 1);
      }
    }
  }

  walk(plateContent);
  return questions;
}

/**
 * Extract only Plate form question nodes that accept user answers.
 */
export function extractAnswerableQuestionsFromPlateContent(
  plateContent: unknown[],
): ExtractedAnswerableQuestion[] {
  return extractQuestionsFromPlateContent(plateContent).flatMap((question) => {
    if (!isAnswerableBlockType(question.type)) return [];
    return [{ ...question, type: question.type }];
  });
}

/**
 * Deep-clone a Plate document and regenerate all blockId values
 * with new UUIDs. Used for form duplication.
 */
export function regenerateBlockIds(plateContent: unknown[]): unknown[] {
  function cloneAndRegenerate(nodes: unknown[], depth = 0): unknown[] {
    if (depth > MAX_DEPTH) return nodes;
    return nodes.map((node) => {
      if (node == null || typeof node !== "object") return node;
      // Deep clone via JSON round-trip to avoid shared nested objects
      // (e.g. validation). Safe because Plate content is pure JSON.
      const el = JSON.parse(JSON.stringify(node)) as Record<string, unknown>;

      if (isPlateQuestionType(el.type) && typeof el.blockId === "string") {
        el.blockId = crypto.randomUUID();
      }

      if (Array.isArray(el.children)) {
        el.children = cloneAndRegenerate(el.children, depth + 1);
      }

      return el;
    });
  }

  return cloneAndRegenerate(plateContent);
}

/**
 * Remove form question nodes that were inserted inside another form question.
 *
 * The outer question is preserved, while the nested question wrapper and its
 * structural data are removed so its visible title/description text remains
 * ordinary rich-text content.
 */
export function removeNestedQuestionsFromPlateContent(
  plateContent: unknown[],
): unknown[] {
  function sanitizeNodes(
    nodes: unknown[],
    insideQuestion: boolean,
    depth = 0,
  ): unknown[] {
    if (depth > MAX_DEPTH) return nodes;

    return nodes.flatMap((node) =>
      sanitizeNode(node, insideQuestion, depth + 1),
    );
  }

  function sanitizeNode(
    node: unknown,
    insideQuestion: boolean,
    depth: number,
  ): unknown[] {
    if (!isRecord(node)) return [node];

    const isQuestion = isPlateQuestionType(node.type);
    const clone = { ...node };

    if (Array.isArray(node.children)) {
      clone.children = sanitizeNodes(
        node.children,
        insideQuestion || isQuestion,
        depth,
      );
    }

    if (insideQuestion && isQuestion) {
      if (Array.isArray(clone.children) && clone.children.length > 0) {
        return clone.children;
      }
      return [createEmptyParagraphNode()];
    }

    return [clone];
  }

  return sanitizeNodes(plateContent, false);
}

// ===== Page splitting =====

export interface PlatePage {
  /** Page ID: blockId of the preceding form_section_separator, or "default" for the first page */
  pageId: string;
  /** Section title extracted from the separator's text children */
  title?: string;
  /** PlateJS nodes belonging to this page */
  nodes: unknown[];
  /** blockIds of form question elements in this page */
  questionIds: string[];
  /** Navigation rules attached to this page */
  navigationRules?: FormLogicRule[];
  /** Default action when no navigation rule matches */
  defaultAction?: {
    type: "jump_to_section" | "next" | "submit";
    target_id?: string;
    metadata?: Record<string, unknown>;
  };
}

export type CompletionTargetActionSource = "default_action" | "navigation_rule";

export interface CompletionTargetReference {
  /** Page whose submit action points at the completion target. */
  sourcePageId: string;
  /** Whether the target came from the page default action or a conditional rule. */
  actionSource: CompletionTargetActionSource;
  /** Conditional navigation rule ID when actionSource is "navigation_rule". */
  ruleId?: string;
  /** Conditional navigation rule name when actionSource is "navigation_rule". */
  ruleName?: string;
  /** Page ID referenced by submit.target_id. */
  targetPageId: string;
}

export interface CompletionTargetNotFoundIssue
  extends CompletionTargetReference {
  code: "completion_target_not_found";
}

export interface CompletionTargetHasAnswerableQuestionsIssue
  extends CompletionTargetReference {
  code: "completion_target_has_answerable_questions";
  answerableQuestionIds: string[];
}

export type CompletionTargetValidationIssue =
  | CompletionTargetNotFoundIssue
  | CompletionTargetHasAnswerableQuestionsIssue;

/**
 * Split a PlateJS document into pages delimited by form_section_separator nodes.
 * Each page contains the nodes between two separators (or document boundaries).
 * Navigation rules are read from section separator validation.
 */
export function splitPlateContentIntoPages(
  plateContent: unknown[],
): PlatePage[] {
  const pages: PlatePage[] = [];
  let currentNodes: unknown[] = [];
  let currentPageId = "default";
  let currentTitle: string | undefined;
  let currentNavigationRules: FormLogicRule[] | undefined;
  let currentDefaultAction: PlatePage["defaultAction"] | undefined;

  for (const node of plateContent) {
    if (node == null || typeof node !== "object") {
      currentNodes.push(node);
      continue;
    }

    const el = node as Record<string, unknown>;

    if (el.type === "form_section_separator") {
      const sepValidation = el.validation as
        | Record<string, unknown>
        | undefined;
      if (sepValidation && "navigation_rules" in sepValidation) {
        currentNavigationRules =
          Array.isArray(sepValidation.navigation_rules) &&
          sepValidation.navigation_rules.length > 0
            ? (sepValidation.navigation_rules as FormLogicRule[])
            : undefined;
      }
      if (sepValidation && "default_action" in sepValidation) {
        currentDefaultAction =
          sepValidation.default_action != null &&
          typeof sepValidation.default_action === "object"
            ? (sepValidation.default_action as PlatePage["defaultAction"])
            : undefined;
      }

      // Finalize the current page
      const questionIds = extractAnswerableQuestionsFromPlateContent(
        currentNodes,
      ).map((q) => q.blockId);

      pages.push({
        pageId: currentPageId,
        title: currentTitle,
        nodes: currentNodes,
        questionIds,
        navigationRules: currentNavigationRules,
        defaultAction: currentDefaultAction,
      });

      // Start a new page
      currentNodes = [];
      currentPageId =
        typeof el.blockId === "string" ? el.blockId : `page-${pages.length}`;
      currentTitle = Array.isArray(el.children)
        ? extractTextFromChildren(el.children)
        : undefined;
      currentNavigationRules = undefined;
      currentDefaultAction = undefined;
    } else {
      currentNodes.push(node);
    }
  }

  // Finalize the last page
  const lastQuestionIds = extractAnswerableQuestionsFromPlateContent(
    currentNodes,
  ).map((q) => q.blockId);

  pages.push({
    pageId: currentPageId,
    title: currentTitle,
    nodes: currentNodes,
    questionIds: lastQuestionIds,
    navigationRules: currentNavigationRules,
    defaultAction: currentDefaultAction,
  });

  return pages;
}

/**
 * Resolve a page index by page ID.
 * Returns -1 if not found.
 */
export function resolvePageIndexByPageId(
  pages: PlatePage[],
  targetPageId: string | undefined,
): number {
  if (!targetPageId) return -1;
  return pages.findIndex((p) => p.pageId === targetPageId);
}

/**
 * Completion target pages render after submit and must not contain answerable
 * question blocks.
 */
export function isCompletionTargetPage(page: PlatePage): boolean {
  return page.questionIds.length === 0;
}

function getSubmitTargetPageId(action: unknown): string | undefined {
  if (!isRecord(action)) return undefined;
  if (action.type !== "submit") return undefined;
  return typeof action.target_id === "string" && action.target_id.length > 0
    ? action.target_id
    : undefined;
}

/**
 * Find submit actions that explicitly point at completion target pages.
 * Submit actions without target_id are kept valid for legacy confirmation flow.
 */
export function getCompletionTargetReferences(
  pages: PlatePage[],
): CompletionTargetReference[] {
  const references: CompletionTargetReference[] = [];

  for (const page of pages) {
    const defaultTargetPageId = getSubmitTargetPageId(page.defaultAction);
    if (defaultTargetPageId) {
      references.push({
        sourcePageId: page.pageId,
        actionSource: "default_action",
        targetPageId: defaultTargetPageId,
      });
    }

    for (const rule of page.navigationRules ?? []) {
      if (!isRecord(rule)) continue;
      const targetPageId = getSubmitTargetPageId(rule.action);
      if (!targetPageId) continue;
      references.push({
        sourcePageId: page.pageId,
        actionSource: "navigation_rule",
        ruleId: typeof rule.id === "string" ? rule.id : undefined,
        ruleName: typeof rule.name === "string" ? rule.name : undefined,
        targetPageId,
      });
    }
  }

  return references;
}

/**
 * Validate that submit.target_id references point at existing inputless pages.
 */
export function validateCompletionTargetPages(
  pages: PlatePage[],
): CompletionTargetValidationIssue[] {
  const issues: CompletionTargetValidationIssue[] = [];

  for (const reference of getCompletionTargetReferences(pages)) {
    const targetIndex = resolvePageIndexByPageId(pages, reference.targetPageId);
    if (targetIndex === -1) {
      issues.push({
        ...reference,
        code: "completion_target_not_found",
      });
      continue;
    }

    const targetPage = pages[targetIndex];
    if (targetPage && !isCompletionTargetPage(targetPage)) {
      issues.push({
        ...reference,
        code: "completion_target_has_answerable_questions",
        answerableQuestionIds: targetPage.questionIds,
      });
    }
  }

  return issues;
}

/**
 * Split Plate content and validate submit.target_id completion targets.
 */
export function validateCompletionTargetsInPlateContent(
  plateContent: unknown[],
): CompletionTargetValidationIssue[] {
  return validateCompletionTargetPages(
    splitPlateContentIntoPages(plateContent),
  );
}

/**
 * Basic validation of Plate Value JSON structure.
 * Checks that the content is an array of objects with children.
 */
export function validatePlateContent(content: unknown): content is unknown[] {
  if (!Array.isArray(content)) return false;

  for (const node of content) {
    if (node == null || typeof node !== "object") return false;
    const el = node as Record<string, unknown>;

    // Every top-level node must have children array
    if (!Array.isArray(el.children)) return false;
    if (!validatePlateNodeTree(el, false)) return false;
  }

  return true;
}

function validatePlateNodeTree(
  node: Record<string, unknown>,
  insideQuestion: boolean,
  depth = 0,
): boolean {
  if (depth > MAX_DEPTH) return false;
  const isQuestion = isPlateQuestionType(node.type);
  if (insideQuestion && isQuestion) return false;

  const children = node.children;
  if (!Array.isArray(children)) return true;

  for (const child of children) {
    if (child == null || typeof child !== "object") continue;
    if (
      !validatePlateNodeTree(
        child as Record<string, unknown>,
        insideQuestion || isQuestion,
        depth + 1,
      )
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Ensure every top-level node has a stable `nodeId` for merge tracking.
 *
 * - Form question nodes: copies `blockId` to `nodeId` (if nodeId is absent).
 * - Other nodes: generates a new UUID as `nodeId`.
 * - Nodes that already have a `nodeId` are left untouched.
 *
 * Mutates the array in-place and returns it for convenience.
 */
export function ensureNodeIds(nodes: unknown[]): unknown[] {
  for (const node of nodes) {
    if (node == null || typeof node !== "object") continue;
    const el = node as Record<string, unknown>;

    if (typeof el.nodeId === "string" && el.nodeId.length > 0) continue;

    if (isPlateQuestionType(el.type) && typeof el.blockId === "string") {
      el.nodeId = el.blockId;
    } else {
      el.nodeId = crypto.randomUUID();
    }
  }
  return nodes;
}
