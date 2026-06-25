const BLOCK_CONTEXT_MENU_TARGET_SELECTOR =
  "[data-block-context-menu-target]";

export const BLOCK_CONTEXT_MENU_TARGET_ATTRIBUTE =
  "data-block-context-menu-target";

type ResolveBlockContextMenuTargetOptions = {
  clientX: number;
  clientY: number;
  root: Element;
  target: EventTarget | null;
};

export function getEventTargetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node && target.parentElement) {
    return target.parentElement;
  }

  return null;
}

function findBlockContextMenuTargetElement(
  root: Element,
  start: Element | null,
): Element | null {
  if (!start || !root.contains(start)) {
    return null;
  }

  const targetElement = start.closest(BLOCK_CONTEXT_MENU_TARGET_SELECTOR);

  if (!targetElement || !root.contains(targetElement)) {
    return null;
  }

  return targetElement;
}

export function resolveBlockContextMenuTargetId({
  clientX,
  clientY,
  root,
  target,
}: ResolveBlockContextMenuTargetOptions): string | null {
  const ownerDocument = root.ownerDocument;
  const hitElement =
    typeof ownerDocument.elementFromPoint === "function"
      ? ownerDocument.elementFromPoint(clientX, clientY)
      : null;
  const targetElement =
    findBlockContextMenuTargetElement(root, hitElement) ??
    findBlockContextMenuTargetElement(root, getEventTargetElement(target));

  return targetElement?.getAttribute(BLOCK_CONTEXT_MENU_TARGET_ATTRIBUTE) ?? null;
}

export function shouldKeepBlockContextMenuSelection(
  selectedBlockIds: readonly string[],
  targetBlockId: string,
): boolean {
  return selectedBlockIds.includes(targetBlockId);
}
