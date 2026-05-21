import { cn } from "@udecode/cn";
import { XIcon } from "lucide-react";
import { type FC, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export const MediaPreviewDialog: FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setPreviewUrl(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleClose]);

  return isOpen && previewUrl ? (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/80",
      )}
    >
      <button
        type="button"
        aria-label="Close preview"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={handleClose}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Close preview"
        className="absolute top-4 right-4 z-10 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white dark:hover:bg-black/70"
        onClick={handleClose}
      >
        <XIcon className="size-5" />
      </Button>
      <img
        src={previewUrl}
        alt="Preview"
        className="relative max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
      />
    </div>
  ) : null;
};
