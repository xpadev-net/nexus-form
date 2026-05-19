import { z } from "zod";

/** `{ error: string }` のみを返すエラーレスポンス。 */
export const ErrorResponseSchema = z.object({
  error: z.string(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const errorResponse = (error: string): ErrorResponse =>
  ErrorResponseSchema.parse({ error });
