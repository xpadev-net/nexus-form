import { type FC, useId } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormLogicAction } from "@/types/validation/form";

/** Minimal block shape required by the action builder (blockId + title). */
interface BlockRef {
  blockId: string;
  title?: string;
}

export interface SectionTargetOption {
  id: string;
  title: string;
  isCompletionTarget: boolean;
}

interface LogicActionBuilderProps {
  action: FormLogicAction;
  availableBlocks: BlockRef[];
  availableSections: Array<{ id: string; title: string }>;
  completionTargetSections?: SectionTargetOption[];
  onChange: (action: FormLogicAction) => void;
  disabled?: boolean;
}

const ACTION_TYPE_LABELS: Record<FormLogicAction["type"], string> = {
  jump_to_section: "セクションへ移動",
  next: "次へ進む",
  submit: "送信する",
};

export const LogicActionBuilder: FC<LogicActionBuilderProps> = ({
  action,
  availableSections,
  completionTargetSections = [],
  onChange,
  disabled = false,
}) => {
  const completionTargetMessageId = useId();
  const completionTargetErrorId = useId();
  const selectedCompletionTarget = completionTargetSections.find(
    (section) => section.id === action.target_id,
  );
  const hasCompletionTargetChoice = completionTargetSections.some(
    (section) => section.isCompletionTarget,
  );
  const hasMissingCompletionTarget =
    action.type === "submit" &&
    typeof action.target_id === "string" &&
    action.target_id.length > 0 &&
    !selectedCompletionTarget;
  const hasInvalidCompletionTarget =
    action.type === "submit" &&
    selectedCompletionTarget != null &&
    !selectedCompletionTarget.isCompletionTarget;
  const hasCompletionTargetError =
    hasInvalidCompletionTarget || hasMissingCompletionTarget;
  const completionTargetDescription = [
    action.type === "submit" && !hasCompletionTargetChoice
      ? completionTargetMessageId
      : undefined,
    hasCompletionTargetError ? completionTargetErrorId : undefined,
  ]
    .filter((id): id is string => typeof id === "string")
    .join(" ");

  const handleTypeChange = (type: FormLogicAction["type"]) => {
    if (type === "jump_to_section") {
      onChange({ type, target_id: availableSections[0]?.id });
    } else if (type === "submit") {
      const firstTarget = completionTargetSections.find(
        (section) => section.isCompletionTarget,
      );
      onChange(firstTarget ? { type, target_id: firstTarget.id } : { type });
    } else {
      onChange({ type });
    }
  };

  const handleTargetChange = (targetId: string) => {
    onChange({ ...action, target_id: targetId });
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm">アクション</Label>
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={action.type}
          onValueChange={(v) => handleTypeChange(v as FormLogicAction["type"])}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ACTION_TYPE_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {action.type === "jump_to_section" && (
          <Select
            value={action.target_id || ""}
            onValueChange={handleTargetChange}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="セクションを選択" />
            </SelectTrigger>
            <SelectContent>
              {availableSections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {action.type === "submit" && (
          <Select
            value={action.target_id || ""}
            onValueChange={handleTargetChange}
            disabled={
              disabled || (!hasCompletionTargetChoice && !action.target_id)
            }
          >
            <SelectTrigger
              aria-describedby={completionTargetDescription || undefined}
              aria-invalid={hasCompletionTargetError || undefined}
              className="h-8 text-xs"
            >
              <SelectValue placeholder="完了セクションを選択" />
            </SelectTrigger>
            <SelectContent>
              {hasMissingCompletionTarget && action.target_id ? (
                <SelectItem value={action.target_id}>
                  不明な完了セクション
                </SelectItem>
              ) : null}
              {completionTargetSections.map((section) => (
                <SelectItem
                  key={section.id}
                  value={section.id}
                  disabled={
                    !section.isCompletionTarget &&
                    section.id !== action.target_id
                  }
                >
                  {section.title}
                  {!section.isCompletionTarget ? "（入力欄あり）" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {action.type === "submit" && !hasCompletionTargetChoice && (
        <p
          id={completionTargetMessageId}
          className="text-xs text-muted-foreground"
        >
          完了セクションに使える入力欄なしセクションがありません
        </p>
      )}
      {hasInvalidCompletionTarget && (
        <p id={completionTargetErrorId} className="text-xs text-destructive">
          選択中の完了セクションに入力欄が含まれています
        </p>
      )}
      {hasMissingCompletionTarget && (
        <p id={completionTargetErrorId} className="text-xs text-destructive">
          選択中の完了セクションが見つかりません
        </p>
      )}
    </div>
  );
};
