/**
 * フィンガープリント収集コンポーネント
 */

import { useReducer, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useFingerprint,
  useFingerprintManage,
} from "@/hooks/fingerprint/use-fingerprint";
import { logError, logInfo } from "@/lib/logger";
import {
  calculateFingerprintStats,
  collectionReducer,
  initialCollectionState,
} from "./fingerprint-collector/model";
import {
  CollectButtons,
  CollectionResultSection,
  ExistingFingerprintsSection,
  FingerprintErrors,
  FingerprintProgress,
} from "./fingerprint-collector/sections";
import { PrivacyNotice } from "./privacy-notice";

interface FingerprintCollectorProps {
  responseId?: string;
  onCollected?: (fingerprintType: string, componentCount: number) => void;
  showDetails?: boolean;
  className?: string;
  showPrivacyNotice?: boolean;
}

function ConsentStatus({ isConsented }: { isConsented: boolean }) {
  return (
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
  );
}

export function FingerprintCollector({
  responseId,
  onCollected,
  showDetails = false,
  className,
  showPrivacyNotice = true,
}: FingerprintCollectorProps) {
  const [isConsented, setIsConsented] = useState(false);
  const [collectionState, dispatchCollection] = useReducer(
    collectionReducer,
    initialCollectionState,
  );

  const {
    fingerprint,
    components,
    isLoading,
    error,
    collect,
    clear,
    saveMutation,
  } = useFingerprint();

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

    dispatchCollection({ type: "start" });
    const progressInterval = window.setInterval(() => {
      dispatchCollection({ type: "progress" });
    }, 200);

    try {
      const collected = await collect();
      dispatchCollection({ type: "complete" });
      onCollected?.(collected.fingerprintType, collected.components.length);
    } catch (collectError) {
      logError("Fingerprint collection failed:", "ui", {
        error: collectError,
      });
      dispatchCollection({ type: "error" });
    } finally {
      window.clearInterval(progressInterval);
    }
  };

  const handleSave = async () => {
    if (fingerprint && responseId) {
      await saveMutation.mutateAsync({
        responseId,
        collected: fingerprint,
      });
      logInfo("Fingerprint saved successfully", "ui", {});
      await manageQuery.refetch();
    }
  };

  const handleClear = () => {
    clear();
    dispatchCollection({ type: "clear" });
  };

  const handleDeleteFingerprint = async () => {
    if (responseId) {
      try {
        await deleteMutation.mutateAsync(new Date().toISOString());
        await manageQuery.refetch();
      } catch (deleteError) {
        logError("Failed to delete fingerprint:", "ui", {
          error: deleteError,
        });
      }
    }
  };

  const stats = calculateFingerprintStats(components);
  const saveError = saveMutation.error;
  const isSaving = saveMutation.isPending;
  const activeError = error ?? saveError ?? fingerprintManageError;

  const renderCollectorContent = (showConsentStatus: boolean) => (
    <Card>
      <CardHeader>
        <CardTitle>フィンガープリント収集</CardTitle>
        <CardDescription>
          重複検出のため、デバイスのフィンガープリントを収集します。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {showConsentStatus && <ConsentStatus isConsented={isConsented} />}
        <FingerprintErrors activeError={activeError} />
        <FingerprintProgress
          isLoading={isLoading}
          collectionStage={collectionState.stage}
          collectionProgress={collectionState.progress}
        />
        <CollectButtons
          isConsented={isConsented}
          isLoading={isLoading}
          hasCollected={collectionState.hasCollected}
          onCollect={handleCollect}
          onClear={handleClear}
        />
        <CollectionResultSection
          hasCollected={collectionState.hasCollected}
          fingerprint={fingerprint}
          components={components}
          stats={stats}
          responseId={responseId}
          isSaving={isSaving}
          showDetails={showDetails}
          onSave={handleSave}
        />
        <ExistingFingerprintsSection
          existingFingerprints={existingFingerprints}
          isLoadingFingerprints={isLoadingFingerprints}
          isDeleting={deleteMutation.isPending}
          onDelete={handleDeleteFingerprint}
        />
      </CardContent>
    </Card>
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
            {renderCollectorContent(true)}
          </TabsContent>
        </Tabs>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="consent"
              checked={isConsented}
              onChange={(e) => setIsConsented(e.target.checked)}
              className="rounded border-border"
            />
            <label htmlFor="consent" className="text-sm text-muted-foreground">
              フィンガープリント収集に同意します（プライバシーポリシーに従って処理されます）
            </label>
          </div>
          {renderCollectorContent(false)}
        </div>
      )}
    </div>
  );
}
