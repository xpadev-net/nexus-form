import { useCallback, useMemo } from "react";
import type { Block } from "@/types/domain/form-block";

interface Section {
  id: string;
  title: string;
  description?: string;
  blocks: Block[];
  order: number;
}

export const useFormSections = (blocks: Block[]) => {
  const sections = useMemo(() => {
    const result: Section[] = [];
    let currentSection: Section = {
      id: "default",
      title: "",
      description: undefined,
      blocks: [],
      order: 0,
    };

    for (const block of blocks) {
      if (block.type === "section_separator") {
        if (currentSection.blocks.length > 0 || result.length === 0) {
          result.push(currentSection);
        }
        currentSection = {
          id: block.blockId,
          title: block.title ?? "",
          description: block.description,
          blocks: [],
          order: result.length,
        };
      } else {
        currentSection.blocks.push(block);
      }
    }

    if (currentSection.blocks.length > 0 || result.length === 0) {
      result.push(currentSection);
    }

    return result;
  }, [blocks]);

  const getSectionByBlockId = useCallback(
    (blockId: string): Section | undefined => {
      return sections.find((section) =>
        section.blocks.some((block) => block.blockId === blockId),
      );
    },
    [sections],
  );

  const getSectionIndex = useCallback(
    (sectionId: string): number => {
      return sections.findIndex((section) => section.id === sectionId);
    },
    [sections],
  );

  return {
    sections,
    totalSections: sections.length,
    getSectionByBlockId,
    getSectionIndex,
  };
};
