import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";

interface ResponseExportProps {
  formId: string;
}

function getErrorMessage(payload: unknown): string | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const error = "error" in payload ? payload.error : undefined;
  const message = "message" in payload ? payload.message : undefined;
  if (typeof error === "string" && error.length > 0) return error;
  if (typeof message === "string" && message.length > 0) return message;
  return null;
}

async function readExportError(response: Response): Promise<string> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const payload: unknown = await response.json().catch(() => null);
    return getErrorMessage(payload) ?? `HTTP ${response.status}`;
  }

  const body = await response.text().catch(() => "");
  return body.trim() || `HTTP ${response.status}`;
}

function decodeQuotedFilename(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getContentDispositionFilename(contentDisposition: string | null) {
  if (!contentDisposition) return null;

  const encodedFilename = contentDisposition.match(
    /filename\*=UTF-8''([^;]+)/i,
  );
  if (encodedFilename?.[1]) {
    return decodeQuotedFilename(encodedFilename[1].trim());
  }

  const quotedFilename = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedFilename?.[1]) return quotedFilename[1];

  const filename = contentDisposition.match(/filename=([^;]+)/i);
  return filename?.[1]?.trim() ?? null;
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
        throw new Error(await readExportError(response));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        getContentDispositionFilename(
          response.headers.get("Content-Disposition"),
        ) ?? `responses-${encodeURIComponent(formId)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);

      toast.success(
        "すべての回答CSVを生成しました。ダウンロードを開始します。",
      );
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
      {isExporting ? "CSV生成中..." : "CSVエクスポート"}
    </Button>
  );
}
