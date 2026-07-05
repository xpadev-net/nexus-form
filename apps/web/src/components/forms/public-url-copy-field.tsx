import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { CopyFeedbackButton } from "@/components/ui/copy-feedback-button";
import { Input } from "@/components/ui/input";
import { useCopyFeedback } from "@/hooks/use-copy-feedback";

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
  const copyFeedback = useCopyFeedback();
  const previousUrlRef = useRef(url);
  const copyLabels = {
    idle: `${label} をコピー`,
    copied: `${label} をコピーしました`,
    failed: `${label} を手動でコピーしてください`,
  };

  useEffect(() => {
    if (previousUrlRef.current === url) {
      return;
    }
    previousUrlRef.current = url;
    copyFeedback.reset();
  }, [copyFeedback.reset, url]);

  const handleCopy = async () => {
    const targetUrl = url;
    const copied = await copyText(targetUrl);
    if (previousUrlRef.current !== targetUrl) {
      return;
    }
    if (copied) {
      copyFeedback.markCopied();
      toast.success(copiedMessage);
      return;
    }
    copyFeedback.markFailed();
    toast.error("公開 URL のコピーに失敗しました");
  };

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={url} className="font-mono text-xs" />
        <CopyFeedbackButton
          labels={copyLabels}
          status={copyFeedback.status}
          onClick={handleCopy}
        />
      </div>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
