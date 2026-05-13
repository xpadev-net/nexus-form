/**
 * Utility functions for working with Plate.js document content.
 * Used by both the API server and frontend.
 */

import type { FormLogicRule } from "./forms/condition-evaluator";

export const FORM_QUESTION_TYPES = [
  "form_short_text",
  "form_long_text",
  "form_radio",
  "form_checkbox",
  "form_dropdown",
  "form_linear_scale",
  "form_rating",
  "form_choice_grid",
  "form_checkbox_grid",
  "form_date",
  "form_time",
  "form_section_separator",
] as const;

function isFormQuestionType(type: unknown): boolean {
  return (
    typeof type === "string" &&
    (FORM_QUESTION_TYPES as readonly string[]).includes(type)
  );
}

export interface ExtractedQuestion {
  blockId: string;
  type: string;
  title: string;
  validation: Record<string, unknown>;
}

const HEADING_TYPES = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

/**
 * Recursively extract all text content from a Plate node's children.
 */
const MAX_DEPTH = 100;

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
 * If no non-empty heading exists, return an empty string.
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

  return "";
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

      if (isFormQuestionType(el.type)) {
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
          type: (el.type as string).replace(/^form_/, ""),
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

      if (isFormQuestionType(el.type) && typeof el.blockId === "string") {
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
      const questionIds = extractQuestionsFromPlateContent(currentNodes)
        .filter((q) => q.type !== "section_separator")
        .map((q) => q.blockId);

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
  const lastQuestionIds = extractQuestionsFromPlateContent(currentNodes)
    .filter((q) => q.type !== "section_separator")
    .map((q) => q.blockId);

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

    if (isFormQuestionType(el.type) && typeof el.blockId === "string") {
      el.nodeId = el.blockId;
    } else {
      el.nodeId = crypto.randomUUID();
    }
  }
  return nodes;
}
