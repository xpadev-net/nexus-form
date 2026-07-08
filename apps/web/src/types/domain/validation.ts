// Domain validation types

/** Validation error details */
export interface ValidationError {
  field: string;
  message: string;
  code: string;
  value?: unknown;
}

/** Validation result */
export interface ValidationResult {
  is_valid: boolean;
  errors: ValidationError[];
  warnings?: ValidationError[];
}

/** External service validation result */
export interface ExternalServiceValidationResult {
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "MISSING";
  service: string;
  success: boolean | null;
  error_message?: string;
  attempt_count: number;
  last_attempt_at?: string;
  metadata?: Record<string, unknown>;
}
