import pino from "pino";
import type { LogCategory, LogContext, LogLevel } from "./types";
import { SENSITIVE_FIELDS } from "./types";

/**
 * Get log level based on environment
 */
function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();

  const validLevels: LogLevel[] = [
    "trace",
    "debug",
    "info",
    "warn",
    "error",
    "fatal",
  ];

  if (envLevel && validLevels.includes(envLevel as LogLevel)) {
    return envLevel as LogLevel;
  }

  if (envLevel) {
    console.warn(
      `Invalid LOG_LEVEL="${envLevel}". Must be one of: ${validLevels.join(", ")}. Falling back to default.`,
    );
  }

  if (process.env.NODE_ENV === "production") {
    return "info";
  }
  if (process.env.NODE_ENV === "test") {
    return "error";
  }
  return "debug";
}

/**
 * Create Pino logger instance (server-side only)
 */
const createPinoLogger = () => {
  return pino({
    level: getLogLevel(),
    formatters: {
      level: (label) => {
        return { level: label };
      },
      bindings: (bindings) => {
        return {
          pid: bindings.pid,
          hostname: bindings.hostname,
          node_env: process.env.NODE_ENV,
        };
      },
    },
    redact: {
      paths: SENSITIVE_FIELDS,
      censor: "[REDACTED]",
    },
    ...(process.env.NODE_ENV === "development" && {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
    }),
  });
};

/**
 * Base logger instance
 */
export const logger = createPinoLogger();

/**
 * Create a child logger with context
 */
export function createLogger(
  category: LogCategory,
  context?: LogContext,
): pino.Logger {
  return logger.child({
    category,
    ...context,
  });
}

export function logDebug(
  message: string,
  category: LogCategory = "general",
  context?: LogContext,
): void {
  const log = createLogger(category, context);
  log.debug(message);
}

export function logInfo(
  message: string,
  category: LogCategory = "general",
  context?: LogContext,
): void {
  const log = createLogger(category, context);
  log.info(message);
}

export function logWarn(
  message: string,
  category: LogCategory = "general",
  context?: LogContext,
): void {
  const log = createLogger(category, context);
  log.warn(message);
}

export function logError(
  message: string,
  category: LogCategory = "general",
  context?: LogContext,
): void {
  const { error, ...contextWithoutError } = context || {};
  const log = createLogger(category, contextWithoutError);

  const errorData: Record<string, unknown> = {};
  if (error) {
    if (error instanceof Error) {
      errorData.error = {
        message: error.message,
        stack: error.stack,
        name: error.name,
      };
    } else {
      errorData.error = error;
    }
  }

  log.error(errorData, message);
}

export function logFatal(
  message: string,
  category: LogCategory = "general",
  context?: LogContext,
): void {
  const { error, ...contextWithoutError } = context || {};
  const log = createLogger(category, contextWithoutError);

  const errorData: Record<string, unknown> = {};
  if (error) {
    if (error instanceof Error) {
      errorData.error = {
        message: error.message,
        stack: error.stack,
        name: error.name,
      };
    } else {
      errorData.error = error;
    }
  }

  log.fatal(errorData, message);
}

export type { LogCategory, LogContext, LogLevel } from "./types";
