import { AlertCircle, FileText, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useValidationResults } from "@/hooks/forms/use-validation-results";
import { ResponseDisplay } from "./response-display";
import { ValidationResultList } from "./validation-result-list";

interface ResponseDetailViewProps {
  formId: string;
  responseId: string;
  fields?: { label: string; value: string }[];
}

export function ResponseDetailView({
  formId,
  responseId,
  fields,
}: ResponseDetailViewProps) {
  const { validationResultsQuery } = useValidationResults(formId, responseId);

  return (
    <div className="space-y-4 rounded border p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FileText className="h-4 w-4" />
          回答詳細
        </h2>
        <Badge variant="outline">{responseId}</Badge>
      </div>

      {validationResultsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          読み込み中...
        </div>
      ) : validationResultsQuery.isError ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          回答の取得に失敗しました
        </div>
      ) : (
        <>
          {fields && fields.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((field) => (
                <ResponseDisplay
                  key={field.label}
                  label={field.label}
                  value={field.value}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              回答内容はありません。
            </p>
          )}

          <ValidationResultList formId={formId} responseId={responseId} />
        </>
      )}
    </div>
  );
}
