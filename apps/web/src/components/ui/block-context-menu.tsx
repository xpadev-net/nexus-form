import {
  BLOCK_CONTEXT_MENU_ID,
  BlockMenuPlugin,
  BlockSelectionPlugin,
} from "@platejs/selection/react";
import { ClipboardListIcon } from "lucide-react";
import { KEYS } from "platejs";
import { useEditorPlugin, usePlateState, usePluginOption } from "platejs/react";
import { type ReactNode, useCallback } from "react";

import { setBlockType } from "@/components/editor/transforms";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { FORM_QUESTION_MENU_ITEMS } from "@/components/ui/form-question-menu-items";
import { turnIntoItems } from "@/components/ui/turn-into-toolbar-button";
import { useIsTouchDevice } from "@/hooks/use-is-touch-device";

const formQuestionItems = FORM_QUESTION_MENU_ITEMS;

export function BlockContextMenu({ children }: { children: ReactNode }) {
  const { api, editor } = useEditorPlugin(BlockMenuPlugin);
  const isTouch = useIsTouchDevice();
  const [readOnly] = usePlateState("readOnly");
  const openId = usePluginOption(BlockMenuPlugin, "openId");
  const isOpen = openId === BLOCK_CONTEXT_MENU_ID;

  const handleTurnInto = useCallback(
    (type: string) => {
      // codeBlock and 3-columns use editor-wide toggle transforms that must
      // run only once regardless of how many blocks are selected.
      if (type === KEYS.codeBlock || type === "action_three_columns") {
        setBlockType(editor, type);
        return;
      }

      editor
        .getApi(BlockSelectionPlugin)
        .blockSelection.getNodes()
        .forEach(([, path]) => {
          setBlockType(editor, type, { at: path });
        });
    },
    [editor],
  );

  const handleAlign = useCallback(
    (align: "center" | "left" | "right") => {
      editor
        .getTransforms(BlockSelectionPlugin)
        .blockSelection.setNodes({ align });
    },
    [editor],
  );

  if (isTouch) {
    return children;
  }

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) {
          api.blockMenu.hide();
        }
      }}
      modal={false}
    >
      <ContextMenuTrigger
        asChild
        onContextMenu={(event) => {
          const dataset = (event.target as HTMLElement).dataset;
          const disabled =
            dataset?.slateEditor === "true" ||
            readOnly ||
            dataset?.plateOpenContextMenu === "false";

          if (disabled) return event.preventDefault();

          window.setTimeout(() => {
            api.blockMenu.show(BLOCK_CONTEXT_MENU_ID, {
              x: event.clientX,
              y: event.clientY,
            });
          }, 0);
        }}
      >
        <div className="w-full">{children}</div>
      </ContextMenuTrigger>
      {isOpen && (
        <ContextMenuContent
          className="w-64"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            editor.getApi(BlockSelectionPlugin).blockSelection.focus();
          }}
        >
          <ContextMenuGroup>
            <ContextMenuItem
              onClick={() => {
                editor
                  .getTransforms(BlockSelectionPlugin)
                  .blockSelection.removeNodes();
                editor.tf.focus();
              }}
            >
              Delete
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                editor
                  .getTransforms(BlockSelectionPlugin)
                  .blockSelection.duplicate();
              }}
            >
              Duplicate
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Turn into</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-56">
                {turnIntoItems.map((item) => (
                  <ContextMenuItem
                    key={item.value}
                    onClick={() => handleTurnInto(item.value)}
                  >
                    <span className="mr-2 text-muted-foreground">
                      {item.icon}
                    </span>
                    {item.label}
                  </ContextMenuItem>
                ))}

                <ContextMenuSeparator />

                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <span className="mr-2 text-muted-foreground">
                      <ClipboardListIcon />
                    </span>
                    Form questions
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-52">
                    {formQuestionItems.map((item) => (
                      <ContextMenuItem
                        key={item.value}
                        onClick={() => handleTurnInto(item.value)}
                      >
                        <span className="mr-2 text-muted-foreground">
                          {item.icon}
                        </span>
                        {item.label}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuGroup>

          <ContextMenuGroup>
            <ContextMenuItem
              onClick={() =>
                editor
                  .getTransforms(BlockSelectionPlugin)
                  .blockSelection.setIndent(1)
              }
            >
              Indent
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() =>
                editor
                  .getTransforms(BlockSelectionPlugin)
                  .blockSelection.setIndent(-1)
              }
            >
              Outdent
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Align</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48">
                <ContextMenuItem onClick={() => handleAlign("left")}>
                  Left
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleAlign("center")}>
                  Center
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleAlign("right")}>
                  Right
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuGroup>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}
