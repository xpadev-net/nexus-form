import { GitBranch, Info } from "lucide-react";
import type { FC } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Block } from "@/types/domain/form-block";
import type { FormLogicRule } from "@/types/validation/form";

interface ConditionalBlockIndicatorProps {
  block: Block;
  rules: FormLogicRule[];
  className?: string;
}

/**
 * ブロックに適用されている条件を視覚的に表示するインジケーター
 */
export const ConditionalBlockIndicator: FC<ConditionalBlockIndicatorProps> = ({
  block,
  rules,
  className,
}) => {
  // このブロックに関連するルールを検索
  const relatedRules = rules.filter((rule) => {
    // 条件でこのブロックが参照されているか
    const inConditions = rule.conditions.some(
      (c) => c.question_id === block.blockId,
    );
    // アクションでこのブロックが対象になっているか
    const inActions = rule.action && rule.action.target_id === block.blockId;

    return (inConditions || inActions) && rule.enabled;
  });

  if (relatedRules.length === 0) {
    return null;
  }

  // ブロックが条件の対象か、アクションの対象かを判定
  const isConditionTarget = relatedRules.some((r) =>
    r.conditions.some((c) => c.question_id === block.blockId),
  );
  const isActionTarget = relatedRules.some(
    (r) => r.action && r.action.target_id === block.blockId,
  );

  const getStatusBadge = () => {
    if (isConditionTarget && isActionTarget) {
      return (
        <Badge variant="secondary" className="gap-1">
          <GitBranch className="h-3 w-3" />
          条件 & アクション対象
        </Badge>
      );
    }
    if (isConditionTarget) {
      return (
        <Badge variant="secondary" className="gap-1">
          <GitBranch className="h-3 w-3" />
          条件対象
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="gap-1">
        <GitBranch className="h-3 w-3" />
        アクション対象
      </Badge>
    );
  };

  const getTooltipContent = () => {
    return (
      <div className="space-y-2 max-w-xs">
        <p className="font-semibold text-sm">このブロックに関連するルール:</p>
        <ul className="space-y-1 text-xs">
          {relatedRules.map((rule) => (
            <li key={rule.id} className="flex items-start gap-1">
              <span className="text-primary">•</span>
              <div>
                <p className="font-medium">{rule.name}</p>
                {rule.description && (
                  <p className="text-muted-foreground">{rule.description}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("flex items-center gap-2", className)}>
            {getStatusBadge()}
            <Info className="h-4 w-4 text-muted-foreground" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-sm">
          {getTooltipContent()}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default ConditionalBlockIndicator;
