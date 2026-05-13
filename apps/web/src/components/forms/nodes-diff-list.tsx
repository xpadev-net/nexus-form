import { GitCompare, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useDiffDisplay, useFormDiff } from "@/hooks/forms/use-form-diff";

interface NodesDiffListProps {
  formId: string;
}

export function NodesDiffList({ formId }: NodesDiffListProps) {
  const { formDiffQuery, nodes, hasValidationRuleChanges } =
    useFormDiff(formId);
  const { getDiffTypeDisplayName, getDiffTypeColor } = useDiffDisplay();

  if (formDiffQuery.isLoading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        変更内容を読み込み中...
      </div>
    );
  }

  if (formDiffQuery.isError) {
    return (
      <div className="p-4 text-sm text-destructive">
        変更内容の取得に失敗しました
      </div>
    );
  }

  const hasNodeChanges = nodes.length > 0;

  if (!hasNodeChanges && !hasValidationRuleChanges) {
    return (
      <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
        <GitCompare className="h-4 w-4" />
        変更されたコンテンツはありません
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {hasValidationRuleChanges && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-300 bg-amber-50">
          <span className="text-amber-600 text-sm font-medium">
            バリデーションルールが変更されました
          </span>
        </div>
      )}

      {nodes.map((node) => (
        <div
          key={node.nodeId}
          className={`flex items-center justify-between px-3 py-2 rounded-md border ${getDiffTypeColor(node.diffType)}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {node.diffType === "added" && (
              <Plus className="h-3.5 w-3.5 shrink-0" />
            )}
            {node.diffType === "removed" && (
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
            )}
            {node.diffType === "modified" && (
              <GitCompare className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="text-sm font-mono truncate">{node.nodeId}</span>
            {node.nodeType && (
              <Badge variant="outline" className="text-xs shrink-0">
                {node.nodeType}
              </Badge>
            )}
          </div>
          <Badge
            variant="secondary"
            className={`text-xs shrink-0 ml-2 ${getDiffTypeColor(node.diffType)}`}
          >
            {getDiffTypeDisplayName(node.diffType)}
          </Badge>
        </div>
      ))}
    </div>
  );
}
