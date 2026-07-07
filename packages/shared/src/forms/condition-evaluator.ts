/**
 * 条件評価エンジン
 * フォームロジック(セクション表示制御・ジャンプ等)の条件を評価する
 * API/Web 両方から利用可能な共有モジュール
 */

// ===== 型定義 (外部スキーマへの依存を回避) =====

export interface FormLogicCondition {
  question_id: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "not_contains"
    | "greater_than"
    | "greater_than_or_equal"
    | "less_than"
    | "less_than_or_equal"
    | "is_answered"
    | "is_not_answered"
    | "includes_any"
    | "includes_all"
    | "before"
    | "after";
  value?: string | number | boolean | string[] | number[];
}

export interface FormLogicAction {
  type: "jump_to_section" | "next" | "submit" | "show" | "hide";
  target_id?: string;
  metadata?: Record<string, unknown>;
}

export interface FormLogicRule {
  id: string;
  name: string;
  description?: string;
  conditions: FormLogicCondition[];
  condition_match: "all" | "any";
  action: FormLogicAction;
  stop_on_match?: boolean;
  enabled?: boolean;
  priority?: number;
}

export interface ConditionContext {
  responses: Record<string, unknown>;
  questionId: string;
}

// ===== 条件評価 =====

export function evaluateCondition(
  condition: FormLogicCondition,
  context: ConditionContext,
): boolean {
  const { question_id, operator, value } = condition;
  const responseValue = context.responses[question_id];

  switch (operator) {
    case "equals":
      return compareEquals(responseValue, value);
    case "not_equals":
      return !compareEquals(responseValue, value);
    case "contains":
      return compareContains(responseValue, value);
    case "not_contains":
      return !compareContains(responseValue, value);
    case "greater_than":
      return compareGreaterThan(responseValue, value);
    case "greater_than_or_equal":
      return compareGreaterThanOrEqual(responseValue, value);
    case "less_than":
      return compareLessThan(responseValue, value);
    case "less_than_or_equal":
      return compareLessThanOrEqual(responseValue, value);
    case "is_answered":
      return isAnswered(responseValue);
    case "is_not_answered":
      return !isAnswered(responseValue);
    case "includes_any":
      return includesAny(responseValue, value);
    case "includes_all":
      return includesAll(responseValue, value);
    case "before":
      return compareBefore(responseValue, value);
    case "after":
      return compareAfter(responseValue, value);
    default:
      return false;
  }
}

export function evaluateRule(
  rule: FormLogicRule,
  context: ConditionContext,
): boolean {
  if (rule.enabled === false) return false;

  const { conditions, condition_match } = rule;
  if (conditions.length === 0) return false;

  const results = conditions.map((condition) =>
    evaluateCondition(condition, context),
  );

  return condition_match === "all"
    ? results.every(Boolean)
    : results.some(Boolean);
}

export function detectCircularReference(
  rule: FormLogicRule,
  allRules: FormLogicRule[],
  visited: Set<string> = new Set(),
): boolean {
  if (visited.has(rule.id)) return true;
  visited.add(rule.id);

  if (rule.action?.type === "jump_to_section") {
    const targetRules = allRules.filter((r) =>
      r.conditions.some((c) => c.question_id === rule.action?.target_id),
    );
    for (const targetRule of targetRules) {
      if (detectCircularReference(targetRule, allRules, visited)) {
        return true;
      }
    }
  }

  return false;
}

// ===== 比較関数 =====

function compareEquals(
  responseValue: unknown,
  conditionValue: unknown,
): boolean {
  if (responseValue === null || responseValue === undefined) {
    return conditionValue === null || conditionValue === undefined;
  }
  if (Array.isArray(responseValue) && Array.isArray(conditionValue)) {
    return (
      responseValue.length === conditionValue.length &&
      responseValue.every((val, index) => val === conditionValue[index])
    );
  }
  if (Array.isArray(responseValue)) {
    return responseValue.includes(conditionValue);
  }
  return responseValue === conditionValue;
}

function compareContains(
  responseValue: unknown,
  conditionValue: unknown,
): boolean {
  if (typeof responseValue === "string" && typeof conditionValue === "string") {
    return responseValue.includes(conditionValue);
  }
  if (Array.isArray(responseValue) && typeof conditionValue === "string") {
    return responseValue.includes(conditionValue);
  }
  return false;
}

function compareGreaterThan(
  responseValue: unknown,
  conditionValue: unknown,
): boolean {
  const num1 = Number(responseValue);
  const num2 = Number(conditionValue);
  if (Number.isNaN(num1) || Number.isNaN(num2)) return false;
  return num1 > num2;
}

function compareGreaterThanOrEqual(
  responseValue: unknown,
  conditionValue: unknown,
): boolean {
  const num1 = Number(responseValue);
  const num2 = Number(conditionValue);
  if (Number.isNaN(num1) || Number.isNaN(num2)) return false;
  return num1 >= num2;
}

function compareLessThan(
  responseValue: unknown,
  conditionValue: unknown,
): boolean {
  const num1 = Number(responseValue);
  const num2 = Number(conditionValue);
  if (Number.isNaN(num1) || Number.isNaN(num2)) return false;
  return num1 < num2;
}

function compareLessThanOrEqual(
  responseValue: unknown,
  conditionValue: unknown,
): boolean {
  const num1 = Number(responseValue);
  const num2 = Number(conditionValue);
  if (Number.isNaN(num1) || Number.isNaN(num2)) return false;
  return num1 <= num2;
}

function isAnswered(responseValue: unknown): boolean {
  if (responseValue === null || responseValue === undefined) return false;
  if (typeof responseValue === "string") return responseValue.trim().length > 0;
  if (Array.isArray(responseValue)) return responseValue.length > 0;
  return true;
}

function includesAny(responseValue: unknown, conditionValue: unknown): boolean {
  if (!isAnswered(responseValue)) return false;

  const conditionValues = Array.isArray(conditionValue)
    ? conditionValue
    : [conditionValue];
  if (conditionValues.length === 0) return false;

  if (Array.isArray(responseValue)) {
    return conditionValues.some((val) => responseValue.includes(val));
  }

  return conditionValues.some((val) => responseValue === val);
}

function includesAll(responseValue: unknown, conditionValue: unknown): boolean {
  if (!isAnswered(responseValue)) return false;

  const conditionValues = Array.isArray(conditionValue)
    ? conditionValue
    : [conditionValue];
  if (conditionValues.length === 0) return false;

  if (Array.isArray(responseValue)) {
    return conditionValues.every((val) => responseValue.includes(val));
  }

  return conditionValues.every((val) => responseValue === val);
}

function compareBefore(
  responseValue: unknown,
  conditionValue: unknown,
): boolean {
  const date1 = new Date(responseValue as string);
  const date2 = new Date(conditionValue as string);
  if (Number.isNaN(date1.getTime()) || Number.isNaN(date2.getTime()))
    return false;
  return date1 < date2;
}

function compareAfter(
  responseValue: unknown,
  conditionValue: unknown,
): boolean {
  const date1 = new Date(responseValue as string);
  const date2 = new Date(conditionValue as string);
  if (Number.isNaN(date1.getTime()) || Number.isNaN(date2.getTime()))
    return false;
  return date1 > date2;
}
