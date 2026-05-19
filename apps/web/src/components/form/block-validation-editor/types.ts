import type { BlockByType, BlockType } from "@/types/domain/form-block";

export interface BlockValidationEditorInternalProps<T extends BlockType> {
  question: BlockByType<T>;
  onValidationChange: (validation: BlockByType<T>["validation"]) => void;
  disabled?: boolean;
  idPrefix: string;
}
