export interface GoogleSheetsIntegrationSetting {
  spreadsheetId: string;
  sheetName: string;
  headerPolicy: "extend";
}

export type GoogleSheetsSyncMode = "incremental" | "full";

/** GET /forms/{formId}/integrations/google-sheets のレスポンス型 */
export interface FormIntegrationRecord {
  id: string;
  formId: string;
  ownerUserId: string;
  userId: string | null;
  config: GoogleSheetsIntegrationSetting;
  createdAt: string;
  updatedAt: string;
}

export interface FormIntegrationResponse {
  integration: FormIntegrationRecord | null;
}

/** POST /forms/{formId}/integrations/google-sheets/sync のリクエスト型 */
export interface SyncStartRequest {
  mode: GoogleSheetsSyncMode;
}

/** POST /forms/{formId}/integrations/google-sheets/sync のレスポンス型 */
export interface SyncStartResponse {
  jobId: string;
  mode?: GoogleSheetsSyncMode;
  requeued?: boolean;
  status: "queued";
}

/** GET /forms/{formId}/integrations/google-sheets/sync/{jobId} のレスポンス型 */
export interface SyncJobStatusResponse {
  job: {
    id?: string;
    name: string;
    state:
      | "active"
      | "waiting"
      | "delayed"
      | "paused"
      | "completed"
      | "failed"
      | "unknown";
    progress:
      | number
      | { processed?: number; total?: number; percentage?: number }
      | null;
    attemptsMade: number;
    failedReason?: string;
    result: unknown;
  };
}
