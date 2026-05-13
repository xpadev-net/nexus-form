/**
 * Logger type definitions
 */

/**
 * Log context for structured logging
 */
export interface LogContext {
  userId?: string;
  formId?: string;
  requestId?: string;
  sessionId?: string;
  [key: string]: unknown;
}

/**
 * Log categories for better organization
 */
export type LogCategory =
  | "authentication"
  | "authorization"
  | "validation"
  | "database"
  | "api"
  | "security"
  | "integration"
  | "worker"
  | "general"
  | "service"
  | "ui"
  | string; // Allow custom categories for flexibility

/**
 * Sensitive field patterns that should be redacted
 *
 * Uses Pino's wildcard paths to redact nested fields:
 * - "fieldName" matches top-level fields
 * - "*.fieldName" matches fields nested one level deep
 * - "**.fieldName" matches fields at any nesting depth
 */
const SENSITIVE_FIELD_NAMES = [
  "password",
  "token",
  "secret",
  "apiKey",
  "api_key",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "privateKey",
  "private_key",
  "authToken",
  "auth_token",
  "sessionToken",
  "session_token",
  "authorization",
  "cookie",
  "cookies",
  "credentials",
];

/**
 * Generate redaction paths for all nesting levels
 * Includes top-level, one-level nested, and deeply nested fields
 */
export const SENSITIVE_FIELDS = SENSITIVE_FIELD_NAMES.flatMap((field) => [
  field, // Top-level: { password: "..." }
  `*.${field}`, // One level: { user: { password: "..." } }
  `**.${field}`, // Any depth: { req: { body: { user: { password: "..." } } } }
]);

/**
 * Log levels
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
