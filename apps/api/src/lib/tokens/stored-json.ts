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

export class MalformedStoredApiTokenJsonError extends Error {
  constructor(
    public readonly tokenId: string,
    public readonly operation: string,
  ) {
    super("Stored API token JSON is malformed");
    this.name = "MalformedStoredApiTokenJsonError";
  }
}

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

export function requireStoredApiTokenJson(
  token: StoredApiTokenJson,
  operation: string,
): ParsedApiTokenJson {
  const parsedJson = parseStoredApiTokenJson(token, operation);
  if (!parsedJson) {
    throw new MalformedStoredApiTokenJsonError(token.id, operation);
  }
  return parsedJson;
}
