import { cn, withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { Button } from "@/components/ui/button";
import { useFormResponseOptional } from "@/contexts/form-response-context";
import {
  EditorControlsWrapper,
  RatingSettingsEditor,
} from "./editor-controls";
import {
  FormQuestionElement,
  getQuestionAccessibleName,
  getQuestionLabelId,
  useFormQuestionErrorA11y,
} from "./form-question-base";

export const FormRatingElement = withRef<typeof PlateElement>(
  ({ children, ...props }, ref) => {
    const element = useElement<TElement>();
    const readOnly = useReadOnly();
    const viewerControls = readOnly ? (
      <RatingInput element={element} />
    ) : undefined;
    const editorControls = !readOnly ? (
      <EditorControlsWrapper>
        <RatingSettingsEditor />
      </EditorControlsWrapper>
    ) : undefined;
    return (
      <FormQuestionElement
        ref={ref}
        viewerControls={viewerControls}
        editorControls={editorControls}
        {...props}
      >
        {children}
      </FormQuestionElement>
    );
  },
);

export function RatingInput({ element }: { element: TElement }) {
  const ctx = useFormResponseOptional();
  const blockId = element.blockId as string;
  const errorA11y = useFormQuestionErrorA11y(blockId);
  if (!ctx) return null;
  const answer = ctx.getAnswer(blockId);
  const validation = element.validation as
    | { maxRating?: number; icon?: "star" | "heart" | "thumbs" }
    | undefined;
  const maxRating = validation?.maxRating ?? 5;
  const icon = validation?.icon ?? "star";
  const currentRating = (answer?.value as number) ?? 0;
  const questionName = getQuestionAccessibleName(element);

  const iconChar = icon === "heart" ? "\u2665" : icon === "thumbs" ? "\uD83D\uDC4D" : "\u2605";

  return (
    <div
      className="flex justify-center gap-1"
      role="group"
      aria-labelledby={getQuestionLabelId(blockId)}
      {...errorA11y}
    >
      {Array.from({ length: maxRating }, (_, i) => {
        const value = i + 1;
        const isFilled = value <= currentRating;
        return (
          <Button
            key={value}
            type="button"
            variant="ghost"
            aria-label={`${questionName}: ${value}`}
            aria-pressed={currentRating === value}
            onClick={() => ctx.setAnswer(blockId, { value })}
            className={cn(
              "text-2xl h-auto w-auto p-1 transition-colors",
              isFilled ? "text-yellow-400" : "text-muted-foreground/50",
              "hover:text-yellow-400 hover:bg-transparent dark:hover:bg-transparent",
            )}
          >
            {iconChar}
          </Button>
        );
      })}
    </div>
  );
}
