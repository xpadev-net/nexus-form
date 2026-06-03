import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PublicUrlCopyFieldProps {
  id: string;
  label: string;
  url: string;
  copiedMessage: string;
  description?: string;
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to the textarea copy path below when the Clipboard API is unavailable at runtime.
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  Object.assign(textArea.style, {
    left: "-999999px",
    position: "fixed",
  });
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}

export function PublicUrlCopyField({
  id,
  label,
  url,
  copiedMessage,
  description,
}: PublicUrlCopyFieldProps) {
  const handleCopy = async () => {
    const copied = await copyText(url);
    if (copied) {
      toast.success(copiedMessage);
      return;
    }
    toast.error("公開 URL のコピーに失敗しました");
  };

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={url} className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`${label} をコピー`}
          onClick={handleCopy}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
