export interface DataRetentionConfig {
  fingerprintRetentionDays: number;
  fingerprintDetailRetentionDays: number;
  responseRetentionDays?: number;
  autoCleanupEnabled: boolean;
  cleanupSchedule: string;
}

export interface DataRetentionStats {
  totalFingerprints: number;
  expiredFingerprints: number;
  totalFingerprintDetails: number;
  expiredFingerprintDetails: number;
  totalResponses: number;
  expiredResponses: number;
  lastCleanupDate: Date | null;
  nextCleanupDate: Date | null;
}

export interface CleanupResult {
  deletedFingerprints: number;
  deletedFingerprintDetails: number;
  deletedResponses: number;
  totalDeleted: number;
  errors: string[];
  cleanupDate: Date;
}
