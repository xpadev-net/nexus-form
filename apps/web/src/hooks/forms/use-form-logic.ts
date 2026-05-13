/**
 * フォームロジック評価フック
 * セクション/質問の条件付き表示、セクションジャンプ、送信判定を提供する
 */
import {
  type ConditionContext,
  evaluateRule,
  type FormLogicRule,
} from "@nexus-form/shared";
import { useCallback, useMemo } from "react";
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

export const useFormLogic = ({ sections, responses }: UseFormLogicProps) => {
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
          responses,
          questionId: section.id,
        };
        return evaluateRule(rule, context);
      });
    });
  }, [sections, responses]);

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
              responses,
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
    [sections, responses],
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
          responses,
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
    [sections, responses],
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
          responses,
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
    [sections, responses],
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
