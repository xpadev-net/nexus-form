import { z } from "zod";

const nestedApiErrorSchema = z
  .object({
    message: z.string().optional(),
    code: z.string().optional(),
    details: z.unknown().optional(),
  })
  .passthrough();

export const ApiErrorResponseSchema = z
  .object({
    error: z.union([z.string(), nestedApiErrorSchema]).optional(),
    message: z.string().optional(),
    code: z.string().optional(),
    details: z.unknown().optional(),
  })
  .passthrough();

export const ApiErrorEnvelopeSchema = ApiErrorResponseSchema;

type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export interface ParsedApiError {
  message: string;
  code: string | null;
  details: Record<string, unknown> | null;
}

const apiErrorRecordSchema = z.record(z.string(), z.unknown());

function firstNonEmptyString(
  ...values: Array<string | undefined>
): string | undefined {
  return values.find((value) => value !== undefined && value.length > 0);
}

export function parseApiErrorResponse(
  body: unknown,
  status: number,
): ParsedApiError {
  const fallback = `HTTP ${status}`;
  const details = apiErrorRecordSchema.safeParse(body);
  const parsedDetails = details.success ? details.data : null;
  const parsed = ApiErrorResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { message: fallback, code: null, details: parsedDetails };
  }

  const error = parsed.data.error;
  const nestedError =
    typeof error === "object" && error !== null ? error : undefined;
  const message =
    firstNonEmptyString(
      nestedError?.message,
      typeof error === "string" ? error : undefined,
      parsed.data.message,
    ) ?? fallback;
  const code = nestedError?.code ?? parsed.data.code ?? null;

  return {
    message,
    code,
    details: parsedDetails,
  };
}

export const parseApiError = parseApiErrorResponse;

export type { ApiErrorResponse };
