import {
  providerRegistry,
  type ValidationProvider,
  type ValidationProviderRule,
} from "@nexus-form/integrations";
import type {
  GetValidationProviderResponse,
  ListValidationProvidersResponse,
  ValidationProviderItem,
  ValidationProviderRuleItem,
} from "@nexus-form/shared";
import {
  getValidationProviderResponseSchema,
  listValidationProvidersResponseSchema,
} from "@nexus-form/shared";
import { withDualAuth } from "../lib/dual-auth";
import { createHonoApp } from "../lib/hono";

const toRuleResponseItem = (
  rule: ValidationProviderRule,
): ValidationProviderRuleItem => ({
  name: rule.name,
  label: rule.label,
  description: rule.description,
  inputHint: rule.inputHint,
  inputPattern: rule.inputPattern,
  patternTemplate: rule.patternTemplate,
  configFields: rule.configFields?.map((field) => ({
    ...field,
    options: field.options?.map((option) => ({ ...option })),
    optionSource: field.optionSource ? { ...field.optionSource } : undefined,
    showWhen: field.showWhen ? { ...field.showWhen } : undefined,
  })),
});

const toProviderResponseItem = (
  provider: ValidationProvider,
): ValidationProviderItem => ({
  name: provider.name,
  label: provider.label,
  description: provider.description,
  rules: Object.values(provider.rules).map(toRuleResponseItem),
});

export const validationProvidersRouter = createHonoApp()
  .use("/*", withDualAuth([]))
  .get("/", async (c) => {
    const providers = providerRegistry.getAll();

    const response: ListValidationProvidersResponse = {
      success: true,
      data: providers.map(toProviderResponseItem),
    };
    return c.json(listValidationProvidersResponseSchema.parse(response));
  })
  .get("/:name", async (c) => {
    const name = c.req.param("name");
    const provider = providerRegistry.get(name);

    if (!provider) {
      return c.json(
        {
          success: false as const,
          error: "Provider not found",
        },
        404,
      );
    }

    const response: GetValidationProviderResponse = {
      success: true,
      data: toProviderResponseItem(provider),
    };
    return c.json(getValidationProviderResponseSchema.parse(response));
  });
