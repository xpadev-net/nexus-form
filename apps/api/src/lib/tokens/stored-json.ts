import {
  type ApiTokenFormIds,
  type ApiTokenScopes,
  parseApiTokenScopes,
  parseStoredApiTokenFormIds,
} from "@nexus-form/shared";
import { logError } from "../logger";

type StoredApiTokenJson = {
  id: string;
  scopes: unknown;
  formIds: unknown;
};

export type ParsedApiTokenJson = {
  /** Non-empty scope list validated against the shared API token contract. */
  scopes: ApiTokenScopes;
  /** Optional non-empty form ID restriction list, normalized from nullish storage. */
  formIds: ApiTokenFormIds | undefined;
};

/**
 * Parses stored API token JSON fields and logs malformed values with context.
 *
 * @param token Stored token fields that include id, scopes, and formIds.
 * @param operation Read path name used in structured logs.
 * @returns Parsed token JSON, or null when stored JSON is malformed.
 */
export function parseStoredApiTokenJson(
  token: StoredApiTokenJson,
  operation: string,
): ParsedApiTokenJson | null {
  try {
    return {
      scopes: parseApiTokenScopes(token.scopes),
      formIds: parseStoredApiTokenFormIds(token.formIds),
    };
  } catch (error) {
    logError("Malformed stored API token JSON", "authentication", {
      error,
      operation,
      tokenId: token.id,
    });
    return null;
  }
}
