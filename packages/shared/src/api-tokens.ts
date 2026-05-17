import { z } from "zod";

/** Supported API token scope values. */
export const apiTokenScopeSchema = z.enum(["read", "write", "admin"]);

/** A single supported API token scope. */
export type ApiTokenScope = z.infer<typeof apiTokenScopeSchema>;

/** One or more API token scopes. */
export const apiTokenScopesSchema = z.array(apiTokenScopeSchema).min(1);

/** Non-empty API token scope list. */
export type ApiTokenScopes = z.infer<typeof apiTokenScopesSchema>;

/** One or more non-empty form IDs used to restrict a token. */
export const apiTokenFormIdsSchema = z.array(z.string().min(1)).min(1);

/** Non-empty form ID restriction list. */
export type ApiTokenFormIds = z.infer<typeof apiTokenFormIdsSchema>;

/** Stored form IDs, with nullish database values normalized to undefined. */
export const storedApiTokenFormIdsSchema = apiTokenFormIdsSchema
  .nullish()
  .transform((value) => value ?? undefined);

/**
 * Parses a stored or requested API token scope list.
 *
 * @param value Unknown JSON value to validate.
 * @returns A non-empty list of supported API token scopes.
 * @throws Zod validation error from apiTokenScopesSchema when value is invalid.
 */
export function parseApiTokenScopes(value: unknown): ApiTokenScopes {
  return apiTokenScopesSchema.parse(value);
}

/**
 * Parses the optional form restriction list stored on an API token.
 *
 * @param value Unknown JSON value to validate.
 * @returns A non-empty form ID list, or undefined when value is nullish.
 * @throws Zod validation error from storedApiTokenFormIdsSchema when value is invalid.
 */
export function parseStoredApiTokenFormIds(
  value: unknown,
): ApiTokenFormIds | undefined {
  return storedApiTokenFormIdsSchema.parse(value);
}
