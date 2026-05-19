import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import type { BlockByType, BlockType } from "@/types/domain/form-block";
import { ChoiceValidationRenderer } from "./block-validation-editor/choice-validation-renderer";
import { DateValidationRenderer } from "./block-validation-editor/date-time-validation-renderer";
import { GridValidationRenderer } from "./block-validation-editor/grid-validation-renderer";
import { ScaleValidationRenderer } from "./block-validation-editor/scale-validation-renderer";
import { TextValidationRenderer } from "./block-validation-editor/text-validation-renderer";
import type { BlockValidationEditorInternalProps } from "./block-validation-editor/types";

const BlockValidationEditorInner = <T extends BlockType>({
  question,
  onValidationChange,
  disabled = false,
  idPrefix,
}: BlockValidationEditorInternalProps<T>) => {
  const getValidationTitle = (): string => {
    const titles: Record<BlockType, string> = {
      short_text: "テキスト入力のバリデーション",
      long_text: "テキスト入力のバリデーション",
      radio: "選択肢のバリデーション",
      checkbox: "選択肢のバリデーション",
      dropdown: "選択肢のバリデーション",
      linear_scale: "スケールのバリデーション",
      rating: "評価のバリデーション",
      choice_grid: "グリッドのバリデーション",
      checkbox_grid: "グリッドのバリデーション",
      date: "日付のバリデーション",
      time: "時刻のバリデーション",
      section_separator: "セクションヘッダーの設定",
    };
    return titles[question.type] || "バリデーション設定";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3>{getValidationTitle()}</h3>
        <Badge variant="outline">設定可能</Badge>
      </div>

      {(question.type === "short_text" || question.type === "long_text") && (
        <TextValidationRenderer
          question={question}
          onValidationChange={onValidationChange}
          disabled={disabled}
          idPrefix={idPrefix}
        />
      )}

      {(question.type === "radio" ||
        question.type === "checkbox" ||
        question.type === "dropdown") && (
        <ChoiceValidationRenderer
          question={question}
          onValidationChange={onValidationChange}
          disabled={disabled}
          idPrefix={idPrefix}
        />
      )}

      {(question.type === "linear_scale" || question.type === "rating") && (
        <ScaleValidationRenderer
          question={question}
          onValidationChange={onValidationChange}
          disabled={disabled}
          idPrefix={idPrefix}
        />
      )}

      {(question.type === "choice_grid" ||
        question.type === "checkbox_grid") && (
        <GridValidationRenderer
          question={question}
          onValidationChange={onValidationChange}
          disabled={disabled}
          idPrefix={idPrefix}
        />
      )}

      {(question.type === "date" || question.type === "time") && (
        <DateValidationRenderer
          question={question}
          onValidationChange={onValidationChange}
          disabled={disabled}
          idPrefix={idPrefix}
        />
      )}
    </div>
  );
};

interface BlockValidationEditorProps<T extends BlockType> {
  block: BlockByType<T>;
  onValidationChange: (validation: BlockByType<T>["validation"]) => void;
  disabled?: boolean;
}

export const BlockValidationEditor = <T extends BlockType>({
  block,
  onValidationChange,
  disabled = false,
}: BlockValidationEditorProps<T>) => {
  const idPrefix = useId();

  return (
    <BlockValidationEditorInner<T>
      question={block}
      onValidationChange={onValidationChange}
      disabled={disabled}
      idPrefix={idPrefix}
    />
  );
};

export default BlockValidationEditor;
