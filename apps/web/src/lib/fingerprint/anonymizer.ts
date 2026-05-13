export interface AnonymizedFingerprint {
  id: string;
  responseId: string;
  fingerprintType: string;
  anonymizedId: string;
  isDuplicate: boolean;
  duplicateCount: number;
  collectedAt: Date;
  response: {
    id: string;
    formId: string;
    submittedAt: Date;
    respondentUuid: string;
  };
}

export interface AnonymizedFingerprintStats {
  totalFingerprints: number;
  uniqueFingerprints: number;
  duplicateFingerprints: number;
  duplicateRate: number;
  fingerprintTypes: Array<{
    type: string;
    count: number;
    uniqueCount: number;
    duplicateCount: number;
  }>;
}
