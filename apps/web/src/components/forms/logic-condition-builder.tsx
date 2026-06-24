import { Plus, Trash2 } from "lucide-react";
import { type FC, useId, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormLogicCondition } from "@/types/validation/form";

interface BlockValueOption {
  value: string | number;
  label: string;
}

/** Minimal block shape required by the condition builder. */
interface BlockRef {
  blockId: string;
  title?: string;
  valueOptions?: BlockValueOption[];
}

interface LogicConditionBuilderProps {
  conditions: FormLogicCondition[];
  availableBlocks: BlockRef[];
  onChange: (conditions: FormLogicCondition[]) => void;
  conditionMatch: "all" | "any";
  onConditionMatchChange: (conditionMatch: "all" | "any") => void;
  disabled?: boolean;
}

const OPERATOR_LABELS: Record<FormLogicCondition["operator"], string> = {
  equals: "等しい",
  not_equals: "等しくない",
  contains: "含む",
  not_contains: "含まない",
  greater_than: "より大きい",
  greater_than_or_equal: "以上",
  less_than: "より小さい",
  less_than_or_equal: "以下",
  is_answered: "回答済み",
  is_not_answered: "未回答",
  includes_any: "いずれかを含む",
  includes_all: "すべてを含む",
  before: "より前",
  after: "より後",
};

const VALUELESS_OPERATORS = new Set<FormLogicCondition["operator"]>([
  "is_answered",
  "is_not_answered",
]);

const MULTI_VALUE_OPERATORS = new Set<FormLogicCondition["operator"]>([
  "includes_any",
  "includes_all",
]);

function getConditionKeySignature(condition: FormLogicCondition): string {
  return JSON.stringify({
    questionId: condition.question_id,
    operator: condition.operator,
  });
}

function hasValueOptions(block: BlockRef | undefined): block is BlockRef & {
  valueOptions: BlockValueOption[];
} {
  return Array.isArray(block?.valueOptions) && block.valueOptions.length > 0;
}

function valuesEqual(a: string | number, b: string | number): boolean {
  return a === b;
}

