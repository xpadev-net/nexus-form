/**
 * 条件評価エンジン (API re-export)
 * 実装は @nexus-form/shared に統合
 */
export {
  type ConditionContext,
  detectCircularReference,
  evaluateCondition,
  evaluateRule,
  type FormLogicAction,
  type FormLogicCondition,
  type FormLogicRule,
} from "@nexus-form/shared";
