import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { FC, ReactNode } from "react";
import type { FormSection } from "@/types/validation/form";

interface SortableSectionItemProps {
  section: FormSection;
  children: ReactNode;
}

export const SortableSectionItem: FC<SortableSectionItemProps> = ({
  section,
  children,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "opacity-50" : ""}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
};

export default SortableSectionItem;
