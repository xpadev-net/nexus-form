/**
 * 匿名化フィンガープリント表示コンポーネント
 * ユーザーに提示する際、フィンガープリントを完全に別のUUIDや連番に置き換え
 * 同一ユーザーであると判定されたか否かのみがわかるようにする
 */

import { BarChart3, Loader2, Shield, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import type {
  AnonymizedFingerprint,
  AnonymizedFingerprintStats,
} from "@/lib/fingerprint/anonymizer";
import { japanDateTimeFormatter } from "@/lib/formatters";
import { logError } from "@/lib/logger";

interface AnonymizedFingerprintDisplayProps {
  responseId?: string;
  formId?: string;
  showStats?: boolean;
  className?: string;
}

interface AnonymizedFingerprintResponse {
  success: boolean;
  data: {
    fingerprints: AnonymizedFingerprint[];
    stats?: AnonymizedFingerprintStats;
  };
  error?: string;
}

export function AnonymizedFingerprintDisplay({
  responseId,
  formId,
  showStats = false,
  className,
}: AnonymizedFingerprintDisplayProps) {
  const [fingerprints, setFingerprints] = useState<AnonymizedFingerprint[]>([]);
  const [stats, setStats] = useState<AnonymizedFingerprintStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnonymizedFingerprints = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (responseId) params.append("responseId", responseId);
      if (formId) params.append("formId", formId);
      if (showStats) params.append("includeStats", "true");

      const response = await fetch(
        `/api/fingerprint/anonymized?${params.toString()}`,
      );
      const data: AnonymizedFingerprintResponse = await response.json();

      if (!data.success) {
        throw new Error(
          data.error || "Failed to fetch anonymized fingerprints",
        );
      }

      setFingerprints(data.data.fingerprints);
      setStats(data.data.stats || null);
    } catch (err) {
      logError("Failed to fetch anonymized fingerprints:", "ui", {
        error: err,
      });
      setError(err instanceof Error ? err.message : "Unknown error occurred");
    } finally {
      setLoading(false);
    }
  }, [responseId, formId, showStats]);

  useEffect(() => {
    fetchAnonymizedFingerprints();
  }, [fetchAnonymizedFingerprints]);

  const formatDate = (date: Date) =>
    japanDateTimeFormatter.format(new Date(date));

  if (loading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">フィンガープリント情報を読み込み中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertDescription>
          フィンガープリント情報の取得に失敗しました: {error}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 統計情報 */}
      {showStats && stats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              フィンガープリント統計
            </CardTitle>
            <CardDescription>
              匿名化されたフィンガープリントの統計情報
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {stats.totalFingerprints}
                </div>
                <div className="text-sm text-muted-foreground">
                  総フィンガープリント数
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {stats.uniqueFingerprints}
                </div>
                <div className="text-sm text-muted-foreground">ユニーク数</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">
                  {stats.duplicateFingerprints}
                </div>
                <div className="text-sm text-muted-foreground">重複数</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {(stats.duplicateRate * 100).toFixed(1)}%
                </div>
                <div className="text-sm text-muted-foreground">重複率</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* フィンガープリント一覧 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            匿名化フィンガープリント一覧
          </CardTitle>
          <CardDescription>
            プライバシー保護のため、フィンガープリントは匿名化されています
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fingerprints.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground/70">
              フィンガープリントが見つかりませんでした
            </div>
          ) : (
            <div className="space-y-4">
              {fingerprints.map((fingerprint) => (
                <div
                  key={fingerprint.id}
                  className="border rounded-lg p-4 hover:bg-muted transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">
                        {fingerprint.anonymizedId}
                      </Badge>
                      <Badge
                        variant={
                          fingerprint.isDuplicate ? "destructive" : "secondary"
                        }
                      >
                        {fingerprint.isDuplicate ? "重複" : "ユニーク"}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground/70">
                      {formatDate(fingerprint.collectedAt)}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium">
                        フィンガープリントタイプ:
                      </span>
                      <span className="ml-2">
                        {fingerprint.fingerprintType}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium">重複回数:</span>
                      <span className="ml-2">
                        {fingerprint.duplicateCount}回
                      </span>
                    </div>
                    <div>
                      <span className="font-medium">レスポンスID:</span>
                      <span className="ml-2 font-mono text-xs">
                        {fingerprint.responseId}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium">回答者UUID:</span>
                      <span className="ml-2 font-mono text-xs">
                        {fingerprint.response.respondentUuid}
                      </span>
                    </div>
                  </div>

                  {fingerprint.isDuplicate && (
                    <Alert className="mt-3">
                      <Users className="h-4 w-4" />
                      <AlertDescription>
                        このフィンガープリントは他の回答と重複しています。
                        同一ユーザーによる複数回答の可能性があります。
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 更新ボタン */}
      <div className="flex justify-end">
        <Button onClick={fetchAnonymizedFingerprints} variant="outline">
          情報を更新
        </Button>
      </div>
    </div>
  );
}
