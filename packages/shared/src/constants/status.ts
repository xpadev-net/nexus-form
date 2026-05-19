export const FORM_STATUS_VALUES = [
  "DRAFT",
  "PUBLISHED",
  "UNPUBLISHED",
  "ARCHIVED",
] as const;

export type FormStatusValue = (typeof FORM_STATUS_VALUES)[number];

export const VALIDATION_STATUS_VALUES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "MISSING",
] as const;

export type ValidationStatusValue = (typeof VALIDATION_STATUS_VALUES)[number];
