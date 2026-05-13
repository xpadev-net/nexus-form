import type { FC } from "react";
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

interface LogicActionBuilderProps {
  action: FormLogicAction;
  availableBlocks: BlockRef[];
  availableSections: Array<{ id: string; title: string }>;
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
  onChange,
  disabled = false,
}) => {
  const handleTypeChange = (type: FormLogicAction["type"]) => {
    if (type === "jump_to_section") {
      onChange({ type, target_id: availableSections[0]?.id });
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
      </div>
    </div>
  );
};
