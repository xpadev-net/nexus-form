/**
 * Consolidated utility functions for date and time components
 * Combines commonly used functions to reduce bundle size
 */

export type DateFormat = "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY";
export type TimeFormat = "24h" | "12h";

/**
 * Date and Time Input Utilities
 *
 * Provides utility functions for date and time input handling,
 * including format detection, placeholder generation, and value normalization.
 *
 * @example
 * ```typescript
 * const inputType = DateTimeUtils.getDateInputType("YYYY-MM-DD");
 * const placeholder = DateTimeUtils.getDatePlaceholder("MM/DD/YYYY");
 * const normalizedValue = DateTimeUtils.normalizeDateValue("12/31/2024", "MM/DD/YYYY");
 * ```
 */
export const DateTimeUtils = {
  /**
   * Determines the appropriate HTML input type based on date format
   */
  getDateInputType: (dateFormat: DateFormat): "date" | "text" => {
    return dateFormat === "YYYY-MM-DD" ? "date" : "text";
  },

  /**
   * Determines the appropriate HTML input type based on time format
   */
  getTimeInputType: (timeFormat: TimeFormat): "time" | "text" => {
    return timeFormat === "24h" ? "time" : "text";
  },

  /**
   * Generates appropriate placeholder text for date input based on format
   */
  getDatePlaceholder: (dateFormat: DateFormat): string => {
    switch (dateFormat) {
      case "YYYY-MM-DD":
        return "2024-01-01";
      case "MM/DD/YYYY":
        return "01/01/2024";
      case "DD/MM/YYYY":
        return "31/01/2024";
      default:
        return "日付を入力してください";
    }
  },

  /**
   * Generates appropriate placeholder text for time input based on format
   */
  getTimePlaceholder: (timeFormat: TimeFormat): string => {
    return timeFormat === "24h" ? "14:30" : "2:30 PM";
  },

  /**
   * Normalizes date input value based on format
   */
  normalizeDateValue: (inputValue: string, dateFormat: DateFormat): string => {
    if (!inputValue) return "";

    if (dateFormat === "YYYY-MM-DD") {
      return inputValue;
    }

    return inputValue.trim();
  },

  /**
   * Normalizes time input value based on format
   */
  normalizeTimeValue: (inputValue: string, timeFormat: TimeFormat): string => {
    if (!inputValue) return "";

    if (timeFormat === "24h") {
      return inputValue;
    }

    if (timeFormat === "12h") {
      return inputValue
        .trim()
        .replace(/\s+(am|pm)$/i, (_match, p1) => ` ${p1.toUpperCase()}`);
    }

    return inputValue.trim();
  },

  /**
   * Validates if a date format is supported
   */
  isValidDateFormat: (format: string): format is DateFormat => {
    return ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"].includes(format);
  },

  /**
   * Validates if a time format is supported
   */
  isValidTimeFormat: (format: string): format is TimeFormat => {
    return ["24h", "12h"].includes(format);
  },
};

/**
 * Input Masking Utilities with Validation
 *
 * Provides progressive input masking for date and time formats with built-in validation.
 * Prevents invalid intermediate states and ensures proper formatting.
 *
 * @example
 * ```typescript
 * const maskedDate = InputMasking.maskMMDDYYYY("12312024"); // "12/31/2024"
 * const maskedTime = InputMasking.mask12HourTime("230pm"); // "2:30 PM"
 * const isValid = InputMasking.isCompleteMaskedValue("12/31/2024", "MM/DD/YYYY");
 * ```
 */
