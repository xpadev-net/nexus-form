/**
 * Validation Provider Plugin Interface
 *
 * Docker 利用者が動的に追加できる検証プロバイダーのインターフェース
 */

import {
  type ValidationOutputValue,
  validationOutputValueSchema,
  validationOutputValuesSchema,
} from "@nexus-form/shared";
import { z } from "zod";

export { validationOutputValueSchema, validationOutputValuesSchema };

export interface ValidationProviderPatternTemplate {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly errorMessage: string;
  readonly placeholder: string;
  readonly pattern?: string;
  readonly inputType?: "text" | "email";
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly externalService?: string;
}

export interface ValidationProviderConfigOption {
  readonly value: string;
  readonly label: string;
}

export interface ValidationProviderConfigOptionSource {
  readonly endpoint: string;
  readonly collectionPath: string;
  readonly valuePath: string;
  readonly labelPath: string;
  readonly colorPath?: string;
  readonly dependsOn?: string;
}

export interface ValidationProviderConfigField {
  readonly name: string;
  readonly label: string;
  readonly kind: "text" | "select" | "multiselect" | "radio";
  readonly required?: boolean;
  readonly description?: string;
  readonly placeholder?: string;
  readonly defaultValue?: string | string[];
  readonly options?: readonly ValidationProviderConfigOption[];
  readonly optionSource?: ValidationProviderConfigOptionSource;
  readonly showWhen?: {
    readonly field: string;
    readonly exists?: boolean;
    readonly minItems?: number;
  };
}

export interface ValidationProviderLinkedAccount {
  readonly accountId: string;
  readonly accessToken?: string | null;
}

export interface ValidationProviderApiContext {
  readonly userId: string;
  readonly query: Readonly<Record<string, string>>;
  getLinkedAccount(
    providerId: string,
  ): Promise<ValidationProviderLinkedAccount | null>;
}

export type ValidationProviderApiHandler = (
  context: ValidationProviderApiContext,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export type ValidationProviderApiResponseSchemas = Readonly<
  Record<string, z.ZodType<Record<string, unknown>>>
>;

export interface ValidationProviderExecutionContext {
  readonly signal: AbortSignal;
  /**
   * Absolute Unix timestamp in milliseconds after which the host may stop
   * waiting for the plugin execution.
   */
  readonly deadlineAt: number;
}

export const validationProviderResultSchema = z.object({
  isValid: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  outputValues: validationOutputValuesSchema.optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  retryAfter: z.number().optional(),
  retryable: z.boolean().optional(),
});

export interface ValidationProviderRule<
  TInput = string,
  TConfig = Record<string, unknown>,
  TOutputValue = unknown,
> {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly inputHint: string;
  readonly inputPattern?: string;
  readonly patternTemplate?: ValidationProviderPatternTemplate;
  readonly configFields?: readonly ValidationProviderConfigField[];
  readonly inputSchema: z.ZodType<TInput>;
  readonly configSchema: z.ZodType<TConfig>;
  readonly metadataSchema: z.ZodSchema;

  validate(
    input: TInput,
    config: TConfig,
    context?: ValidationProviderExecutionContext,
  ): Promise<ValidationProviderResult<TOutputValue>>;

  sanitizeConfig?(config: Record<string, unknown>): TConfig;
  normalizeInput?(input: TInput): TInput;
}

export interface ValidationProvider {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly rules: Readonly<Record<string, ValidationProviderRule>>;
  readonly apiHandlers?: Readonly<Record<string, ValidationProviderApiHandler>>;
  readonly apiResponseSchemas?: ValidationProviderApiResponseSchemas;

  /**
   * Optional upstream-API health check. When implemented, the host can
   * surface the result through its service-monitoring endpoints. Should
   * resolve to `true` when the upstream is reachable — treat auth-required
   * responses (401/403) as healthy since the endpoint is alive.
   */
  healthCheck?(): Promise<boolean>;
}

export interface ValidationProviderResult<TOutputValue = unknown> {
  isValid: boolean;
  metadata?: Record<string, unknown>;
  outputValues?: readonly ValidationOutputValue<TOutputValue>[];
  errorCode?: string;
  errorMessage?: string;
  retryAfter?: number;
  retryable?: boolean;
}
