import { DndPlugin, useDraggable, useDropLine } from "@platejs/dnd";
import { expandListItemsWithChildren } from "@platejs/list";
import { BlockSelectionPlugin } from "@platejs/selection/react";
import { GripVertical } from "lucide-react";
import { getPluginByType, isType, KEYS, type TElement } from "platejs";
import {
  MemoizedChildren,
  type PlateEditor,
  type PlateElementProps,
  type RenderNodeWrapper,
  useEditorRef,
  useElement,
  usePluginOption,
  useSelected,
} from "platejs/react";
import {
  type ComponentProps,
  memo,
  useCallback,
  useMemo,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isFormQuestionType } from "@/components/editor/plate-types";
import { cn } from "@/lib/utils";

const UNDRAGGABLE_KEYS = [KEYS.column, KEYS.tr, KEYS.td];

export const BlockDraggable: RenderNodeWrapper = (props) => {
  const { editor, element, path } = props;

  const enabled = useMemo(() => {
    if (editor.dom.readOnly) return false;

    if (path.length === 1 && !isType(editor, element, UNDRAGGABLE_KEYS)) {
      return true;
    }
    // Children inside form question containers (depth 2)
    if (path.length === 2 && !isType(editor, element, UNDRAGGABLE_KEYS)) {
      const parentEntry = editor.api.node(path.slice(0, -1));
      if (
        parentEntry &&
        typeof parentEntry[0].type === "string" &&
        isFormQuestionType(parentEntry[0].type)
      ) {
        return true;
      }
    }
    if (path.length === 3 && !isType(editor, element, UNDRAGGABLE_KEYS)) {
      const block = editor.api.some({
        at: path,
        match: {
          type: editor.getType(KEYS.column),
        },
      });

      if (block) {
        return true;
      }
    }
    if (path.length === 4 && !isType(editor, element, UNDRAGGABLE_KEYS)) {
      const block = editor.api.some({
        at: path,
        match: {
          type: editor.getType(KEYS.table),
        },
      });

      if (block) {
        return true;
      }
    }

    return false;
  }, [editor, element, path]);

  if (!enabled) return;

  return (props) => <Draggable {...props} />;
};

