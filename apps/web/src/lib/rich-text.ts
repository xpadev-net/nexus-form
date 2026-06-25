import { isPlateQuestionType } from "@nexus-form/shared/forms/form-block";
import { removeNestedQuestionsFromPlateContent } from "@nexus-form/shared/plate-content";

const MAX_DEPTH = 100;
const REMOVABLE_TEXT_BLOCK_TYPES = new Set(["p", "a", "link", "slash_input"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractText(node: unknown, depth = 0): string {
  if (depth > MAX_DEPTH || !isRecord(node)) return "";
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.children)) return "";
  return node.children.map((child) => extractText(child, depth + 1)).join("");
}

function hasOnlyTextLikeChildren(node: Record<string, unknown>): boolean {
  if (!Array.isArray(node.children)) return true;

  return node.children.every((child) => {
    if (!isRecord(child)) return true;
    if (typeof child.text === "string") return true;
    const type = typeof child.type === "string" ? child.type : "";
    return (
      REMOVABLE_TEXT_BLOCK_TYPES.has(type) && hasOnlyTextLikeChildren(child)
    );
  });
}

function isSlashInputNode(node: Record<string, unknown>): boolean {
  return node.type === "slash_input";
}

function slashInputText(node: Record<string, unknown>): string {
  const text = extractText(node);
  return text.startsWith("/") ? text : `/${text}`;
}

function createSlashInputTextNode(
  node: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  const textNode = { text: slashInputText(node) };
  return depth === 0 ? { type: "p", children: [textNode] } : textNode;
}

function hasOnlyEditorResidueChildren(children: unknown[]): boolean {
  return children.every((child) => {
    if (!isRecord(child)) return false;
    if (isSlashInputNode(child)) return true;
    if (typeof child.text === "string") return child.text.trim() === "";
    return isRemovableStandaloneTextBlock(child, true);
  });
}

function isRemovableStandaloneTextBlock(
  node: Record<string, unknown>,
  removeTextResidue: boolean,
): boolean {
  if (!removeTextResidue) return false;
  if (typeof node.type !== "string") return false;
  const type = node.type;
  if (!REMOVABLE_TEXT_BLOCK_TYPES.has(type)) return false;
  if (!hasOnlyTextLikeChildren(node)) return false;

  const text = extractText(node).trim();
  return text === "" || text === "/";
}

function sanitizeNode(
  node: unknown,
  removeTextResidue: boolean,
  depth = 0,
): unknown | null {
  if (depth > MAX_DEPTH || !isRecord(node)) return node;
  if (isSlashInputNode(node)) {
    return removeTextResidue ? null : createSlashInputTextNode(node, depth);
  }
  if (removeTextResidue && isPlateQuestionType(node.type)) return node;
  if (isRemovableStandaloneTextBlock(node, removeTextResidue)) {
    return null;
  }

  let changed = false;
  const nextNode: Record<string, unknown> = { ...node };

  const children = node.children;
  const hadOnlyEditorResidueChildren =
    Array.isArray(children) && hasOnlyEditorResidueChildren(children);
  if (Array.isArray(children)) {
    const nextChildren = children
      .map((child) => sanitizeNode(child, removeTextResidue, depth + 1))
      .filter((child): child is unknown => child !== null);
    changed =
      nextChildren.length !== children.length ||
      nextChildren.some((child, index) => child !== children[index]);
    nextNode.children = nextChildren;
  }

  const nodeToCheck = changed ? nextNode : node;
  if (
    changed &&
    removeTextResidue &&
    hadOnlyEditorResidueChildren &&
    Array.isArray(nextNode.children) &&
    nextNode.children.length === 0 &&
    typeof nextNode.type === "string" &&
    REMOVABLE_TEXT_BLOCK_TYPES.has(nextNode.type)
  ) {
    return null;
  }
  if (isRemovableStandaloneTextBlock(nodeToCheck, removeTextResidue)) {
    return null;
  }

  return changed ? nextNode : node;
}

function hasNestedQuestionNode(
  nodes: unknown[],
  insideQuestion = false,
  depth = 0,
): boolean {
  if (depth > MAX_DEPTH) return false;

  return nodes.some((node) => {
    if (!isRecord(node)) return false;

    const isQuestion = isPlateQuestionType(node.type);
    if (insideQuestion && isQuestion) return true;

    return Array.isArray(node.children)
      ? hasNestedQuestionNode(
          node.children,
          insideQuestion || isQuestion,
          depth + 1,
        )
      : false;
  });
}

export function sanitizeFormPlateContentForSave(
  plateContent: unknown[],
): unknown[] {
  const withoutUnsafeResidue = plateContent
    .map((node) => sanitizeNode(node, false))
    .filter((node): node is unknown => node !== null);

  return hasNestedQuestionNode(withoutUnsafeResidue)
    ? removeNestedQuestionsFromPlateContent(withoutUnsafeResidue)
    : withoutUnsafeResidue;
}

// Display cleanup hides editor residue from public/preview rendering only.
export function cleanupFormPlateContentForDisplay(
  plateContent: unknown[],
): unknown[] {
  const withoutTextResidue = plateContent
    .map((node) => sanitizeNode(node, true))
    .filter((node): node is unknown => node !== null);

  return hasNestedQuestionNode(withoutTextResidue)
    ? removeNestedQuestionsFromPlateContent(withoutTextResidue)
    : withoutTextResidue;
}

// Backward-compatible display sanitizer. Use sanitizeFormPlateContentForSave
// when serializing editor content for persistence.
export function sanitizeFormPlateContent(plateContent: unknown[]): unknown[] {
  return cleanupFormPlateContentForDisplay(plateContent);
}
