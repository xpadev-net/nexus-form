import { z } from "zod";

/** 汎用エラーレスポンスは `{ error: string }` のみを返します。 */
export const ErrorResponseSchema = z
  .object({
    error: z.string(),
  })
  .strict();
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * 指定したエラーメッセージを `ErrorResponseSchema.parse` で検証し、
 * `ErrorResponse` として返します。
 */
export const errorResponse = (error: string): ErrorResponse =>
  ErrorResponseSchema.parse({ error });
