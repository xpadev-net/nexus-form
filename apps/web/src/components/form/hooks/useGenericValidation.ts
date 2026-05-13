import { useCallback, useEffect, useRef, useState } from "react";
import { FormErrorMessages } from "../utils/error-messages";

/**
 * Generic validation hook that can be used for any input type
 * Reduces API coupling and provides more flexibility
 */
export interface ValidationConfig {
  /** Whether validation is required */
  required?: boolean;
  /** Custom validation function */
  validator?: (value: string) => Promise<ValidationResult>;
  /** Debounce delay in milliseconds */
  debounceDelay?: number;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Generic validation hook with race condition protection
 * @param value - Current input value
 * @param config - Validation configuration
 * @returns Validation state and functions
 */
export const useGenericValidation = (
  value: string,
  config: ValidationConfig = {},
) => {
  const [validationError, setValidationError] = useState<string | undefined>();
  const [isValidating, setIsValidating] = useState(false);

  // Track the current validation request ID to prevent race conditions
  const currentRequestId = useRef(0);

  const { validator, debounceDelay = 300 } = config;

  /**
   * Validates the current value with race condition protection
   */
  const validateValue = useCallback(
    async (inputValue: string): Promise<ValidationResult> => {
      if (!validator) {
        return { isValid: true };
      }

      // Increment request ID and capture it for this validation
      const requestId = ++currentRequestId.current;
      setIsValidating(true);

      try {
        const result = await validator(inputValue);

        // Only update state if this is still the most recent request
        if (requestId === currentRequestId.current) {
          if (!result.isValid) {
            setValidationError(result.error);
          } else {
            setValidationError(undefined);
          }
        }

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? FormErrorMessages.VALIDATION_ERROR
            : FormErrorMessages.VALIDATION_INVALID_FORMAT;

        // Only update state if this is still the most recent request
        if (requestId === currentRequestId.current) {
          setValidationError(errorMessage);
        }

        return { isValid: false, error: errorMessage };
      } finally {
        // Only update validating state if this is still the most recent request
        if (requestId === currentRequestId.current) {
          setIsValidating(false);
        }
      }
    },
    [validator],
  );

  // Debounced validation
  useEffect(() => {
    if (!validator) return;

    const timeoutId = window.setTimeout(() => {
      validateValue(value);
    }, debounceDelay);

    return () => window.clearTimeout(timeoutId);
  }, [value, validateValue, validator, debounceDelay]);

  return {
    validationError,
    isValidating,
    validateValue,
  };
};
