// Re-export from shared as the single source of truth
import {
  FORM_QUESTION_TYPES,
  isPlateQuestionType,
  type PlateQuestionType,
} from "@nexus-form/shared";

export { FORM_QUESTION_TYPES };

export type FormQuestionType = PlateQuestionType;

export function isFormQuestionType(type: string): type is FormQuestionType {
  return isPlateQuestionType(type);
}

// Base form question node interface (container element with editable children)
export interface FormQuestionNode {
  type: FormQuestionType;
  blockId: string;
  validation: Record<string, unknown>;
  children: Array<{
    type: string;
    children: Array<{ text: string; [key: string]: unknown }>;
  }>;
}
