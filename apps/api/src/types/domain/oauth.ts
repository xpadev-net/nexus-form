import { z } from "zod";

/**
 * OAuth token for a user and an external provider
 */
export const OAuthTokenSchema = z.object({
  userId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiryDate: z.string().min(1), // ISO string expected
  scopes: z.array(z.string().min(1)).default([]),
});

export type OAuthToken = z.infer<typeof OAuthTokenSchema>;
