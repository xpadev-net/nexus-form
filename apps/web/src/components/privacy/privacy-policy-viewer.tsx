import { CheckCircle, FileText, Loader2 } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { logError } from "@/lib/logger";

export interface PrivacyPolicyViewerProps {
  onAccept?: () => void;
  onDecline?: () => void;
  showActions?: boolean;
  className?: string;
}

export const PrivacyPolicyViewer: FC<PrivacyPolicyViewerProps> = ({
  onAccept,
  onDecline,
  showActions = true,
  className = "",
}) => {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPrivacyPolicy = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch("/docs/privacy-policy.md");

        if (!response.ok) {
          throw new Error(
            `プライバシーポリシーの読み込みに失敗しました: ${response.status}`,
          );
        }

        const text = await response.text();
        setContent(text);
      } catch (err) {
        logError("プライバシーポリシーの読み込みエラー:", "ui", { error: err });
        setError(
          err instanceof Error ? err.message : "不明なエラーが発生しました",
        );
      } finally {
        setLoading(false);
      }
    };

    loadPrivacyPolicy();
  }, []);

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="p-6">
          <div className="flex items-center justify-center space-x-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>プライバシーポリシーを読み込み中...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardContent className="p-6">
          <div className="text-center text-destructive">
            <p className="font-medium">エラーが発生しました</p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <FileText className="h-5 w-5" />
          <span>プライバシーポリシー</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[600px] p-6">
          <MarkdownRenderer content={content} />
        </ScrollArea>
        {showActions && (
          <div className="border-t p-6 space-y-4">
            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
              <CheckCircle className="h-4 w-4" />
              <span>
                上記のプライバシーポリシーに同意してサービスを利用しますか？
              </span>
            </div>
            <div className="flex space-x-3">
              <Button onClick={onAccept} className="flex-1" size="lg">
                同意する
              </Button>
              <Button
                onClick={onDecline}
                variant="outline"
                className="flex-1"
                size="lg"
              >
                同意しない
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PrivacyPolicyViewer;
