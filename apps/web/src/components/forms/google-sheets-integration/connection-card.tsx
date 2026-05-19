import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface GoogleSheetsLoadingCardProps {
  className?: string;
}

export function GoogleSheetsLoadingCard({
  className,
}: GoogleSheetsLoadingCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Google Sheets 連携</CardTitle>
        <CardDescription>読み込み中...</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

interface GoogleSheetsDisconnectedCardProps {
  className?: string;
  connectionLoadError: string | null;
  onConnect: () => void;
}

export function GoogleSheetsDisconnectedCard({
  className,
  connectionLoadError,
  onConnect,
}: GoogleSheetsDisconnectedCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Google Sheets 連携</CardTitle>
        <CardDescription>
          フォームの回答を自動的にGoogle Sheetsに同期できます
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {connectionLoadError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {connectionLoadError}
            </div>
          )}
          <div className="rounded-lg border bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">
              Google
              アカウントに接続して、スプレッドシートへの書き込み権限を付与してください
            </p>
          </div>
          <Button onClick={onConnect} className="w-full">
            <ExternalLink className="h-4 w-4 mr-2" />
            Google アカウントに接続
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
