import type {
  ValidationProviderConfigField,
  ValidationProviderItem,
} from "@nexus-form/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { FC } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CompositionAwareInput } from "@/components/ui/composition-aware-input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiUrl, baseUrl } from "@/lib/api";
import { fetchJson } from "@/lib/fetch-json";
import { getValidationProviderRule } from "@/lib/validation/validation-providers";

type ProviderConfig = Record<string, unknown>;

const EMPTY_PROVIDER_CONFIG: ProviderConfig = {};

interface ExternalServiceValidationConfigProps {
  providerName: string;
  ruleType: string;
  providers: ValidationProviderItem[];
  idPrefix: string;
  config?: ProviderConfig;
  disabled?: boolean;
  formId?: string;
  onChange: (nextConfig: ProviderConfig) => void;
}

type DynamicOption = {
  value: string;
  label: string;
  color?: number | string;
};

const getPathValue = (source: unknown, path: string): unknown => {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
};

const toStringArray = (value: unknown): string[] => {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
};

const getStringValue = (
  config: ProviderConfig,
  fieldName: string,
): string | undefined => {
  const value = config[fieldName];
  return typeof value === "string" ? value : undefined;
};

const resolveEndpoint = (
  endpoint: string,
  config: ProviderConfig,
): string | undefined => {
  let resolved = endpoint;
  for (const match of endpoint.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
    const fieldName = match[1];
    if (!fieldName) {
      return undefined;
    }
    const value = config[fieldName];
    if (typeof value !== "string" || value.length === 0) {
      return undefined;
    }
    resolved = resolved.replace(match[0], encodeURIComponent(value));
  }
  return resolved;
};

const shouldShowField = (
  field: ValidationProviderConfigField,
  config: ProviderConfig,
): boolean => {
  if (!field.showWhen) {
    return true;
  }

  const value = config[field.showWhen.field];
  if (field.showWhen.exists && !value) {
    return false;
  }
  if (
    field.showWhen.minItems !== undefined &&
    toStringArray(value).length < field.showWhen.minItems
  ) {
    return false;
  }
  return true;
};

function clearDependentValues(
  fields: ValidationProviderConfigField[],
  config: ProviderConfig,
  changedField: string,
): ProviderConfig {
  const next = { ...config };
  const queue = [changedField];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const field of fields) {
      const dependsOn =
        field.optionSource?.dependsOn ?? field.showWhen?.field ?? undefined;
      if (dependsOn !== current || !(field.name in next)) {
        continue;
      }
      delete next[field.name];
      queue.push(field.name);
    }
  }

  return next;
}

export const fetchOptions = async (
  field: ValidationProviderConfigField,
  endpoint: string,
  formId: string | undefined,
): Promise<DynamicOption[]> => {
  const url = new URL(apiUrl(endpoint));
  if (formId) {
    url.searchParams.set("formId", formId);
  }
  const shouldIncludeCredentials = url.origin === new URL(baseUrl).origin;
  const json = await fetchJson<unknown>(url, {
    credentials: shouldIncludeCredentials ? "include" : "omit",
  });

  const collection = field.optionSource
    ? getPathValue(json, field.optionSource.collectionPath)
    : undefined;

  if (!Array.isArray(collection) || !field.optionSource) {
    return [];
  }

  return collection.flatMap((item) => {
    const value = getPathValue(item, field.optionSource?.valuePath ?? "");
    const label = getPathValue(item, field.optionSource?.labelPath ?? "");
    if (typeof value !== "string" || typeof label !== "string") {
      return [];
    }
    const color = field.optionSource?.colorPath
      ? getPathValue(item, field.optionSource.colorPath)
      : undefined;
    return [
      {
        value,
        label,
        color:
          typeof color === "number" || typeof color === "string"
            ? color
            : undefined,
      },
    ];
  });
};

function useFieldOptions(
  service: string,
  field: ValidationProviderConfigField,
  config: ProviderConfig,
  formId: string | undefined,
) {
  const endpoint = field.optionSource
    ? resolveEndpoint(field.optionSource.endpoint, config)
    : undefined;

  return useQuery<DynamicOption[]>({
    queryKey: [
      "validation-provider-options",
      service,
      field.name,
      endpoint,
      formId,
    ],
    queryFn: () => fetchOptions(field, endpoint ?? "", formId),
    enabled: Boolean(endpoint),
    staleTime: 60_000,
  });
}

function formatColor(color: number | string | undefined): string | undefined {
  if (typeof color === "number" && color !== 0) {
    return `#${color.toString(16).padStart(6, "0")}`;
  }
  if (typeof color === "string" && color.length > 0) {
    return color.startsWith("#") ? color : `#${color}`;
  }
  return undefined;
}

