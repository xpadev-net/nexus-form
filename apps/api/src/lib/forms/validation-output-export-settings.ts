import {
  parseValidationOutputExportSettings,
  parseValidationOutputValuesFromMetadata,
  type ValidationOutputExportSetting,
  type ValidationOutputExportSettings,
} from "@nexus-form/shared";
import { desc, eq } from "drizzle-orm";
import { getFormStructure } from "./form-structure-service";

export interface ValidationOutputExportValueOption {
  rule_id: string;
  rule_name: string;
  provider_name: string;
  rule_type: string;
  output_key: string;
  label: string;
  enabled: boolean;
  source: "builtin" | "result" | "saved";
}

const UNKNOWN_PROVIDER_NAME = "unknown";
const UNKNOWN_RULE_TYPE = "unknown";
export const VALIDATION_OUTPUT_EXPORT_RESULT_DISCOVERY_LIMIT = 500;

const BUILTIN_OUTPUT_DEFINITIONS: Record<
  string,
  Record<string, Array<{ key: string; label: string }>>
> = {
  discord: {
    guild_member: [
      { key: "username", label: "Discord username" },
      { key: "display_name", label: "Display name" },
      { key: "guild_member", label: "Guild member" },
      { key: "roles", label: "Roles" },
    ],
  },
  github: {
    user_exists: [
      { key: "username", label: "GitHub username" },
      { key: "display_name", label: "Display name" },
      { key: "profile_url", label: "Profile URL" },
      { key: "followers", label: "Followers" },
    ],
  },
  twitter: {
    user_exists: [
      { key: "username", label: "Twitter/X username" },
      { key: "display_name", label: "Display name" },
      { key: "profile_url", label: "Profile URL" },
      { key: "followers", label: "Followers" },
      { key: "verified", label: "Verified" },
    ],
  },
};

function optionKey(ruleId: string, outputKey: string): string {
  return `${ruleId}:${outputKey}`;
}

function labelFromOutputKey(outputKey: string): string {
  return outputKey
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function buildSettingMap(
  settings: ValidationOutputExportSettings,
): Map<string, ValidationOutputExportSetting> {
  return new Map(
    settings.values.map((setting) => [
      optionKey(setting.rule_id, setting.output_key),
      setting,
    ]),
  );
}

function upsertOption(
  options: Map<string, ValidationOutputExportValueOption>,
  settingsByKey: Map<string, ValidationOutputExportSetting>,
  option: Omit<ValidationOutputExportValueOption, "enabled">,
) {
  const key = optionKey(option.rule_id, option.output_key);
  const existing = options.get(key);
  const setting = settingsByKey.get(key);
  options.set(key, {
    ...option,
    label:
      option.label !== ""
        ? option.label
        : (existing?.label ?? option.output_key),
    source: existing?.source === "builtin" ? existing.source : option.source,
    enabled: setting?.enabled ?? true,
  });
}

export async function getValidationOutputExportSettings(formId: string) {
  const structure = await getFormStructure(formId);
  const settings = parseValidationOutputExportSettings(
    structure.settings.validation_output_export,
  );
  const settingsByKey = buildSettingMap(settings);
  const options = new Map<string, ValidationOutputExportValueOption>();

  const { listValidationRules } = await import("./validation-rule-repository");
  const rules = await listValidationRules(formId);
  for (const rule of rules) {
    const definitions =
      BUILTIN_OUTPUT_DEFINITIONS[rule.providerName]?.[rule.ruleType] ?? [];
    for (const definition of definitions) {
      upsertOption(options, settingsByKey, {
        rule_id: rule.id,
        rule_name: rule.name,
        provider_name: rule.providerName,
        rule_type: rule.ruleType,
        output_key: definition.key,
        label: definition.label,
        source: "builtin",
      });
    }
  }

  const { db } = await import("@nexus-form/database");
  const { externalServiceValidationResult, formResponse, formValidationRule } =
    await import("@nexus-form/database/schema");

  const resultRows = await db
    .select({
      metadata: externalServiceValidationResult.metadata,
      ruleId: externalServiceValidationResult.ruleId,
      service: externalServiceValidationResult.service,
      ruleName: formValidationRule.name,
      providerName: formValidationRule.providerName,
      ruleType: formValidationRule.ruleType,
    })
    .from(externalServiceValidationResult)
    .innerJoin(
      formResponse,
      eq(externalServiceValidationResult.responseId, formResponse.id),
    )
    .leftJoin(
      formValidationRule,
      eq(externalServiceValidationResult.ruleId, formValidationRule.id),
    )
    .where(eq(formResponse.formId, formId))
    .orderBy(desc(externalServiceValidationResult.createdAt))
    .limit(VALIDATION_OUTPUT_EXPORT_RESULT_DISCOVERY_LIMIT);

  for (const row of resultRows) {
    const outputValues = parseValidationOutputValuesFromMetadata(row.metadata);
    for (const outputValue of outputValues) {
      upsertOption(options, settingsByKey, {
        rule_id: row.ruleId,
        rule_name: row.ruleName ?? row.ruleId,
        provider_name: row.providerName ?? row.service ?? UNKNOWN_PROVIDER_NAME,
        rule_type: row.ruleType ?? UNKNOWN_RULE_TYPE,
        output_key: outputValue.key,
        label: outputValue.label ?? labelFromOutputKey(outputValue.key),
        source: "result",
      });
    }
  }

  for (const setting of settings.values) {
    const key = optionKey(setting.rule_id, setting.output_key);
    if (options.has(key)) continue;
    options.set(key, {
      rule_id: setting.rule_id,
      rule_name: setting.rule_id,
      provider_name: setting.provider_name,
      rule_type: setting.rule_type,
      output_key: setting.output_key,
      label: labelFromOutputKey(setting.output_key),
      enabled: setting.enabled,
      source: "saved",
    });
  }

  return {
    settings,
    values: [...options.values()].sort((a, b) => {
      const ruleOrder = a.rule_name.localeCompare(b.rule_name);
      if (ruleOrder !== 0) return ruleOrder;
      return a.output_key.localeCompare(b.output_key);
    }),
  };
}
