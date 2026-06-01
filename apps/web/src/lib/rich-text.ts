import { isPlateQuestionType } from "@nexus-form/shared/forms/form-block";

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

function isRemovableStandaloneTextBlock(
  node: Record<string, unknown>,
): boolean {
  const type = typeof node.type === "string" ? node.type : "p";
  if (!REMOVABLE_TEXT_BLOCK_TYPES.has(type)) return false;
  if (!hasOnlyTextLikeChildren(node)) return false;

  const text = extractText(node).trim();
  return text === "" || text === "/";
}

function sanitizeNode(node: unknown, depth = 0): unknown | null {
  if (depth > MAX_DEPTH || !isRecord(node)) return node;
  if (isSlashInputNode(node)) return null;
  if (isPlateQuestionType(node.type)) return node;

  let changed = false;
  const nextNode: Record<string, unknown> = { ...node };

  const children = node.children;
  if (Array.isArray(children)) {
    const nextChildren = children
      .map((child) => sanitizeNode(child, depth + 1))
      .filter((child): child is unknown => child !== null);
    changed =
      nextChildren.length !== children.length ||
      nextChildren.some((child, index) => child !== children[index]);
    nextNode.children = nextChildren;
  }

  const nodeToCheck = changed ? nextNode : node;
  if (isRemovableStandaloneTextBlock(nodeToCheck)) return null;

  return changed ? nextNode : node;
}

export function sanitizeFormPlateContent(plateContent: unknown[]): unknown[] {
  return plateContent
    .map((node) => sanitizeNode(node))
    .filter((node): node is unknown => node !== null);
}
