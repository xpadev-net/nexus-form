import { type FC, useState } from "react";
import { Button } from "@/components/ui/button";
import { useFormLogicManagement } from "@/hooks/forms/use-form-logic-management";

interface FormLogicManagerProps {
  formId: string;
}

export const FormLogicManager: FC<FormLogicManagerProps> = ({ formId }) => {
  const { rules, isLoading, error, deleteRule } =
    useFormLogicManagement(formId);
  const [isCreating, setIsCreating] = useState(false);

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-secondary">
        ロジックルールを読み込み中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive">
        ロジックルールの読み込みに失敗しました
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">ロジックルール</h3>
        <Button
          type="button"
          variant={isCreating ? "outline" : "default"}
          onClick={() => setIsCreating(!isCreating)}
        >
          {isCreating ? "キャンセル" : "ルールを追加"}
        </Button>
      </div>

      {rules.length === 0 && !isCreating && (
        <p className="text-sm text-secondary">
          ロジックルールはまだ設定されていません
        </p>
      )}

      <div className="space-y-2">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="flex items-center justify-between rounded-lg border p-3"
          >
            <div className="flex-1">
              <div className="text-sm font-medium">
                ブロック: {rule.sourceBlockId}
              </div>
              <div className="text-xs text-secondary">
                優先度: {rule.priority} | {rule.isActive ? "有効" : "無効"}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => deleteRule.mutate(rule.id)}
              className="ml-2 text-destructive hover:text-destructive hover:bg-transparent dark:hover:bg-transparent"
              disabled={deleteRule.isPending}
            >
              削除
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};
