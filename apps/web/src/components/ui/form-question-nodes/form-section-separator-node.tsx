import { cn, withRef } from "@udecode/cn";
import { PlateElement, useReadOnly } from "platejs/react";
import type { ReactNode } from "react";
import { usePlateSectionContext } from "@/hooks/forms/use-plate-section-context";
import { SectionTransitionEditor } from "./editor-controls";

export const FormSectionSeparatorElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const readOnly = useReadOnly();

    // In viewer mode, separators are excluded from page nodes by
    // splitPlateContentIntoPages, so render nothing as a fallback.
    if (readOnly) {
      return (
        <PlateElement ref={ref} className={cn("hidden", className)} {...props}>
          {children}
        </PlateElement>
      );
    }

    return (
      <PlateElement ref={ref} className={cn("my-4", className)} {...props}>
        <SectionSeparatorCard>{children}</SectionSeparatorCard>
      </PlateElement>
    );
  },
);

/** Inner card rendered only in editor mode. */
function SectionSeparatorCard({ children }: { children: ReactNode }) {
  const sectionCtx = usePlateSectionContext();

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      {/* Transition settings for the PRECEDING section */}
      <div
        className="border-b border-dashed bg-muted/30 px-4 py-3"
        contentEditable={false}
      >
        <SectionTransitionEditor sectionCtx={sectionCtx} />
      </div>

      {/* Section header for the NEW section */}
      <div className="px-4 py-3">
        {/* Section counter badge */}
        <div className="mb-2" contentEditable={false}>
          <span className="inline-block rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {sectionCtx.totalSections} セクション中{" "}
            {sectionCtx.sectionIndex} 個目のセクション
          </span>
        </div>

        {/* Editable rich text children (title / description) */}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
