import { cn } from "@udecode/cn";
import {
  useTodoListElement,
  useTodoListElementState,
} from "@platejs/list/react";
import type { TElement } from "platejs";
import type { ReactNode } from "react";
import type {
  PlateElementProps,
  RenderNodeWrapperFunction,
  RenderNodeWrapperProps,
} from "platejs/react";

export const BlockList = (
  props: RenderNodeWrapperProps,
): RenderNodeWrapperFunction => {
  const element = props.element as TElement & Record<string, unknown>;
  const listStyleType = element.listStyleType as string | undefined;

  if (!listStyleType) return undefined;

  const isTodo = listStyleType === "todo";
  const isOrdered =
    listStyleType === "decimal" ||
    listStyleType === "lower-alpha" ||
    listStyleType === "lower-roman";

  return ({ children }: PlateElementProps) => {
    if (isTodo) {
      return (
        <TodoListItem element={element}>{children}</TodoListItem>
      );
    }

    return (
      <div
        className={cn(
          "relative my-0 flex items-start py-0.5 pl-6",
        )}
      >
        <span
          className="absolute left-0 top-0 flex h-[1.5em] w-6 select-none items-center justify-center"
          contentEditable={false}
        >
          <span className="text-muted-foreground">
            {isOrdered ? `${element.listStart ?? 1}.` : "\u2022"}
          </span>
        </span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    );
  };
};

function TodoListItem({
  children,
  element,
}: {
  children: ReactNode;
  element: TElement;
}) {
  const state = useTodoListElementState({ element });
  const { checkboxProps } = useTodoListElement(state);

  return (
    <div className="relative my-0 flex items-start py-0.5 pl-6">
      <span
        className="absolute left-0 top-0 flex h-[1.5em] w-6 select-none items-center justify-center"
        contentEditable={false}
      >
        <input
          type="checkbox"
          className="size-4 cursor-pointer rounded border border-primary"
          checked={checkboxProps.checked}
          onChange={(e) => checkboxProps.onCheckedChange(e.target.checked)}
          onMouseDown={checkboxProps.onMouseDown}
        />
      </span>
      <div
        className={cn(
          "min-w-0 flex-1",
          checkboxProps.checked && "line-through opacity-60",
        )}
      >
        {children}
      </div>
    </div>
  );
}
