import {
  type ListValidationProvidersResponse,
  listValidationProvidersResponseSchema,
  type ValidationProviderItem,
  type ValidationProviderPatternTemplate,
  type ValidationProviderRuleItem,
} from "@nexus-form/shared";
import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";
import {
  VALIDATION_PATTERN_TEMPLATES,
  type ValidationPatternTemplate,
} from "@/lib/constants/validation-patterns";
import { fetchJson } from "@/lib/fetch-json";

export const fetchValidationProviders =
  async (): Promise<ListValidationProvidersResponse> => {
    const json = await fetchJson<unknown>(apiUrl("/api/validation-providers"), {
      credentials: "include",
    });
    return listValidationProvidersResponseSchema.parse(json);
  };

export const validationProvidersQueryKey = ["validation-providers"] as const;

export function useValidationProviders() {
  return useQuery<ListValidationProvidersResponse>({
    queryKey: validationProvidersQueryKey,
    queryFn: fetchValidationProviders,
    staleTime: 60_000,
  });
}

function toValidationPatternTemplate(
  template: ValidationProviderPatternTemplate,
): ValidationPatternTemplate {
  return {
    id: template.id,
    displayName: template.displayName,
    pattern: template.pattern,
    inputType: template.inputType,
    errorMessage: template.errorMessage,
    placeholder: template.placeholder,
    description: template.description,
    minLength: template.minLength,
    maxLength: template.maxLength,
    externalService: template.externalService,
  };
}

export function getProviderPatternTemplates(
  providers: ValidationProviderItem[],
): ValidationPatternTemplate[] {
  return providers
    .flatMap((provider) => provider.rules.map((rule) => rule.patternTemplate))
    .filter((template): template is ValidationProviderPatternTemplate =>
      Boolean(template),
    )
    .map(toValidationPatternTemplate);
}

export function getValidationPatternTemplates(
  providers: ValidationProviderItem[],
): ValidationPatternTemplate[] {
  return [
    ...VALIDATION_PATTERN_TEMPLATES,
    ...getProviderPatternTemplates(providers),
  ];
}

export function getValidationPatternTemplate(
  id: string | undefined,
  providers: ValidationProviderItem[],
): ValidationPatternTemplate | undefined {
  if (!id) {
    return undefined;
  }
  return getValidationPatternTemplates(providers).find(
    (template) => template.id === id,
  );
}

export function getValidationProviderByName(
  name: string | undefined,
  providers: ValidationProviderItem[],
): ValidationProviderItem | undefined {
  if (!name) {
    return undefined;
  }
  return providers.find((provider) => provider.name === name);
}

export function getValidationProviderRule(
  providers: ValidationProviderItem[],
  providerName: string | undefined,
  ruleType: string | undefined,
): ValidationProviderRuleItem | undefined {
  if (!providerName || !ruleType) {
    return undefined;
  }
  const provider = getValidationProviderByName(providerName, providers);
  return provider?.rules.find((rule) => rule.name === ruleType);
}
