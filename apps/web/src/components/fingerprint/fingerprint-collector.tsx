/**
 * フィンガープリント収集コンポーネント
 */

import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useFingerprint,
  useFingerprintManage,
} from "@/hooks/fingerprint/use-fingerprint";
import { logError, logInfo } from "@/lib/logger";
import { PrivacyNotice } from "./privacy-notice";

interface FingerprintCollectorProps {
  responseId?: string;
  onCollected?: (fingerprintType: string, componentCount: number) => void;
  showDetails?: boolean;
  className?: string;
  showPrivacyNotice?: boolean; // プライバシー注意書きを表示するか
}

export function FingerprintCollector({
  responseId,
  onCollected,
  showDetails = false,
  className,
  showPrivacyNotice = true,
}: FingerprintCollectorProps) {
  const [isConsented, setIsConsented] = useState(false);
  const [hasCollected, setHasCollected] = useState(false);
  const [collectionProgress, setCollectionProgress] = useState(0);
  const [collectionStage, setCollectionStage] = useState<string>("");

  const {
    fingerprint,
    components,
    isLoading,
    error,
    collect,
    clear,
    saveMutation,
  } = useFingerprint();

  // 収集完了時のコールバックと状態更新
  const prevFingerprintRef = useRef(fingerprint);
  useEffect(() => {
    if (fingerprint && fingerprint !== prevFingerprintRef.current) {
      setHasCollected(true);
      setCollectionProgress(100);
      setCollectionStage("完了");
      onCollected?.(fingerprint.fingerprintType, components.length);
    }
    prevFingerprintRef.current = fingerprint;
  }, [fingerprint, components.length, onCollected]);

  // 収集エラー時の状態更新
  useEffect(() => {
    if (error) {
      logError("Fingerprint collection failed:", "ui", { error });
      setCollectionStage("エラー");
    }
  }, [error]);

  // プログレッシブローディングのシミュレーション
  useEffect(() => {
    if (isLoading) {
      setCollectionProgress(0);
      setCollectionStage("初期化中...");

      const progressInterval = window.setInterval(() => {
        setCollectionProgress((prev) => {
          if (prev < 90) {
            setCollectionStage(
              prev < 30
                ? "ブラウザ情報収集中..."
                : "フィンガープリント生成中...",
            );
            return prev + 10;
          }
          return prev;
        });
      }, 200);

      return () => window.clearInterval(progressInterval);
    }
  }, [isLoading]);

  // 既存のフィンガープリント管理
  const { query: manageQuery, deleteMutation } = useFingerprintManage(
    responseId,
    undefined,
    true,
  );

  const existingFingerprints = manageQuery.data?.fingerprints ?? [];
  const isLoadingFingerprints = manageQuery.isLoading;
  const fingerprintManageError = manageQuery.error;

  const handleCollect = async () => {
    if (!isConsented) {
      alert("フィンガープリント収集に同意してください");
      return;
    }

    await collect();
  };

  const handleSave = async () => {
    if (fingerprint && responseId) {
      await saveMutation.mutateAsync({
        responseId,
        collected: fingerprint,
      });
      logInfo("Fingerprint saved successfully", "ui", {});
      // 保存後に既存のフィンガープリントを再取得
      await manageQuery.refetch();
    }
  };

  const handleClear = () => {
    clear();
    setHasCollected(false);
  };

  const handleDeleteFingerprint = async () => {
    if (responseId) {
      try {
        // deleteMutation は beforeIso を引数に取るため、現在時刻を使用
        await deleteMutation.mutateAsync(new Date().toISOString());
        await manageQuery.refetch();
      } catch (deleteError) {
        logError("Failed to delete fingerprint:", "ui", {
          error: deleteError,
        });
      }
    }
  };

  // コンポーネントの統計情報を計算
  const stats = {
    totalComponents: components.length,
    averageConfidence:
      components.length > 0
        ? components.reduce((sum, c) => sum + (c.confidence ?? 0), 0) /
          components.length
        : 0,
  };

  const saveError = saveMutation.error;
  const isSaving = saveMutation.isPending;

  /** 収集結果の表示セクション */
  const renderCollectionResult = () => {
    if (!hasCollected || !fingerprint) return null;

    return (
      <div className="space-y-4">
        <div>
          <h4 className="font-medium text-sm text-muted-foreground mb-2">
            フィンガープリント情報
          </h4>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">
              タイプ: {fingerprint.fingerprintType}
            </div>
            <div className="text-xs text-muted-foreground">
              コンポーネント数: {components.length}
            </div>
          </div>
        </div>

        {/* 統計情報 */}
        <div className="grid grid-cols-2 gap-2">
          <Badge variant="secondary">Total: {stats.totalComponents}</Badge>
          <Badge variant="secondary">
            Confidence: {(stats.averageConfidence * 100).toFixed(1)}%
          </Badge>
        </div>

        {/* 保存ボタン */}
        {responseId && (
          <Button onClick={handleSave} disabled={isSaving} className="w-full">
            {isSaving ? "保存中..." : "フィンガープリントを保存"}
          </Button>
        )}

        {/* 詳細表示 */}
        {showDetails && components.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-medium text-sm">収集されたコンポーネント</h4>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {components.map((component) => (
                <div
                  key={component.componentName}
                  className="flex justify-between items-center text-xs"
                >
                  <span className="font-mono">{component.componentName}</span>
                  <div className="flex items-center space-x-2">
                    <Badge variant="outline" className="text-xs">
                      {component.componentValueHash.slice(0, 8)}...
                    </Badge>
                    {component.confidence != null && (
                      <span className="text-muted-foreground/70">
                        {(component.confidence * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  /** 既存フィンガープリント一覧 */
  const renderExistingFingerprints = () => {
    if (existingFingerprints.length === 0) return null;

    return (
      <div className="space-y-2">
        <h4 className="font-medium text-sm">既存のフィンガープリント</h4>
        <div className="space-y-1">
          {existingFingerprints.map((fp) => (
            <div
              key={fp.id}
              className="flex justify-between items-center p-2 bg-muted rounded-md"
            >
              <div className="text-sm">
                <div className="font-medium">{fp.fingerprintType}</div>
                <div className="text-muted-foreground/70">
                  {fp.componentName}: {fp.componentValueHash.slice(0, 12)}...
                </div>
              </div>
              <Button
                onClick={() => handleDeleteFingerprint()}
                variant="outline"
                size="sm"
                disabled={isLoadingFingerprints || deleteMutation.isPending}
              >
                削除
              </Button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  /** エラー表示 */
  const renderErrors = () => {
    const activeError = error ?? saveError ?? fingerprintManageError;
    if (!activeError) return null;

    return (
      <Alert variant="destructive">
        <AlertDescription>{activeError.message}</AlertDescription>
      </Alert>
    );
  };

  /** プログレスバー */
  const renderProgress = () => {
    if (!isLoading) return null;

    return (
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>{collectionStage}</span>
          <span>{collectionProgress}%</span>
        </div>
        <Progress value={collectionProgress} className="w-full" />
      </div>
    );
  };

  /** 収集ボタン */
  const renderCollectButtons = () => (
    <div className="flex space-x-2">
      <Button
        onClick={handleCollect}
        disabled={!isConsented || isLoading}
        className="flex-1"
      >
        {isLoading ? "収集中..." : "フィンガープリント収集"}
      </Button>

      {hasCollected && (
        <Button onClick={handleClear} variant="outline" disabled={isLoading}>
          クリア
        </Button>
      )}
    </div>
  );

  return (
    <div className={className}>
      {showPrivacyNotice ? (
        <Tabs defaultValue="privacy" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="privacy">プライバシー情報</TabsTrigger>
            <TabsTrigger value="collector">フィンガープリント収集</TabsTrigger>
          </TabsList>

          <TabsContent value="privacy">
            <PrivacyNotice
              onConsentChange={setIsConsented}
              showDetails={true}
            />
          </TabsContent>

          <TabsContent value="collector">
            <Card>
              <CardHeader>
                <CardTitle>フィンガープリント収集</CardTitle>
                <CardDescription>
                  重複検出のため、デバイスのフィンガープリントを収集します。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 同意状況の表示 */}
                <div
                  className={`p-3 rounded-md ${
                    isConsented
                      ? "bg-green-50 border border-green-200"
                      : "bg-yellow-50 border border-yellow-200"
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        isConsented ? "bg-green-500" : "bg-yellow-500"
                      }`}
                    />
                    <span className="text-sm font-medium">
                      {isConsented
                        ? "プライバシー同意済み - フィンガープリント収集が可能です"
                        : "プライバシー同意が必要です - 上記タブで同意してください"}
                    </span>
                  </div>
                </div>

                {renderErrors()}
                {renderProgress()}
                {renderCollectButtons()}
                {renderCollectionResult()}
                {renderExistingFingerprints()}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>フィンガープリント収集</CardTitle>
            <CardDescription>
              重複検出のため、デバイスのフィンガープリントを収集します。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 同意チェックボックス */}
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="consent"
                checked={isConsented}
                onChange={(e) => setIsConsented(e.target.checked)}
                className="rounded border-border"
              />
              <label
                htmlFor="consent"
                className="text-sm text-muted-foreground"
              >
                フィンガープリント収集に同意します（プライバシーポリシーに従って処理されます）
              </label>
            </div>

            {renderErrors()}
            {renderProgress()}
            {renderCollectButtons()}
            {renderCollectionResult()}
            {renderExistingFingerprints()}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