function Draggable(props: PlateElementProps) {
  const { children, editor, element, path } = props;
  const blockSelectionApi = editor.getApi(BlockSelectionPlugin).blockSelection;

  const { isAboutToDrag, isDragging, nodeRef, previewRef, handleRef } =
    useDraggable({
      element,
      onDropHandler: (_, { dragItem }) => {
        const id = (dragItem as { id: string[] | string }).id;

        if (blockSelectionApi) {
          blockSelectionApi.add(id);
        }
        resetPreview();
      },
    });

  const isInFormQuestion = path.length === 2;
  const isInColumn = path.length === 3;
  const isInTable = path.length === 4;

  const [previewTop, setPreviewTop] = useState(0);

  const resetPreview = useCallback(() => {
    if (previewRef.current) {
      previewRef.current.replaceChildren();
      previewRef.current?.classList.add("hidden");
    }
  }, [previewRef]);

  const [dragButtonTop, setDragButtonTop] = useState(0);
  const blockTypeLabel = String(element.type);

  return (
    <div
      role="group"
      aria-label={`Editor block: ${blockTypeLabel}`}
      className={cn(
        "relative",
        isDragging && "opacity-50",
        getPluginByType(editor, element.type)?.node.isContainer
          ? "group/container"
          : "group",
      )}
      onMouseEnter={() => {
        if (isDragging) return;
        setDragButtonTop(calcDragButtonTop(editor, element));
      }}
    >
      {!isInTable && (
        <Gutter>
          <div
            className={cn(
              "slate-blockToolbarWrapper",
              "flex h-[1.5em]",
              (isInColumn || isInFormQuestion) && "h-4",
            )}
          >
            <div
              className={cn(
                "slate-blockToolbar relative w-4.5",
                "pointer-events-auto mr-1 flex items-center",
                (isInColumn || isInFormQuestion) && "mr-1.5",
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    ref={handleRef}
                    variant="ghost"
                    className="-left-0 absolute h-6 w-full p-0"
                    style={{ top: `${dragButtonTop + 3}px` }}
                    aria-label="ブロックを移動"
                    data-plate-prevent-deselect
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    blockSelectionApi.focus();
                  }
                }}
                onMouseDown={(event) => {
                  if (event.button !== 0 && event.button !== 2) return;
                  if (event.shiftKey) return;

                  event.preventDefault();
                  resetPreview();

                      const blockSelection = blockSelectionApi.getNodes({ sort: true });
                      let selectionNodes =
                        blockSelection.length > 0
                          ? blockSelection
                          : editor.api.blocks({ mode: "highest" });

                      // If current block is not in selection, use it as the starting point
                      if (
                        !selectionNodes.some(([node]) => node.id === element.id)
                      ) {
                        const elementPath = editor.api.findPath(element);
                        if (elementPath) selectionNodes = [[element, elementPath]];
                      }

                      // Process selection nodes to include list children
                      const blocks = expandListItemsWithChildren(
                        editor,
                        selectionNodes,
                      ).map(([node]) => node);

                      if (blockSelection.length === 0) {
                        editor.tf.blur();
                        editor.tf.collapse();
                      }

                  const elements = createDragPreviewElements(editor, blocks);
                  previewRef.current?.replaceChildren(...elements);
                  previewRef.current?.classList.remove("hidden");
                  previewRef.current?.classList.add("opacity-0");
                  editor.setOption(DndPlugin, "multiplePreviewRef", previewRef);

                  blockSelectionApi.set(blocks.map((block) => block.id as string));
                  blockSelectionApi.focus();
                }}
                    onMouseEnter={() => {
                      if (isDragging) return;

                      const blockSelection = blockSelectionApi.getNodes({ sort: true });
                      let selectedBlocks =
                        blockSelection.length > 0
                          ? blockSelection
                          : editor.api.blocks({ mode: "highest" });

                      // If current block is not in selection, use it as the starting point
                      if (!selectedBlocks.some(([node]) => node.id === element.id)) {
                        const elementPath = editor.api.findPath(element);
                        if (elementPath) selectedBlocks = [[element, elementPath]];
                      }

                      // Process selection to include list children
                      const processedBlocks = expandListItemsWithChildren(
                        editor,
                        selectedBlocks,
                      );

                      const ids = processedBlocks.map((block) => block[0].id as string);

                      if (ids.length > 1 && ids.includes(element.id as string)) {
                        const previewTop = calculatePreviewTop(editor, {
                          blocks: processedBlocks.map((block) => block[0]),
                          element,
                        });
                        setPreviewTop(previewTop);
                      } else {
                        setPreviewTop(0);
                      }
                    }}
                    onMouseUp={() => {
                      resetPreview();
                    }}
                  >
                    <DragHandle />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Drag to move</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </Gutter>
      )}

      <div
        ref={previewRef}
        className={cn(
          "-left-0 absolute w-full",
          !(isAboutToDrag || isDragging) && "hidden",
        )}
        style={{ top: `${-previewTop}px` }}
        contentEditable={false}
      />

      <div
        ref={nodeRef}
        role="group"
        aria-label={`Editor block content: ${blockTypeLabel}`}
        className="slate-blockWrapper relative flow-root"
        onContextMenu={(event) =>
          editor
            .getApi(BlockSelectionPlugin)
            .blockSelection.addOnContextMenu({ element, event })
        }
      >
        <MemoizedChildren>{children}</MemoizedChildren>
        <DropLine />
      </div>
    </div>
  );
}

function Gutter({
  children,
  className,
  ...props
}: ComponentProps<"div">) {
  const editor = useEditorRef();
  const element = useElement();
  const isSelectionAreaVisible = usePluginOption(
    BlockSelectionPlugin,
    "isSelectionAreaVisible",
  );
  const selected = useSelected();

  return (
    <div
      {...props}
      className={cn(
        "slate-gutterLeft",
        "-translate-x-full absolute top-0 z-50 flex h-full cursor-text hover:opacity-100 sm:opacity-0",
        getPluginByType(editor, element.type)?.node.isContainer
          ? "group-hover/container:opacity-100"
          : "group-hover:opacity-100",
        isSelectionAreaVisible && "hidden",
        !selected && "opacity-0",
        className,
      )}
      contentEditable={false}
    >
      {children}
    </div>
  );
}

const DragHandle = memo(function DragHandle() {
  return (
    <div className="flex size-full items-center justify-center">
      <GripVertical className="text-muted-foreground" />
    </div>
  );
});

const DropLine = memo(function DropLine({
  className,
  ...props
}: ComponentProps<"div">) {
  const { dropLine } = useDropLine();

  if (!dropLine) return null;

  return (
    <div
      {...props}
      className={cn(
        "slate-dropLine",
        "pointer-events-none absolute inset-x-0 z-50",
        dropLine === "top" && "-top-0.5",
        dropLine === "bottom" && "-bottom-0.5",
        className,
      )}
    >
      <div
        className={cn(
          "-left-1 absolute top-1/2 -translate-y-1/2",
          "size-2 rounded-full",
          "bg-primary ring-2 ring-background",
        )}
      />
      <div className="h-0.5 rounded-full bg-primary" />
    </div>
  );
});

