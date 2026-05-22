import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type {
  CollectedFingerprint,
  ExistingFingerprintItem,
  FingerprintComponentItem,
  FingerprintStats,
} from "./model";

export function CollectionResultSection({
  hasCollected,
  fingerprint,
  components,
  stats,
  responseId,
  isSaving,
  showDetails,
  onSave,
}: {
  hasCollected: boolean;
  fingerprint: CollectedFingerprint | null;
  components: FingerprintComponentItem[];
  stats: FingerprintStats;
  responseId?: string;
  isSaving: boolean;
  showDetails: boolean;
  onSave: () => void;
}) {
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

      <div className="grid grid-cols-2 gap-2">
        <Badge variant="secondary">Total: {stats.totalComponents}</Badge>
        <Badge variant="secondary">
          Confidence: {(stats.averageConfidence * 100).toFixed(1)}%
        </Badge>
      </div>

      {responseId && (
        <Button onClick={onSave} disabled={isSaving} className="w-full">
          {isSaving ? "保存中..." : "フィンガープリントを保存"}
        </Button>
      )}

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
}

export function ExistingFingerprintsSection({
  existingFingerprints,
  isLoadingFingerprints,
  isDeleting,
  onDelete,
}: {
  existingFingerprints: ExistingFingerprintItem[];
  isLoadingFingerprints: boolean;
  isDeleting: boolean;
  onDelete: () => void;
}) {
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
              onClick={onDelete}
              variant="outline"
              size="sm"
              disabled={isLoadingFingerprints || isDeleting}
            >
              削除
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FingerprintErrors({
  activeError,
}: {
  activeError: Error | null | undefined;
}) {
  if (!activeError) return null;

  return (
    <Alert variant="destructive">
      <AlertDescription>{activeError.message}</AlertDescription>
    </Alert>
  );
}

export function FingerprintProgress({
  isLoading,
  collectionStage,
  collectionProgress,
}: {
  isLoading: boolean;
  collectionStage: string;
  collectionProgress: number;
}) {
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
}

export function CollectButtons({
  isConsented,
  isLoading,
  hasCollected,
  onCollect,
  onClear,
}: {
  isConsented: boolean;
  isLoading: boolean;
  hasCollected: boolean;
  onCollect: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex space-x-2">
      <Button
        onClick={onCollect}
        disabled={!isConsented || isLoading}
        className="flex-1"
      >
        {isLoading ? "収集中..." : "フィンガープリント収集"}
      </Button>

      {hasCollected && (
        <Button onClick={onClear} variant="outline" disabled={isLoading}>
          クリア
        </Button>
      )}
    </div>
  );
}
