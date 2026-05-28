export interface Spreadsheet {
  id: string;
  name?: string;
}

export interface Sheet {
  sheetId?: number;
  title: string;
}

export type UiSyncStatus = "queued" | "processing" | "completed" | "failed";

export interface UiSyncState {
  jobId: string;
  status: UiSyncStatus;
  errorCode?: string;
  progress?: {
    processed?: number;
    total?: number;
    percentage?: number;
  };
  result?: {
    updatedRows?: number;
    updatedRange?: string;
  };
  error?: string;
}
