export interface Spreadsheet {
  id: string;
  name?: string;
  itemType?: "spreadsheet";
  parents?: string[];
  folderPaths?: {
    folderIds: string[];
    pathSegments: {
      id: string;
      name: string;
    }[];
  }[];
}

export const SPREADSHEET_SELECTOR_RESULT_LIMIT = 20;

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
