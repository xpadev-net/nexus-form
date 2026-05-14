import { withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement, useReadOnly } from "platejs/react";
import { useFormResponseOptional } from "@/contexts/form-response-context";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AllowOtherEditor,
  ChoiceOptionsEditor,
  EditorControlsWrapper,
} from "./editor-controls";
import { FormQuestionElement } from "./form-question-base";

interface OptionLike {
  id: string;
  label: string;
}

export const FormDropdownElement = withRef<typeof PlateElement>(
  ({ children, ...props }, ref) => {
    const element = useElement<TElement>();
    const readOnly = useReadOnly();
    const viewerControls = readOnly ? (
      <DropdownInput element={element} />
    ) : undefined;
    const editorControls = !readOnly ? (
      <EditorControlsWrapper>
        <ChoiceOptionsEditor />
        <AllowOtherEditor />
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

function DropdownInput({ element }: { element: TElement }) {
  const ctx = useFormResponseOptional();
  if (!ctx) return null;
  const blockId = element.blockId as string;
  const answer = ctx.getAnswer(blockId);
  const validation = element.validation as
    | { options?: OptionLike[]; allowOther?: boolean; otherLabel?: string }
    | undefined;
  const options = validation?.options ?? [];
  const allowOther = validation?.allowOther ?? false;
  const otherLabel = validation?.otherLabel || "その他";
  const selectedValue = (answer?.value as string) ?? "";
  const isOtherSelected = selectedValue === "other";

  if (options.length === 0 && !allowOther) {
    return (
      <p className="text-sm text-muted-foreground">選択肢がありません</p>
    );
  }

  return (
    <div className="space-y-2">
      <Select
        value={selectedValue}
        onValueChange={(value) =>
          ctx.setAnswer(blockId, {
            value,
            other_value: value === "other" ? (answer?.other_value as string) : undefined,
          })
        }
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="選択してください" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label || "（空の選択肢）"}
            </SelectItem>
          ))}
          {allowOther && (
            <SelectItem value="other">{otherLabel}</SelectItem>
          )}
        </SelectContent>
      </Select>
      {allowOther && isOtherSelected && (
        <Input
          value={(answer?.other_value as string) ?? ""}
          onChange={(e) =>
            ctx.setAnswer(blockId, {
              value: "other",
              other_value: e.target.value,
            })
          }
          placeholder={`${otherLabel}を入力`}
        />
      )}
    </div>
  );
}
