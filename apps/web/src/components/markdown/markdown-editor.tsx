import {
  type ClipboardEvent,
  type FC,
  lazy,
  Suspense,
  useCallback,
} from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { logError } from "@/lib/logger";
import { useTheme } from "@/lib/theme-context";

// React.lazy + Suspense でMarkdownエディタを読み込み
const MDEditor = lazy(() => import("@uiw/react-md-editor"));

export interface MarkdownEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  height?: number;
  className?: string;
  disabled?: boolean;
  onImageUpload?: (file: File) => Promise<string>;
  onFocus?: () => void;
  onBlur?: () => void;
}

export const MarkdownEditor: FC<MarkdownEditorProps> = ({
  value = "",
  onChange,
  placeholder = "Markdownで記述してください...",
  height = 400,
  className = "",
  disabled = false,
  onImageUpload,
  onFocus,
  onBlur,
}) => {
  const { resolvedTheme } = useTheme();

  const handleImageUpload = useCallback(
    async (file: File) => {
      if (!onImageUpload) {
        toast.error("画像アップロード機能が設定されていません");
        return;
      }

      try {
        const imageUrl = await onImageUpload(file);
        const imageMarkdown = `![${file.name}](${imageUrl})`;
        const newValue = value + (value ? "\n\n" : "") + imageMarkdown;
        onChange?.(newValue);
        toast.success("画像がアップロードされました");
      } catch (error) {
        logError("Image upload failed:", "ui", { error: error });
        toast.error("画像のアップロードに失敗しました");
      }
    },
    [onImageUpload, value, onChange],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items || !onImageUpload) return;

      for (let i = 0; i < items.length; i++) {
        const item: DataTransferItem | undefined = items[i];
        if (item?.type.startsWith("image/")) {
          event.preventDefault();
          const file = item.getAsFile();
          if (file) {
            handleImageUpload(file);
          }
          break;
        }
      }
    },
    [onImageUpload, handleImageUpload],
  );

  return (
    <div className={`markdown-editor ${className}`}>
      <Card>
        <CardContent className="p-0">
          <div
            onPaste={handlePaste}
            style={{ height: `${height}px` }}
            className="border-0"
          >
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-64">
                  Loading editor...
                </div>
              }
            >
              <MDEditor
                value={value}
                onChange={(val) => onChange?.(val || "")}
                height={height}
                data-color-mode={resolvedTheme === "dark" ? "dark" : "light"}
                visibleDragbar={false}
                textareaProps={{
                  placeholder,
                  disabled,
                  onFocus,
                  onBlur,
                }}
                preview="edit"
                hideToolbar={false}
                toolbarHeight={40}
              />
            </Suspense>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MarkdownEditor;
