import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";

interface ResponseExportProps {
  formId: string;
}

export function ResponseExport({ formId }: ResponseExportProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      const response = await client.api.forms[":id"].responses.export.$get({
        param: { id: formId },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `responses-${encodeURIComponent(formId)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);

      toast.success("エクスポートが完了しました");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "エクスポートに失敗しました",
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExportCsv}
      disabled={isExporting}
    >
      {isExporting ? (
        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="mr-1 h-3.5 w-3.5" />
      )}
      CSVエクスポート
    </Button>
  );
}
