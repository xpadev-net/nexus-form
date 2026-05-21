import { Plus, Trash2 } from "lucide-react";
import { type FC, useMemo } from "react";
import { Button } from "@/components/ui/button";
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

/** Minimal block shape required by the condition builder (blockId + title). */
interface BlockRef {
  blockId: string;
  title?: string;
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

function getConditionKeySignature(condition: FormLogicCondition): string {
  return JSON.stringify({
    questionId: condition.question_id,
    operator: condition.operator,
  });
}

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
    const updated = [...conditions];
    updated[index] = { ...current, ...updates };
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
          <div className="flex-1 grid grid-cols-3 gap-2">
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

            {condition.operator !== "is_answered" &&
              condition.operator !== "is_not_answered" && (
                <Input
                  value={
                    typeof condition.value === "string"
                      ? condition.value
                      : String(condition.value ?? "")
                  }
                  onChange={(e) =>
                    handleUpdateCondition(index, { value: e.target.value })
                  }
                  placeholder="値"
                  className="h-8 text-xs"
                  disabled={disabled}
                />
              )}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
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