export const InputMasking = {
  /**
   * Applies input masking for MM/DD/YYYY format with validation
   */
  maskMMDDYYYY: (value: string): string => {
    const numbers = value.replace(/\D/g, "");

    if (numbers.length >= 2) {
      const month = numbers.slice(0, 2);
      // Validate month (01-12) - prevent invalid months
      if (parseInt(month, 10) > 12 || parseInt(month, 10) < 1) {
        return numbers.slice(0, 1); // Return only valid part
      }

      if (numbers.length >= 4) {
        const day = numbers.slice(2, 4);
        // Validate day (01-31) - prevent invalid days
        if (parseInt(day, 10) > 31 || parseInt(day, 10) < 1) {
          return `${month}/${numbers.slice(3, 4)}`;
        }

        if (numbers.length >= 8) {
          const year = numbers.slice(4, 8);
          // Basic year validation (1900-2100)
          const yearNum = parseInt(year, 10);
          if (yearNum < 1900 || yearNum > 2100) {
            return `${month}/${day}/${numbers.slice(4, 7)}`;
          }
          return `${month}/${day}/${year}`;
        }
        return `${month}/${day}`;
      }
      return month;
    }

    return numbers;
  },

  /**
   * Applies input masking for DD/MM/YYYY format with validation
   */
  maskDDMMYYYY: (value: string): string => {
    const numbers = value.replace(/\D/g, "");

    if (numbers.length >= 2) {
      const day = numbers.slice(0, 2);
      // Validate day (01-31) - prevent invalid days
      if (parseInt(day, 10) > 31 || parseInt(day, 10) < 1) {
        return numbers.slice(0, 1);
      }

      if (numbers.length >= 4) {
        const month = numbers.slice(2, 4);
        // Validate month (01-12) - prevent invalid months
        if (parseInt(month, 10) > 12 || parseInt(month, 10) < 1) {
          return `${day}/${numbers.slice(3, 4)}`;
        }

        if (numbers.length >= 8) {
          const year = numbers.slice(4, 8);
          // Basic year validation (1900-2100)
          const yearNum = parseInt(year, 10);
          if (yearNum < 1900 || yearNum > 2100) {
            return `${day}/${month}/${numbers.slice(4, 7)}`;
          }
          return `${day}/${month}/${year}`;
        }
        return `${day}/${month}`;
      }
      return day;
    }

    return numbers;
  },

  /**
   * Applies input masking for 12h time format with validation
   */
  mask12HourTime: (value: string): string => {
    // Extract numbers and AM/PM separately
    const numbers = value.replace(/\D/g, "");
    const ampm = value.match(/[AP]M?/gi)?.[0] || "";

    // Handle case where user types "230pm" -> "2:30 PM" (exactly 3 digits)
    if (numbers.length === 3 && ampm) {
      const hours = numbers.slice(0, 1);
      const minutes = numbers.slice(1, 3);
      // Validate hours (1-12) - always format for 3-digit input
      if (parseInt(hours, 10) >= 1 && parseInt(hours, 10) <= 12) {
        return `${hours}:${minutes} ${ampm}`.trim();
      }
    }

    if (numbers.length >= 2) {
      const hours = numbers.slice(0, 2);
      // Validate hours (01-12 for 12h format) - prevent invalid hours
      if (parseInt(hours, 10) > 12 || parseInt(hours, 10) < 1) {
        return `${numbers.slice(0, 1)}:${ampm}`.trim();
      }

      if (numbers.length >= 4) {
        const minutes = numbers.slice(2, 4);
        // Validate minutes (00-59) - prevent invalid minutes
        if (parseInt(minutes, 10) > 59 || parseInt(minutes, 10) < 0) {
          return `${hours}:${numbers.slice(2, 3)} ${ampm}`.trim();
        }
        return `${hours}:${minutes} ${ampm}`.trim();
      }

      // For exactly 2 digits, add :00 for minutes
      if (numbers.length === 2) {
        return `${hours}:00 ${ampm}`.trim();
      }

      return `${hours}:${ampm}`.trim();
    }

    return `${numbers}${ampm}`.trim();
  },

  /**
   * Validates if a masked value is complete and valid
   */
  isCompleteMaskedValue: (value: string, format: string): boolean => {
    switch (format) {
      case "MM/DD/YYYY":
        return (
          /^\d{2}\/\d{2}\/\d{4}$/.test(value) && InputMasking.isValidDate(value)
        );
      case "DD/MM/YYYY":
        return (
          /^\d{2}\/\d{2}\/\d{4}$/.test(value) && InputMasking.isValidDate(value)
        );
      case "12h":
        return /^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(value);
      default:
        return true;
    }
  },

  /**
   * Validates if a date string represents a valid date
   * Handles multiple date formats: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY
   */
  isValidDate: (dateString: string): boolean => {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
      return false;
    }

    // Check if the date string matches common formats
    const isoFormat = /^\d{4}-\d{2}-\d{2}$/;
    const mmddyyyyFormat = /^\d{2}\/\d{2}\/\d{4}$/;
    const ddmmyyyyFormat = /^\d{2}\/\d{2}\/\d{4}$/;

    if (isoFormat.test(dateString)) {
      return date.toISOString().split("T")[0] === dateString;
    }

    if (mmddyyyyFormat.test(dateString) || ddmmyyyyFormat.test(dateString)) {
      // For MM/DD/YYYY and DD/MM/YYYY, just check if it's a valid date
      return true;
    }

    return false;
  },
};
