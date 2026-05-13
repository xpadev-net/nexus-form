import { Eye, EyeOff } from "lucide-react";
import type { FC, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Block } from "@/types/domain/form-block";
import type { FormLogicRule } from "@/types/validation/form";

interface ConditionalBlockWrapperProps {
  block: Block;
  rules: FormLogicRule[];
  children: ReactNode;
  isPreview?: boolean;
  className?: string;
}

/**
 * 条件付きブロックをラップして視覚的な手がかりを提供するコンポーネント
 */
export const ConditionalBlockWrapper: FC<ConditionalBlockWrapperProps> = ({
  block,
  rules,
  children,
  isPreview = false,
  className,
}) => {
  // このブロックをターゲットにするルールを検索
  const affectingRules = rules.filter(
    (rule) =>
      rule.enabled && rule.action && rule.action.target_id === block.blockId,
  );

  if (affectingRules.length === 0) {
    return <>{children}</>;
  }

  // ルールの種類を分析（遷移ルールのアクションは3種類に限定）
  const hasShowHideRules = false; // 削除されたアクション型
  const hasRequireRules = false; // 削除されたアクション型

  return (
    <div
      className={cn(
        "relative",
        hasShowHideRules && "border-2 border-dashed rounded-lg",
        hasShowHideRules && "border-primary/40",
        className,
      )}
    >
      {/* 条件表示インジケーター */}
      {!isPreview && (
        <div className="absolute -top-3 left-4 z-10 flex gap-2">
          {hasShowHideRules && (
            <Badge
              variant="secondary"
              className="gap-1 bg-background border shadow-sm"
            >
              <Eye className="h-3 w-3" />
              条件付き表示
            </Badge>
          )}
          {hasRequireRules && (
            <Badge
              variant="secondary"
              className="gap-1 bg-background border shadow-sm"
            >
              <EyeOff className="h-3 w-3" />
              条件付き必須
            </Badge>
          )}
        </div>
      )}

      {/* 左側の視覚的バー */}
      {hasShowHideRules && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/40 rounded-l-lg" />
      )}

      {/* コンテンツ */}
      <div className={cn(hasShowHideRules && "p-1")}>{children}</div>

      {/* ルール数表示 */}
      {!isPreview && affectingRules.length > 0 && (
        <div className="absolute -bottom-3 right-4 z-10">
          <Badge variant="outline" className="text-xs bg-background shadow-sm">
            {affectingRules.length}個のルールが適用中
          </Badge>
        </div>
      )}
    </div>
  );
};

export default ConditionalBlockWrapper;
