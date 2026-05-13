"use client";

import { useCallback, useState } from "react";
import type { Block } from "@/types/domain/form-block";
import type { ResponseData } from "@/types/domain/response";
import type { ValidationError } from "@/types/domain/validation";
import { validateQuestion } from "@/utils/validation/question-validators";

interface UsePublicFormValidationReturn {
  validateAll: (responses: Record<string, ResponseData>) => boolean;
  validateField: (blockId: string, response: ResponseData) => void;
  errors: Record<string, ValidationError[]>;
  clearErrors: () => void;
  hasErrors: boolean;
}

export const usePublicFormValidation = (
  blocks: Block[],
): UsePublicFormValidationReturn => {
  const [errors, setErrors] = useState<Record<string, ValidationError[]>>({});

  const validateAll = useCallback(
    (responses: Record<string, ResponseData>): boolean => {
      const newErrors: Record<string, ValidationError[]> = {};

      for (const block of blocks) {
        if (block.category !== "question") continue;

        const response = responses[block.blockId];
        if (!response && !block.validation.required) continue;

        if (!response && block.validation.required) {
          newErrors[block.blockId] = [
            {
              field: block.blockId,
              message: "この項目は必須です",
              code: "REQUIRED",
            },
          ];
          continue;
        }

        if (response) {
          const result = validateQuestion(block, response);
          if (!result.is_valid && result.errors.length > 0) {
            newErrors[block.blockId] = result.errors;
          }
        }
      }

      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    },
    [blocks],
  );

  const validateField = useCallback(
    (blockId: string, response: ResponseData): void => {
      const block = blocks.find((b) => b.blockId === blockId);
      if (!block) return;

      const result = validateQuestion(block, response);
      setErrors((prev) => {
        const next = { ...prev };
        if (!result.is_valid && result.errors.length > 0) {
          next[blockId] = result.errors;
        } else {
          delete next[blockId];
        }
        return next;
      });
    },
    [blocks],
  );

  const clearErrors = useCallback(() => {
    setErrors({});
  }, []);

  const hasErrors = Object.keys(errors).length > 0;

  return { validateAll, validateField, errors, clearErrors, hasErrors };
};
