type LogCategory = string;
type LogContext = Record<string, unknown>;

const formatMessage = (message: string, category?: LogCategory): string => {
  return category ? `[${category}] ${message}` : message;
};

export function logDebug(
  message: string,
  category?: LogCategory,
  context?: LogContext,
): void {
  console.debug(
    formatMessage(message, category),
    ...(context ? [context] : []),
  );
}

export function logInfo(
  message: string,
  category?: LogCategory,
  context?: LogContext,
): void {
  console.info(formatMessage(message, category), ...(context ? [context] : []));
}

export function logWarn(
  message: string,
  category?: LogCategory,
  context?: LogContext,
): void {
  console.warn(formatMessage(message, category), ...(context ? [context] : []));
}

export function logError(
  message: string,
  category?: LogCategory,
  context?: LogContext,
): void {
  console.error(
    formatMessage(message, category),
    ...(context ? [context] : []),
  );
}

export type { LogCategory, LogContext };
