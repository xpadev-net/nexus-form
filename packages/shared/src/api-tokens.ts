import { z } from "zod";

export const apiTokenScopeSchema = z.enum(["read", "write", "admin"]);

export type ApiTokenScope = z.infer<typeof apiTokenScopeSchema>;

export const apiTokenScopesSchema = z.array(apiTokenScopeSchema).min(1);

export type ApiTokenScopes = z.infer<typeof apiTokenScopesSchema>;

export const apiTokenFormIdsSchema = z.array(z.string().min(1));

export type ApiTokenFormIds = z.infer<typeof apiTokenFormIdsSchema>;

export const storedApiTokenFormIdsSchema = apiTokenFormIdsSchema
  .nullish()
  .transform((value) => value ?? undefined);

export function parseApiTokenScopes(value: unknown): ApiTokenScopes {
  return apiTokenScopesSchema.parse(value);
}

export function parseStoredApiTokenFormIds(
  value: unknown,
): ApiTokenFormIds | undefined {
  return storedApiTokenFormIdsSchema.parse(value);
}