const DynamicConfigField: FC<{
  service: string;
  field: ValidationProviderConfigField;
  fields: ValidationProviderConfigField[];
  config: ProviderConfig;
  disabled: boolean;
  formId: string | undefined;
  idPrefix: string;
  onConfigChange: (config: ProviderConfig | undefined) => void;
}> = ({
  service,
  field,
  fields,
  config,
  disabled,
  formId,
  idPrefix,
  onConfigChange,
}) => {
  const queryClient = useQueryClient();
  const optionQuery = useFieldOptions(service, field, config, formId);
  const sourceOptions = optionQuery.data ?? [];
  const staticOptions: DynamicOption[] = (field.options ?? []).map(
    (option) => ({
      value: option.value,
      label: option.label,
    }),
  );
  const options =
    field.optionSource === undefined ? staticOptions : sourceOptions;
  const isLoading = optionQuery.isLoading || optionQuery.isFetching;

  const setFieldValue = (value: unknown) => {
    const next = clearDependentValues(
      fields,
      { ...config, [field.name]: value },
      field.name,
    );
    onConfigChange(Object.keys(next).length > 0 ? next : undefined);
  };

  if (!shouldShowField(field, config)) {
    return null;
  }

  const reloadOptions = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["validation-provider-options", service, field.name],
    });
  };

  const description = field.description ? (
    <p className="text-xs text-muted-foreground">{field.description}</p>
  ) : null;
  const fieldId = `${idPrefix}-${field.name}`;

  if (field.kind === "text") {
    const value = getStringValue(config, field.name) ?? "";
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId}>
          {field.label}
          {field.required ? " *" : ""}
        </Label>
        <CompositionAwareInput
          id={fieldId}
          value={value}
          onChange={(event) => setFieldValue(event.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
        />
        {description}
      </div>
    );
  }

  if (field.kind === "select") {
    const value = getStringValue(config, field.name) ?? "";
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={fieldId}>
            {field.label}
            {field.required ? " *" : ""}
          </Label>
          {field.optionSource && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reloadOptions}
              disabled={disabled || isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  再読込中
                </>
              ) : (
                "再読込"
              )}
            </Button>
          )}
        </div>
        {optionQuery.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : optionQuery.isError ? (
          <div className="text-sm text-destructive">
            候補値の取得に失敗しました
          </div>
        ) : (
          <Select
            value={value}
            onValueChange={(nextValue) => setFieldValue(nextValue)}
            disabled={disabled || isLoading}
          >
            <SelectTrigger id={fieldId}>
              <SelectValue
                placeholder={field.placeholder ?? "選択してください"}
              />
            </SelectTrigger>
            <SelectContent>
              {options.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  選択可能な候補がありません
                </div>
              ) : (
                options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        )}
        {description}
      </div>
    );
  }

  if (field.kind === "multiselect") {
    const selectedValues = toStringArray(config[field.name]);
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>
            {field.label}
            {field.required ? " *" : ""}
          </Label>
          {field.optionSource && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reloadOptions}
              disabled={disabled || isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  再読込中
                </>
              ) : (
                "再読込"
              )}
            </Button>
          )}
        </div>
        {optionQuery.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : optionQuery.isError ? (
          <div className="text-sm text-destructive">
            候補値の取得に失敗しました
          </div>
        ) : (
          <div className="max-h-60 space-y-2 overflow-y-auto rounded-md border p-3">
            {options.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                選択可能な候補がありません
              </div>
            ) : (
              options.map((option) => {
                const checked = selectedValues.includes(option.value);
                const color = formatColor(option.color);
                const optionId = `${fieldId}-${option.value}`;
                return (
                  <div key={option.value} className="flex items-center gap-2">
                    <Checkbox
                      id={optionId}
                      checked={checked}
                      onCheckedChange={(nextChecked) => {
                        const nextValues = nextChecked
                          ? [...selectedValues, option.value]
                          : selectedValues.filter((id) => id !== option.value);
                        setFieldValue(nextValues);
                      }}
                      disabled={disabled}
                    />
                    <label
                      htmlFor={optionId}
                      className="flex flex-1 cursor-pointer items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {color && (
                        <span
                          className="size-3 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                      )}
                      <span>{option.label}</span>
                    </label>
                  </div>
                );
              })
            )}
          </div>
        )}
        {description}
      </div>
    );
  }

  if (field.kind === "radio") {
    const defaultValue =
      typeof field.defaultValue === "string" ? field.defaultValue : undefined;
    const value = getStringValue(config, field.name) ?? defaultValue;
    return (
      <div className="space-y-2">
        <Label>
          {field.label}
          {field.required ? " *" : ""}
        </Label>
        <RadioGroup
          value={value}
          onValueChange={(nextValue) => setFieldValue(nextValue)}
          disabled={disabled}
        >
          {options.map((option) => {
            const optionId = `${fieldId}-${option.value}`;
            return (
              <div key={option.value} className="flex items-center gap-2">
                <RadioGroupItem value={option.value} id={optionId} />
                <Label
                  htmlFor={optionId}
                  className="cursor-pointer font-normal"
                >
                  {option.label}
                </Label>
              </div>
            );
          })}
        </RadioGroup>
        {description}
      </div>
    );
  }

  return null;
};

export const ExternalServiceValidationConfig: FC<
  ExternalServiceValidationConfigProps
> = ({
  providerName,
  ruleType,
  providers,
  idPrefix,
  config = EMPTY_PROVIDER_CONFIG,
  disabled = false,
  formId,
  onChange,
}) => {
  const rule = getValidationProviderRule(providers, providerName, ruleType);
  const fields = rule?.configFields ?? [];

  if (!rule) {
    return (
      <p className="text-sm text-muted-foreground">
        プロバイダー情報を取得できませんでした。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>入力ガイド</Label>
        <p className="text-sm text-muted-foreground">{rule.inputHint}</p>
      </div>

      {fields.map((field) => (
        <DynamicConfigField
          key={field.name}
          service={providerName}
          field={field}
          fields={fields}
          config={config}
          disabled={disabled}
          formId={formId}
          idPrefix={idPrefix}
          onConfigChange={(nextConfig) => onChange(nextConfig ?? {})}
        />
      ))}
    </div>
  );
};
