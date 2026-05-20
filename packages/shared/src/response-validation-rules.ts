export type TextLengthViolationCode = "MIN_LENGTH" | "MAX_LENGTH";

export interface TextLengthViolation {
  code: TextLengthViolationCode;
  limit: number;
  length: number;
}

export interface TextLengthRules {
  minLength?: number | null;
  maxLength?: number | null;
}

export function isBlankResponseValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
}

export function getTextLengthViolations(
  value: string,
  rules: TextLengthRules,
): TextLengthViolation[] {
  const violations: TextLengthViolation[] = [];
  const length = value.length;

  if (rules.minLength != null && length < rules.minLength) {
    violations.push({ code: "MIN_LENGTH", limit: rules.minLength, length });
  }

  if (rules.maxLength != null && length > rules.maxLength) {
    violations.push({ code: "MAX_LENGTH", limit: rules.maxLength, length });
  }

  return violations;
}

export function textMatchesPattern(value: string, pattern: string): boolean {
  return new RegExp(pattern).test(value);
}

export function parseFiniteResponseNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  return Number.isFinite(parsed) ? parsed : null;
}
