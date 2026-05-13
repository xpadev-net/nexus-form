/**
 * Constants for version management
 */

export const VERSION_CONSTANTS = {
  /** Default limit for version list queries */
  DEFAULT_LIMIT: 20,
  /** Maximum retry attempts for version number conflicts */
  MAX_RETRY_ATTEMPTS: 3,
  /** Initial retry delay in milliseconds */
  INITIAL_RETRY_DELAY: 100,
} as const;
