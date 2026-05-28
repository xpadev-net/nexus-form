import { Check } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  GoogleSheetsDisconnectedCard,
  GoogleSheetsLoadingCard,
} from "./google-sheets-integration/connection-card";
import { SheetSelector } from "./google-sheets-integration/sheet-selector";
import { SpreadsheetSelector } from "./google-sheets-integration/spreadsheet-selector";
import {
  GoogleSheetsSyncDescription,
  SyncActionButtons,
  SyncStatusPanel,
} from "./google-sheets-integration/sync-panel";
import { useGoogleSheetsIntegrationModel } from "./google-sheets-integration/use-google-sheets-integration-model";

interface GoogleSheetsIntegrationProps {
  formId: string;
  className?: string;
}

export function GoogleSheetsIntegration({
  formId,
  className,
}: GoogleSheetsIntegrationProps) {
  const model = useGoogleSheetsIntegrationModel(formId);

  if (model.isCheckingConnection || model.isLoadingConfig) {
    return <GoogleSheetsLoadingCard className={className} />;
  }

  if (!model.isConnected) {
    return (
      <GoogleSheetsDisconnectedCard
        className={className}
        connectionLoadError={model.connectionLoadError}
        onConnect={model.handleConnect}
      />
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Google Sheets 連携</CardTitle>
            <CardDescription>回答をGoogle Sheetsに自動同期</CardDescription>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-green-500" />
            <span>接続済み</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <SpreadsheetSelector
          searchQuery={model.searchQuery}
          selectedSpreadsheetId={model.selectedSpreadsheetId}
          filteredSpreadsheets={model.filteredSpreadsheets}
          isFetchingSpreadsheets={model.isFetchingSpreadsheets}
          spreadsheetsErrorMessage={model.spreadsheetsErrorMessage}
          isSpreadsheetDialogOpen={model.isSpreadsheetDialogOpen}
          newSpreadsheetTitle={model.newSpreadsheetTitle}
          isCreatingSpreadsheet={model.isCreatingSpreadsheet}
          onSearchQueryChange={model.handleSearchQueryChange}
          onRefreshSpreadsheets={model.handleRefreshSpreadsheets}
          onSelectSpreadsheet={model.handleSelectSpreadsheet}
          onSpreadsheetDialogOpenChange={
            model.handleSpreadsheetDialogOpenChange
          }
          onNewSpreadsheetTitleChange={model.handleNewSpreadsheetTitleChange}
          onCreateSpreadsheet={model.handleCreateSpreadsheetClick}
        />

        {model.selectedSpreadsheetId && (
          <>
            <Separator />
            <SheetSelector
              selectedSheetName={model.selectedSheetName}
              sheets={model.sheets}
              isFetchingSheets={model.isFetchingSheets}
              sheetsErrorMessage={model.sheetsErrorMessage}
              isSheetDialogOpen={model.isSheetDialogOpen}
              newSheetTitle={model.newSheetTitle}
              isAddingSheet={model.isAddingSheet}
              onSelectSheet={model.handleSelectSheet}
              onSheetDialogOpenChange={model.handleSheetDialogOpenChange}
              onNewSheetTitleChange={model.handleNewSheetTitleChange}
              onAddSheet={model.handleAddSheetClick}
            />
          </>
        )}

        {model.syncStatus && (
          <>
            <Separator />
            <SyncStatusPanel
              syncStatus={model.syncStatus}
              isSyncing={model.isSyncing}
              onClearSyncStatus={model.handleClearSyncStatus}
              onReauthenticate={model.handleConnect}
            />
          </>
        )}

        <Separator />
        <SyncActionButtons
          selectedSpreadsheetId={model.selectedSpreadsheetId}
          selectedSheetName={model.selectedSheetName}
          isSyncing={model.isSyncing}
          hasUnsavedChanges={model.hasUnsavedChanges}
          hasSavedConfig={Boolean(model.savedConfig)}
          onSaveConfig={model.handleSaveConfigClick}
          onSync={model.handleSyncClick}
        />

        <GoogleSheetsSyncDescription />
      </CardContent>
    </Card>
  );
}
