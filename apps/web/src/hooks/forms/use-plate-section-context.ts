import { extractTextFromChildren } from "@nexus-form/shared";
import type { TElement } from "platejs";
import { useEditorRef, useElement } from "platejs/react";
import { useMemo } from "react";

export interface PlateSectionEntry {
  /** blockId of the section separator element */
  id: string;
  /** Section title extracted from the separator's text children */
  title: string;
  /** 1-based section index (the default first section is index 1) */
  index: number;
}

export interface PlateSectionContext {
  /** 1-based index of the section started by this separator */
  sectionIndex: number;
  /** Total number of sections (default first section + separator count) */
  totalSections: number;
  /** Title of the section that precedes this separator (the section whose
   *  transition behaviour this separator controls) */
  precedingSectionTitle: string;
  /** 1-based index of the preceding section */
  precedingSectionIndex: number;
  /** All sections available for "jump to" targets */
  sections: PlateSectionEntry[];
}

/**
 * Derive section metadata from the Plate editor tree.
 *
 * Must be called inside a Plate element component whose element is a
 * `form_section_separator`.  It walks the editor's top-level children to
 * count separators and compute:
 *   - this separator's 1-based section index
 *   - the total number of sections
 *   - the preceding section's title
 *   - a list of all sections for "jump to" targets
 */
export function usePlateSectionContext(): PlateSectionContext {
  const editor = useEditorRef();
  const element = useElement<TElement>();

  return useMemo(() => {
    const children = editor.children as TElement[];

    // Collect all section separators in document order
    const separators: Array<{ id: string; title: string }> = [];

    for (const child of children) {
      if (child.type === "form_section_separator") {
        const blockId =
          typeof child.blockId === "string"
            ? child.blockId
            : `page-${separators.length}`;
        const title = Array.isArray(child.children)
          ? extractTextFromChildren(child.children as unknown[])
          : "";
        separators.push({ id: blockId, title });
      }
    }

    // The total number of sections = 1 (default first section) + separators
    const totalSections = separators.length + 1;

    // No heading block type exists for the first section yet; use a generic
    // label so the "jump to" dropdown shows a consistent section name rather
    // than arbitrary question text from the first block.
    const firstSectionTitle = "セクション 1";

    // Build sections list: index 1 = default first section, 2..N = separator sections
    const sections: PlateSectionEntry[] = [
      { id: "default", title: firstSectionTitle, index: 1 },
      ...separators.map((sep, i) => ({
        id: sep.id,
        title: sep.title || `セクション ${i + 2}`,
        index: i + 2,
      })),
    ];

    // Find this separator's position among all separators
    const currentBlockId =
      typeof element.blockId === "string" ? element.blockId : "";
    const separatorIndex = separators.findIndex(
      (sep) => sep.id === currentBlockId,
    );
    // sectionIndex: 1-based index of the section this separator STARTS
    // separator[0] starts section 2, separator[1] starts section 3, etc.
    const sectionIndex = separatorIndex >= 0 ? separatorIndex + 2 : 2;

    // The preceding section is the one that ends at this separator
    const precedingSectionIndex = sectionIndex - 1;
    const precedingSection = sections.find(
      (s) => s.index === precedingSectionIndex,
    );
    const precedingSectionTitle =
      precedingSection?.title || `セクション ${precedingSectionIndex}`;

    return {
      sectionIndex,
      totalSections,
      precedingSectionTitle,
      precedingSectionIndex,
      sections,
    };
  }, [editor.children, element.blockId]);
}
