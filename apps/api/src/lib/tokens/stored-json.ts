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
  scopes: ApiTokenScopes;
  formIds: ApiTokenFormIds | undefined;
};

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
