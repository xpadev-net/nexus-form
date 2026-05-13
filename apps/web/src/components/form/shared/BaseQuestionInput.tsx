import { memo, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputMasking } from "../utils/consolidated-utils";

/**
 * Base question input component
 * Extracts common functionality between DateQuestion and TimeQuestion
 */
export interface BaseQuestionInputProps {
  /** Question ID */
  id: string;
  /** Question title */
  title: string;
  /** Question description */
  description?: string;
  /** Current input value */
  value: string;
  /** Input change handler */
  onChange: (value: string) => void;
  /** Custom input change handler (for complex processing) */
  onInputChange?: (value: string) => void;
  /** Input type */
  type: "date" | "time" | "text";
  /** Placeholder text */
  placeholder?: string;
  /** Whether input is disabled */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Validation error message */
  error?: string;
  /** Whether validation is in progress */
  isValidating?: boolean;
  /** Format information to display */
  formatInfo?: string;
  /** Range information to display */
  rangeInfo?: string;
  /** Input format for masking (optional) */
  inputFormat?: string;
}

/**
 * Base question input component with common functionality
 */
export const BaseQuestionInput = memo<BaseQuestionInputProps>(
  ({
    id,
    title,
    description,
    value,
    onChange,
    onInputChange,
    type,
    placeholder,
    disabled = false,
    className,
    error,
    isValidating = false,
    formatInfo,
    rangeInfo,
    inputFormat,
  }) => {
    // Generate unique IDs for accessibility
    const inputId = `question-${id}`;
    const descriptionId = `${inputId}-description`;
    const errorId = `${inputId}-error`;
    const formatId = `${inputId}-format`;
    const rangeId = `${inputId}-range`;

    // Input masking for better UX
    const handleInputChange = useCallback(
      (inputValue: string) => {
        // Use custom input change handler if provided
        if (onInputChange) {
          onInputChange(inputValue);
          return;
        }

        if (!inputFormat) {
          onChange(inputValue);
          return;
        }

        let maskedValue = inputValue;

        switch (inputFormat) {
          case "MM/DD/YYYY":
            maskedValue = InputMasking.maskMMDDYYYY(inputValue);
            break;
          case "DD/MM/YYYY":
            maskedValue = InputMasking.maskDDMMYYYY(inputValue);
            break;
          case "12h":
            maskedValue = InputMasking.mask12HourTime(inputValue);
            break;
          default:
            maskedValue = inputValue;
        }

        onChange(maskedValue);
      },
      [onChange, onInputChange, inputFormat],
    );

    // ARIA attributes for accessibility
    const ariaDescribedBy = useMemo(() => {
      const ids = [descriptionId];
      if (formatInfo) ids.push(formatId);
      if (rangeInfo) ids.push(rangeId);
      if (error) ids.push(errorId);
      return ids.join(" ");
    }, [
      descriptionId,
      formatId,
      rangeId,
      errorId,
      error,
      formatInfo,
      rangeInfo,
    ]);

    return (
      <div className={`space-y-2 ${className || ""}`}>
        {/* Question Title */}
        <Label htmlFor={inputId} className="text-sm font-medium">
          {title}
          {isValidating && (
            <span className="ml-2 text-xs text-muted-foreground">
              (バリデーション中...)
            </span>
          )}
        </Label>

        {/* Question Description */}
        {description && (
          <p id={descriptionId} className="text-sm text-muted-foreground">
            {description}
          </p>
        )}

        {/* Format Information */}
        {formatInfo && (
          <p id={formatId} className="text-xs text-muted-foreground">
            {formatInfo}
          </p>
        )}

        {/* Range Information */}
        {rangeInfo && (
          <p id={rangeId} className="text-xs text-muted-foreground">
            {rangeInfo}
          </p>
        )}

        {/* Input Field */}
        <Input
          id={inputId}
          type={type}
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={ariaDescribedBy}
          aria-invalid={error ? "true" : "false"}
          className={error ? "border-destructive" : ""}
        />

        {/* Error Message */}
        {error && (
          <p id={errorId} className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);

BaseQuestionInput.displayName = "BaseQuestionInput";
