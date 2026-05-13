import { DndPlugin } from "@platejs/dnd";
import type { FC, ReactNode } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import { BlockDraggable } from "@/components/ui/block-draggable";

const DndAboveSlate: FC<{ children: ReactNode }> = ({ children }) => (
  <DndProvider backend={HTML5Backend}>{children}</DndProvider>
);

export const DndKit = [
  DndPlugin.configure({
    options: {
      enableScroller: true,
    },
    render: {
      aboveNodes: BlockDraggable,
      aboveSlate: DndAboveSlate,
    },
  }),
];
