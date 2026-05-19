/**
 * フォームロジック評価フック
 * セクション/質問の条件付き表示、セクションジャンプ、送信判定を提供する
 */
import {
  type ConditionContext,
  evaluateRule,
  type FormLogicRule,
} from "@nexus-form/shared";
import { useCallback, useMemo, useRef } from "react";
import type { Block } from "@/types/domain/form-block";

interface Section {
  id: string;
  title: string;
  description?: string;
  blocks: Block[];
  order: number;
  logic?: FormLogicRule[];
}

interface UseFormLogicProps {
  sections: Section[];
  responses: Record<string, unknown>;
}

const getLogicResponseKeys = (sections: Section[]): string[] => {
  const keys = new Set<string>();

  for (const section of sections) {
    for (const rule of section.logic ?? []) {
      for (const condition of rule.conditions) {
        keys.add(condition.question_id);
      }
    }
  }

  return [...keys];
};

const serializeResponseDependency = (key: string, value: unknown): string => {
  try {
    return JSON.stringify([key, value]);
  } catch {
    return JSON.stringify([key, String(value)]);
  }
};

const getResponseDependencySignature = (
  responses: Record<string, unknown>,
  responseKeys: string[],
): string => {
  return responseKeys
    .map((key) => serializeResponseDependency(key, responses[key]))
    .join("\u001f");
};

const pickLogicResponses = (
  responses: Record<string, unknown>,
  responseKeys: string[],
): Record<string, unknown> => {
  const scopedResponses: Record<string, unknown> = {};

  for (const key of responseKeys) {
    if (key in responses) {
      scopedResponses[key] = responses[key];
    }
  }

  return scopedResponses;
};

export const useFormLogic = ({ sections, responses }: UseFormLogicProps) => {
  const logicResponsesRef = useRef<{
    signature: string;
    responses: Record<string, unknown>;
  } | null>(null);
  const logicResponseKeys = useMemo(
    () => getLogicResponseKeys(sections),
    [sections],
  );
  const logicResponseSignature = getResponseDependencySignature(
    responses,
    logicResponseKeys,
  );

  if (logicResponsesRef.current?.signature !== logicResponseSignature) {
    logicResponsesRef.current = {
      signature: logicResponseSignature,
      responses: pickLogicResponses(responses, logicResponseKeys),
    };
  }

  const logicResponses = logicResponsesRef.current.responses;

  /**
   * セクションの表示/非表示を判定する
   */
  const getVisibleSections = useCallback((): Section[] => {
    return sections.filter((section) => {
      if (!section.logic || section.logic.length === 0) {
        return true;
      }
      return section.logic.some((rule) => {
        const context: ConditionContext = {
          responses: logicResponses,
          questionId: section.id,
        };
        return evaluateRule(rule, context);
      });
    });
  }, [sections, logicResponses]);

  /**
   * 指定セクション内の表示可能な質問を返す
   */
  const getVisibleQuestions = useCallback(
    (sectionId?: string): Block[] => {
      const targetSections = sectionId
        ? sections.filter((s) => s.id === sectionId)
        : sections;

      const blocks: Block[] = [];
      for (const section of targetSections) {
        if (section.logic && section.logic.length > 0) {
          const visible = section.logic.some((rule) => {
            const context: ConditionContext = {
              responses: logicResponses,
              questionId: section.id,
            };
            return evaluateRule(rule, context);
          });
          if (!visible) continue;
        }
        blocks.push(...section.blocks);
      }
      return blocks;
    },
    [sections, logicResponses],
  );

  /**
   * 必須質問のみを返す
   */
  const getRequiredQuestions = useCallback(
    (sectionId?: string): Block[] => {
      const visible = getVisibleQuestions(sectionId);
      return visible.filter(
        (block) =>
          "validation" in block &&
          typeof block.validation === "object" &&
          block.validation !== null &&
          "required" in block.validation &&
          block.validation.required === true,
      );
    },
    [getVisibleQuestions],
  );

  /**
   * 現在のセクションからジャンプすべきセクションIDを返す
   */
  const shouldJumpToSection = useCallback(
    (currentSectionId: string): string | null => {
      const currentSection = sections.find((s) => s.id === currentSectionId);
      if (!currentSection?.logic) return null;

      for (const rule of currentSection.logic) {
        const context: ConditionContext = {
          responses: logicResponses,
          questionId: currentSectionId,
        };
        if (evaluateRule(rule, context)) {
          if (
            rule.action?.type === "jump_to_section" &&
            rule.action.target_id
          ) {
            return rule.action.target_id;
          }
        }
      }
      return null;
    },
    [sections, logicResponses],
  );

  /**
   * フォームを送信すべきかどうかを判定する
   */
  const shouldEndForm = useCallback(
    (currentSectionId: string): boolean => {
      const currentSection = sections.find((s) => s.id === currentSectionId);
      if (!currentSection?.logic) return false;

      for (const rule of currentSection.logic) {
        const context: ConditionContext = {
          responses: logicResponses,
          questionId: currentSectionId,
        };
        if (evaluateRule(rule, context)) {
          if (rule.action?.type === "submit") {
            return true;
          }
        }
      }
      return false;
    },
    [sections, logicResponses],
  );

  const visibleSections = useMemo(
    () => getVisibleSections(),
    [getVisibleSections],
  );
  const visibleQuestions = useMemo(
    () => getVisibleQuestions(),
    [getVisibleQuestions],
  );
  const requiredQuestions = useMemo(
    () => getRequiredQuestions(),
    [getRequiredQuestions],
  );

  return {
    visibleSections,
    visibleQuestions,
    requiredQuestions,
    getVisibleQuestions,
    getRequiredQuestions,
    shouldJumpToSection,
    shouldEndForm,
  };
};