const createDragPreviewElements = (
  editor: PlateEditor,
  blocks: TElement[],
): HTMLElement[] => {
  const elements: HTMLElement[] = [];
  const ids: string[] = [];

  /**
   * Remove data attributes from the element to avoid recognized as slate
   * elements incorrectly.
   */
  const removeDataAttributes = (element: HTMLElement) => {
    Array.from(element.attributes).forEach((attr) => {
      if (
        attr.name.startsWith("data-slate") ||
        attr.name.startsWith("data-block-id")
      ) {
        element.removeAttribute(attr.name);
      }
    });

    Array.from(element.children).forEach((child) => {
      removeDataAttributes(child as HTMLElement);
    });
  };

  const resolveElement = (node: TElement, index: number) => {
    const domNode = editor.api.toDOMNode(node);

    if (!domNode) return;

    const newDomNode = domNode.cloneNode(true) as HTMLElement;

    // Apply visual compensation for horizontal scroll
    const applyScrollCompensation = (
      original: Element,
      cloned: HTMLElement,
    ) => {
      const scrollLeft = original.scrollLeft;

      if (scrollLeft > 0) {
        // Create a wrapper to handle the scroll offset
        const scrollWrapper = document.createElement("div");
        Object.assign(scrollWrapper.style, {
          overflow: "hidden",
          width: `${original.clientWidth}px`,
        });

        // Create inner container with the full content
        const innerContainer = document.createElement("div");
        Object.assign(innerContainer.style, {
          transform: `translateX(-${scrollLeft}px)`,
          width: `${original.scrollWidth}px`,
        });

        // Move all children to the inner container
        while (cloned.firstChild) {
          innerContainer.append(cloned.firstChild);
        }

        // Apply the original element's styles to maintain appearance
        const originalStyles = window.getComputedStyle(original);
        Object.assign(cloned.style, { padding: "0" });
        Object.assign(innerContainer.style, { padding: originalStyles.padding });

        scrollWrapper.append(innerContainer);
        cloned.append(scrollWrapper);
      }
    };

    applyScrollCompensation(domNode, newDomNode);

    ids.push(node.id as string);
    const wrapper = document.createElement("div");
    wrapper.append(newDomNode);
    const wrapperStyles: Record<string, string> = { display: "flow-root" };

    const lastDomNode = blocks[index - 1];

    if (lastDomNode) {
      const lastDomNodeRect = editor.api
        .toDOMNode(lastDomNode)
        ?.parentElement?.getBoundingClientRect();

      if (!lastDomNodeRect) return;

      const domNodeRect = domNode.parentElement?.getBoundingClientRect();

      if (!domNodeRect) return;

      const distance = domNodeRect.top - lastDomNodeRect.bottom;

      // Check if the two elements are adjacent (touching each other)
      if (distance > 15) {
        wrapperStyles.marginTop = `${distance}px`;
      }
    }

    Object.assign(wrapper.style, wrapperStyles);

    removeDataAttributes(newDomNode);
    elements.push(wrapper);
  };

  blocks.forEach((node, index) => {
    resolveElement(node, index);
  });

  editor.setOption(DndPlugin, "draggingId", ids);

  return elements;
};

const calculatePreviewTop = (
  editor: PlateEditor,
  {
    blocks,
    element,
  }: {
    blocks: TElement[];
    element: TElement;
  },
): number => {
  const child = editor.api.toDOMNode(element);
  const editable = editor.api.toDOMNode(editor);
  const firstSelectedChild = blocks[0];

  if (!firstSelectedChild || !child || !editable) return 0;

  const firstDomNode = editor.api.toDOMNode(firstSelectedChild);

  if (!firstDomNode) return 0;

  // Get editor's top padding
  const editorPaddingTop = Number(
    window.getComputedStyle(editable).paddingTop.replace("px", ""),
  );

  // Calculate distance from first selected node to editor top
  const firstNodeToEditorDistance =
    firstDomNode.getBoundingClientRect().top -
    editable.getBoundingClientRect().top -
    editorPaddingTop;

  // Get margin top of first selected node
  const firstMarginTopString = window.getComputedStyle(firstDomNode).marginTop;
  const marginTop = Number(firstMarginTopString.replace("px", ""));

  // Calculate distance from current node to editor top
  const currentToEditorDistance =
    child.getBoundingClientRect().top -
    editable.getBoundingClientRect().top -
    editorPaddingTop;

  const currentMarginTopString = window.getComputedStyle(child).marginTop;
  const currentMarginTop = Number(currentMarginTopString.replace("px", ""));

  const previewElementsTopDistance =
    currentToEditorDistance -
    firstNodeToEditorDistance +
    marginTop -
    currentMarginTop;

  return previewElementsTopDistance;
};

const calcDragButtonTop = (editor: PlateEditor, element: TElement): number => {
  const child = editor.api.toDOMNode(element);

  if (!child) return 0;

  const currentMarginTopString = window.getComputedStyle(child).marginTop;
  const currentMarginTop = Number(currentMarginTopString.replace("px", ""));

  return currentMarginTop;
};
