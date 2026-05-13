import type { FormSnapshot } from "./form-snapshot";

// バージョン履歴APIで使用するDTO
export interface VersionHistoryItem extends FormSnapshot {
  authorName: string | null;
}
