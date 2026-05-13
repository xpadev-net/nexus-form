import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createContext, type FC, type ReactNode } from "react";

// DragHandle用のContext型定義
interface DragHandleValue {
  attributes: DraggableAttributes;
  listeners: SyntheticListenerMap | undefined;
  setActivatorNodeRef: (node: HTMLElement | null) => void;
}

// Context定義
export const DragHandleContext = createContext<DragHandleValue | null>(null);

interface SortableOptionItemProps {
  id: string;
  children: ReactNode;
}

export const SortableOptionItem: FC<SortableOptionItemProps> = ({
  id,
  children,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "opacity-50" : ""}
    >
      <DragHandleContext.Provider
        value={{
          attributes,
          listeners: listeners || {},
          setActivatorNodeRef,
        }}
      >
        {children}
      </DragHandleContext.Provider>
    </div>
  );
};

export default SortableOptionItem;