function isStringOrNumber(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function isNumberValue(value: string | number): value is number {
  return typeof value === "number";
}

function isStringValue(value: string | number): value is string {
  return typeof value === "string";
}

function toConditionValueArray(
  values: Array<string | number>,
  options: BlockValueOption[],
): string[] | number[] {
  if (typeof options[0]?.value === "number") {
    return values.filter(isNumberValue);
  }
  return values.filter(isStringValue);
}

function addConditionValue(
  values: string[] | number[],
  optionValue: string | number,
): string[] | number[] {
  if (typeof optionValue === "number") {
    const numberValues = values.filter(isNumberValue);
    return numberValues.includes(optionValue)
      ? numberValues
      : [...numberValues, optionValue];
  }
  const stringValues = values.filter(isStringValue);
  return stringValues.includes(optionValue)
    ? stringValues
    : [...stringValues, optionValue];
}

function removeConditionValue(
  values: string[] | number[],
  optionValue: string | number,
): string[] | number[] {
  if (typeof optionValue === "number") {
    return values.filter(
      (value): value is number =>
        isNumberValue(value) && !valuesEqual(value, optionValue),
    );
  }
  return values.filter(
    (value): value is string =>
      isStringValue(value) && !valuesEqual(value, optionValue),
  );
}

function findOptionValue(
  options: BlockValueOption[],
  valueKey: string,
): string | number {
  return (
    options.find((option) => String(option.value) === valueKey)?.value ?? ""
  );
}

function getDefaultConditionValue(
  block: BlockRef | undefined,
  operator: FormLogicCondition["operator"],
): FormLogicCondition["value"] | undefined {
  if (VALUELESS_OPERATORS.has(operator)) return undefined;

  if (!hasValueOptions(block)) {
    return MULTI_VALUE_OPERATORS.has(operator) ? [] : "";
  }

  if (MULTI_VALUE_OPERATORS.has(operator)) return [];
  return block.valueOptions[0]?.value ?? "";
}

function normalizeConditionValue(
  block: BlockRef | undefined,
  operator: FormLogicCondition["operator"],
  value: FormLogicCondition["value"],
): FormLogicCondition["value"] | undefined {
  if (VALUELESS_OPERATORS.has(operator)) return undefined;

  if (!hasValueOptions(block)) {
    if (MULTI_VALUE_OPERATORS.has(operator)) {
      return Array.isArray(value) ? value : [];
    }
    return Array.isArray(value) ? String(value[0] ?? "") : (value ?? "");
  }

  if (MULTI_VALUE_OPERATORS.has(operator)) {
    const values = Array.isArray(value) ? value : value == null ? [] : [value];
    const validValues = values.filter(
      (candidate): candidate is string | number => {
        if (!isStringOrNumber(candidate)) return false;
        return block.valueOptions.some((option) =>
          valuesEqual(option.value, candidate),
        );
      },
    );
    return toConditionValueArray(validValues, block.valueOptions);
  }

  const candidate = Array.isArray(value) ? value[0] : value;
  if (
    (typeof candidate === "string" || typeof candidate === "number") &&
    block.valueOptions.some((option) => valuesEqual(option.value, candidate))
  ) {
    return candidate;
  }

  return getDefaultConditionValue(block, operator);
}

interface ConditionValueEditorProps {
  condition: FormLogicCondition;
  block?: BlockRef;
  onChange: (value: FormLogicCondition["value"]) => void;
  disabled: boolean;
}

const ConditionValueEditor: FC<ConditionValueEditorProps> = ({
  condition,
  block,
  onChange,
  disabled,
}) => {
  const valueEditorId = useId();

  if (VALUELESS_OPERATORS.has(condition.operator)) return null;

  if (!hasValueOptions(block)) {
    return (
      <Input
        value={
          typeof condition.value === "string" ||
          typeof condition.value === "number"
            ? String(condition.value)
            : ""
        }
        onChange={(e) => onChange(e.target.value)}
        placeholder="値"
        className="h-8 text-xs"
        disabled={disabled}
      />
    );
  }

  if (MULTI_VALUE_OPERATORS.has(condition.operator)) {
    const selectedValues = toConditionValueArray(
      (Array.isArray(condition.value)
        ? condition.value
        : condition.value == null
          ? []
          : [condition.value]
      ).filter(isStringOrNumber),
      block.valueOptions,
    );

    return (
      <div className="min-h-8 rounded-md border px-2 py-1.5">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {block.valueOptions.map((option) => {
            const optionId = `${valueEditorId}-${String(option.value)}`;
            const checked = selectedValues.some((value) =>
              valuesEqual(value, option.value),
            );
            return (
              <label
                key={String(option.value)}
                htmlFor={optionId}
                className="flex min-w-0 items-center gap-1.5 text-xs"
              >
                <Checkbox
                  id={optionId}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(nextChecked) => {
                    if (nextChecked === true) {
                      onChange(addConditionValue(selectedValues, option.value));
                      return;
                    }
                    onChange(
                      removeConditionValue(selectedValues, option.value),
                    );
                  }}
                />
                <span className="truncate">{option.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <Select
      value={
        typeof condition.value === "string" ||
        typeof condition.value === "number"
          ? String(condition.value)
          : ""
      }
      onValueChange={(valueKey) =>
        onChange(findOptionValue(block.valueOptions, valueKey))
      }
      disabled={disabled}
    >
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="値を選択" />
      </SelectTrigger>
      <SelectContent>
        {block.valueOptions.map((option) => (
          <SelectItem key={String(option.value)} value={String(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export const LogicConditionBuilder: FC<LogicConditionBuilderProps> = ({
  conditions,
  availableBlocks,
  onChange,
  conditionMatch,
  onConditionMatchChange,
  disabled = false,
}) => {
  const handleAddCondition = () => {
    onChange([
      ...conditions,
      { question_id: "", operator: "equals", value: "" },
    ]);
  };

  const handleUpdateCondition = (
    index: number,
    updates: Partial<FormLogicCondition>,
  ) => {
    const current = conditions[index];
    if (!current) return;
    const nextQuestionId = updates.question_id ?? current.question_id;
    const nextOperator = updates.operator ?? current.operator;
    const selectedBlock = availableBlocks.find(
      (block) => block.blockId === nextQuestionId,
    );
    const shouldNormalizeValue =
      updates.question_id !== undefined || updates.operator !== undefined;
    const nextValue = shouldNormalizeValue
      ? normalizeConditionValue(
          selectedBlock,
          nextOperator,
          updates.value ?? current.value,
        )
      : updates.value;
    const updated = [...conditions];
    updated[index] = {
      ...current,
      ...updates,
      ...(shouldNormalizeValue || updates.value !== undefined
        ? { value: nextValue }
        : {}),
    };
    onChange(updated);
  };

  const handleDeleteCondition = (index: number) => {
    onChange(conditions.filter((_, i) => i !== index));
  };

  const keyedConditions = useMemo(() => {
    const signatureCounts = new Map<string, number>();

    return conditions.map((condition) => {
      const signature = getConditionKeySignature(condition);
      const occurrence = signatureCounts.get(signature) ?? 0;
      signatureCounts.set(signature, occurrence + 1);

      return {
        condition,
        key: `${signature}:${occurrence}`,
      };
    });
  }, [conditions]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm">条件</Label>
        {conditions.length > 1 && (
          <Select
            value={conditionMatch}
            onValueChange={(v) => onConditionMatchChange(v as "all" | "any")}
            disabled={disabled}
          >
            <SelectTrigger className="w-[160px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">すべて一致（AND）</SelectItem>
              <SelectItem value="any">いずれか一致（OR）</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {keyedConditions.map(({ condition, key }, index) => (
        <div key={key} className="flex items-start gap-2">
          <div className="grid flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(10rem,1.2fr)] gap-2">
            <Select
              value={condition.question_id}
              onValueChange={(v) =>
                handleUpdateCondition(index, { question_id: v })
              }
              disabled={disabled}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="質問を選択" />
              </SelectTrigger>
              <SelectContent>
                {availableBlocks.map((block) => (
                  <SelectItem key={block.blockId} value={block.blockId}>
                    {block.title || block.blockId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={condition.operator}
              onValueChange={(v) =>
                handleUpdateCondition(index, {
                  operator: v as FormLogicCondition["operator"],
                })
              }
              disabled={disabled}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(OPERATOR_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <ConditionValueEditor
              condition={condition}
              block={availableBlocks.find(
                (block) => block.blockId === condition.question_id,
              )}
              onChange={(value) => handleUpdateCondition(index, { value })}
              disabled={disabled}
            />
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="条件を削除"
            onClick={() => handleDeleteCondition(index)}
            disabled={disabled || conditions.length <= 1}
            className="h-8 w-8 p-0"
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAddCondition}
        disabled={disabled}
        className="text-xs"
      >
        <Plus className="h-3 w-3 mr-1" />
        条件追加
      </Button>
    </div>
  );
};
