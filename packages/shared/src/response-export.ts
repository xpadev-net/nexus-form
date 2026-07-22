import { isAnswerableBlockType } from "./forms/form-block";
import type { ResponseItemValidationMetadata } from "./response-data";
import {
  parseValidationOutputValuesFromMetadata,
  type ValidationOutputExportSettings,
} from "./validation-results";

export type ResponseExportRecord = {
  metadata: {
    id: string;
    form_id: string;
    respondent_uuid: string;
    submitted_at: string;
    updated_at?: string;
    country_code?: string;
    fingerprint_uuids?: Record<string, string | null>;
    ua_uuid?: string | null;
    uniqueness_score?: number;
    session_alias?: string;
  };
  component_columns: Array<{
    block_id: string;
    block_type: string;
    question_title?: string;
    value: unknown;
    display_value?: unknown;
    validation_metadata?: ResponseExportComponentValidationMetadata;
  }>;
  validation_output_columns?: ResponseExportValidationOutputValue[];
};

export type ResponseExportColumn = {
  id: string;
  title: string;
  blockType?: string;
};

export type ResponseExportComponentValidationMetadata =
  ResponseItemValidationMetadata;

/**
 * A single exportable validation output value from one validation result.
 * Missing rule/provider fields are normalized by the DB row grouping helper
 * before values reach CSV or Sheets rendering.
 */
export type ResponseExportValidationOutputValue<T = unknown> = {
  rule_id: string;
  rule_name: string;
  provider_name: string;
  rule_type: string;
  output_key: string;
  label: string;
  value: T;
};

/**
 * Stable CSV/Sheets column metadata for one selected validation output key.
 * The column ID is rule/output-key based to avoid collisions across rules.
 */
export type ResponseExportValidationOutputColumn = {
  id: string;
  title: string;
  ruleId: string;
  ruleName: string;
  providerName: string;
  ruleType: string;
  outputKey: string;
  label: string;
};

/**
 * Minimal validation result DB row shape used to normalize validation output
 * metadata without duplicating parsing semantics in API and worker code.
 */
export type ResponseExportValidationOutputRow = {
  responseId: string;
  ruleId: string;
  metadata: unknown;
  service: string | null;
  ruleName: string | null;
  providerName: string | null;
  ruleType: string | null;
};

export type ResponseExportTable = {
  headerIds: string[];
  headerTitles: string[];
  rows: string[][];
};

export type ResponseExportFormBlock = {
  blockId: string;
  category: string;
  type: string;
  content: unknown;
};

export type ResponseExportSheetMapping = {
  idRow: string[];
  titleRow: string[];
  row: string[];
  isNewLayout: boolean;
};

const FORMULA_OPERATOR_PATTERN = /^[=+\-@]/;
const LEADING_FORMULA_CONTROL_PATTERN = /^\s*[\t\r\n]/;

export function neutralizeSpreadsheetFormulaValue(value: string): string {
  if (!value) return value;

  const startsWithFormulaOperator = FORMULA_OPERATOR_PATTERN.test(
    value.trimStart(),
  );
  const startsWithFormulaControl = LEADING_FORMULA_CONTROL_PATTERN.test(value);

  return startsWithFormulaOperator || startsWithFormulaControl
    ? `'${value}`
    : value;
}

export function denormalizeSpreadsheetFormulaValue(value: string): string {
  if (!value.startsWith("'")) return value;
  const possibleOriginal = value.slice(1);
  return neutralizeSpreadsheetFormulaValue(possibleOriginal) === value
    ? possibleOriginal
    : value;
}

function neutralizeSpreadsheetFormulaValues(values: string[]): string[] {
  return values.map(neutralizeSpreadsheetFormulaValue);
}

function buildMetadataHeaders(
  fingerprintComponents: Set<string>,
  isJapanese = false,
  includeFingerprintColumns = false,
): string[] {
  const baseHeaders = isJapanese
    ? [
        "回答ID",
        "回答者UUID",
        "送信日時",
        "更新日時",
        "国コード",
        "ユニーク度スコア",
      ]
    : [
        "Response ID",
        "Respondent UUID",
        "Submitted At",
        "Updated At",
        "Country Code",
        "Uniqueness Score",
      ];

  if (!includeFingerprintColumns) {
    return baseHeaders;
  }

  const baseHeadersWithUaUuid = [
    ...baseHeaders.slice(0, 5),
    "UA UUID",
    ...baseHeaders.slice(5),
  ];

  const fingerprintHeaders = Array.from(fingerprintComponents)
    .sort()
    .map((component) => `${component} UUID`);

  return [...baseHeadersWithUaUuid, ...fingerprintHeaders];
}

function buildMetadataValues(
  record: ResponseExportRecord,
  fingerprintComponents: Set<string>,
  includeFingerprintColumns = false,
): string[] {
  const baseValues = [
    record.metadata.id,
    record.metadata.respondent_uuid,
    record.metadata.submitted_at,
    record.metadata.updated_at || "",
    record.metadata.country_code || "",
    record.metadata.uniqueness_score?.toFixed(4) || "",
  ];

  if (!includeFingerprintColumns) {
    return baseValues;
  }

  const baseValuesWithUaUuid = [
    ...baseValues.slice(0, 5),
    record.metadata.ua_uuid || "",
    ...baseValues.slice(5),
  ];

  const fingerprintValues = Array.from(fingerprintComponents)
    .sort()
    .map((component) => record.metadata.fingerprint_uuids?.[component] || "");

  return [...baseValuesWithUaUuid, ...fingerprintValues];
}

function getBlockTitle(
  block: Pick<ResponseExportFormBlock, "blockId" | "content">,
): string {
  const title = isRecord(block.content) ? block.content.title : undefined;
  return typeof title === "string" && title ? title : block.blockId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildResponseExportColumnsFromBlocks(
  formBlocks: ResponseExportFormBlock[],
): ResponseExportColumn[] {
  return formBlocks
    .filter((block) => isAnswerableBlockType(block.type))
    .map((block) => ({
      id: block.blockId,
      title: getBlockTitle(block),
      blockType: block.type,
    }));
}

function buildComponentColumnsFromRecords(
  records: ResponseExportRecord[],
  blockTitleMap: Map<string, string>,
  emptyRecordColumns: ResponseExportColumn[],
): ResponseExportColumn[] {
  const componentHeaders = new Map<string, ResponseExportColumn>();
  if (records.length === 0) {
    for (const column of emptyRecordColumns) {
      if (!componentHeaders.has(column.id)) {
        componentHeaders.set(column.id, column);
      }
    }
    return Array.from(componentHeaders.values());
  }

  for (const record of records) {
    for (const col of record.component_columns ?? []) {
      if (!componentHeaders.has(col.block_id)) {
        const blockTitle =
          col.question_title?.trim() ||
          blockTitleMap.get(col.block_id) ||
          col.block_id;
        componentHeaders.set(col.block_id, {
          id: col.block_id,
          title: blockTitle,
          blockType: col.block_type,
        });
      }
    }
  }

  return Array.from(componentHeaders.values());
}

function labelFromValidationOutputKey(outputKey: string): string {
  return outputKey
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function validationOutputSettingKey(ruleId: string, outputKey: string): string {
  return `${ruleId}:${outputKey}`;
}

function buildValidationOutputColumnId(
  ruleId: string,
  outputKey: string,
): string {
  return `validation_output:${ruleId}:${outputKey}`;
}

function buildValidationOutputColumnTitle(params: {
  ruleId: string;
  ruleName: string;
  outputKey: string;
  label: string;
}): string {
  const ruleIdentity =
    params.ruleName === params.ruleId || params.ruleName.includes(params.ruleId)
      ? params.ruleName
      : `${params.ruleName} (${params.ruleId})`;
  return `Validation: ${ruleIdentity} / ${params.label} [${params.outputKey}]`;
}

function ruleNameFromValidationOutputSetting(
  setting: ValidationOutputExportSettings["values"][number],
): string {
  // Saved settings do not include the validation rule display name. Until a
  // result row supplies one, use stable provider/type/id identity for headers.
  return `${setting.provider_name}:${setting.rule_type}:${setting.rule_id}`;
}

function toValidationOutputColumn(params: {
  ruleId: string;
  ruleName: string;
  providerName: string;
  ruleType: string;
  outputKey: string;
  label: string;
}): ResponseExportValidationOutputColumn {
  return {
    id: buildValidationOutputColumnId(params.ruleId, params.outputKey),
    title: buildValidationOutputColumnTitle(params),
    ruleId: params.ruleId,
    ruleName: params.ruleName,
    providerName: params.providerName,
    ruleType: params.ruleType,
    outputKey: params.outputKey,
    label: params.label,
  };
}

/**
 * Builds deterministic validation output columns from saved settings and
 * discovered result values.
 *
 * Missing settings keep discovered values enabled. Enabled settings without a
 * result still produce an empty column, using provider/type/rule ID as the
 * fallback rule identity until a result row can provide the display name.
 */
export function buildResponseExportValidationOutputColumns(
  settings: ValidationOutputExportSettings | undefined,
  values: readonly ResponseExportValidationOutputValue[],
): ResponseExportValidationOutputColumn[] {
  const settingsByKey = new Map(
    (settings?.values ?? []).map((setting) => [
      validationOutputSettingKey(setting.rule_id, setting.output_key),
      setting,
    ]),
  );
  const columnsByKey = new Map<string, ResponseExportValidationOutputColumn>();

  for (const setting of settings?.values ?? []) {
    if (!setting.enabled) continue;
    const key = validationOutputSettingKey(setting.rule_id, setting.output_key);
    columnsByKey.set(
      key,
      toValidationOutputColumn({
        ruleId: setting.rule_id,
        ruleName: ruleNameFromValidationOutputSetting(setting),
        providerName: setting.provider_name,
        ruleType: setting.rule_type,
        outputKey: setting.output_key,
        label: labelFromValidationOutputKey(setting.output_key),
      }),
    );
  }

  for (const value of values) {
    const key = validationOutputSettingKey(value.rule_id, value.output_key);
    const setting = settingsByKey.get(key);
    if (setting?.enabled === false) continue;
    columnsByKey.set(
      key,
      toValidationOutputColumn({
        ruleId: value.rule_id,
        ruleName: value.rule_name,
        providerName: value.provider_name,
        ruleType: value.rule_type,
        outputKey: value.output_key,
        label: value.label || labelFromValidationOutputKey(value.output_key),
      }),
    );
  }

  return [...columnsByKey.values()].sort((a, b) => {
    const ruleNameOrder = a.ruleName.localeCompare(b.ruleName);
    if (ruleNameOrder !== 0) return ruleNameOrder;
    const ruleIdOrder = a.ruleId.localeCompare(b.ruleId);
    if (ruleIdOrder !== 0) return ruleIdOrder;
    return a.outputKey.localeCompare(b.outputKey);
  });
}

/**
 * Groups parsed validation output metadata by response ID.
 *
 * Rows are expected in latest-first order; duplicate rule/output keys per
 * response keep the first value. Missing rule/provider fields fall back to the
 * rule ID, result service, or "unknown" so export rendering remains stable.
 */
export function groupResponseExportValidationOutputsByResponseId(
  rows: readonly ResponseExportValidationOutputRow[],
): Map<string, ResponseExportValidationOutputValue[]> {
  const outputsByResponseId = new Map<
    string,
    ResponseExportValidationOutputValue[]
  >();
  const seenByResponseId = new Map<string, Set<string>>();

  for (const row of rows) {
    const outputValues = parseValidationOutputValuesFromMetadata(row.metadata);
    if (outputValues.length === 0) continue;
    const seen = seenByResponseId.get(row.responseId) ?? new Set<string>();
    seenByResponseId.set(row.responseId, seen);
    const current = outputsByResponseId.get(row.responseId) ?? [];

    for (const outputValue of outputValues) {
      const key = validationOutputSettingKey(row.ruleId, outputValue.key);
      if (seen.has(key)) continue;
      seen.add(key);
      current.push({
        rule_id: row.ruleId,
        rule_name: row.ruleName ?? row.ruleId,
        provider_name: row.providerName ?? row.service ?? "unknown",
        rule_type: row.ruleType ?? "unknown",
        output_key: outputValue.key,
        label: outputValue.label ?? outputValue.key,
        value: outputValue.value,
      });
    }

    outputsByResponseId.set(row.responseId, current);
  }

  return outputsByResponseId;
}

function buildValidationOutputColumnsFromRecords(
  records: ResponseExportRecord[],
  emptyValidationOutputColumns: ResponseExportValidationOutputColumn[],
): ResponseExportValidationOutputColumn[] {
  const columns = new Map<string, ResponseExportValidationOutputColumn>();
  for (const column of emptyValidationOutputColumns) {
    columns.set(column.id, column);
  }
  for (const record of records) {
    for (const value of record.validation_output_columns ?? []) {
      const column = toValidationOutputColumn({
        ruleId: value.rule_id,
        ruleName: value.rule_name,
        providerName: value.provider_name,
        ruleType: value.rule_type,
        outputKey: value.output_key,
        label: value.label || labelFromValidationOutputKey(value.output_key),
      });
      columns.set(column.id, column);
    }
  }
  return [...columns.values()].sort((a, b) => {
    const ruleNameOrder = a.ruleName.localeCompare(b.ruleName);
    if (ruleNameOrder !== 0) return ruleNameOrder;
    const ruleIdOrder = a.ruleId.localeCompare(b.ruleId);
    if (ruleIdOrder !== 0) return ruleIdOrder;
    return a.outputKey.localeCompare(b.outputKey);
  });
}

export function normalizeResponseExportColumns(
  emptyRecordBlockIds: Array<string | ResponseExportColumn>,
  blockTitleMap: Map<string, string>,
): ResponseExportColumn[] {
  return emptyRecordBlockIds.map((column) =>
    typeof column === "string"
      ? {
          id: column,
          title: blockTitleMap.get(column) ?? column,
        }
      : column,
  );
}

export function buildResponseExportTable(
  records: ResponseExportRecord[],
  fingerprintComponents: Set<string>,
  blockTitleMap: Map<string, string>,
  emptyRecordColumns: ResponseExportColumn[] = [],
  emptyValidationOutputColumns?: ResponseExportValidationOutputColumn[],
  includeFingerprintColumns = false,
): ResponseExportTable {
  const metadataIdHeaders = buildMetadataHeaders(
    fingerprintComponents,
    false,
    includeFingerprintColumns,
  );
  const metadataTitleHeaders = buildMetadataHeaders(
    fingerprintComponents,
    true,
    includeFingerprintColumns,
  );
  const componentColumns = buildComponentColumnsFromRecords(
    records,
    blockTitleMap,
    emptyRecordColumns,
  );
  const validationOutputColumns =
    emptyValidationOutputColumns ??
    buildValidationOutputColumnsFromRecords(records, []);
  const headerIds = [
    ...metadataIdHeaders,
    ...componentColumns.map((column) => column.id),
    ...validationOutputColumns.map((column) => column.id),
  ];
  const headerTitles = [
    ...metadataTitleHeaders,
    ...componentColumns.map((column) => column.title),
    ...validationOutputColumns.map((column) => column.title),
  ];
  const rows = records.map((record) => {
    const metadataValues = buildMetadataValues(
      record,
      fingerprintComponents,
      includeFingerprintColumns,
    );
    const componentValues = componentColumns.map((column) => {
      const answer = record.component_columns?.find(
        (col) => col.block_id === column.id,
      );
      return answer
        ? stringifyResponseExportValue(
            answer.display_value ?? answer.value,
            answer.block_type,
          )
        : "";
    });
    const validationOutputValueByColumnId = new Map(
      (record.validation_output_columns ?? []).map((value) => [
        buildValidationOutputColumnId(value.rule_id, value.output_key),
        stringifyValidationOutputValue(value.value),
      ]),
    );
    const validationOutputValues = validationOutputColumns.map(
      (column) => validationOutputValueByColumnId.get(column.id) ?? "",
    );
    return neutralizeSpreadsheetFormulaValues([
      ...metadataValues,
      ...componentValues,
      ...validationOutputValues,
    ]);
  });

  return {
    headerIds: neutralizeSpreadsheetFormulaValues(headerIds),
    headerTitles: neutralizeSpreadsheetFormulaValues(headerTitles),
    rows,
  };
}

function stringifyValidationOutputValue(
  value: ResponseExportValidationOutputValue["value"],
): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function stringifyResponseExportValue(
  value: unknown,
  blockType: string,
): string {
  if (value === null || value === undefined) return "";

  switch (blockType) {
    case "short_text":
    case "long_text":
    case "radio":
    case "dropdown":
    case "date":
    case "time":
      return String(value);
    case "linear_scale":
    case "rating":
      return value != null ? String(value) : "";
    case "checkbox": {
      return Array.isArray(value) ? value.join(", ") : "";
    }
    case "choice_grid":
    case "checkbox_grid": {
      if (typeof value === "string") return value;
      return typeof value === "object" ? JSON.stringify(value) : "";
    }
    default:
      return "";
  }
}

export function mapRecordToSheetRow(
  record: ResponseExportRecord,
  existingIdRow: string[],
  blockTitleMap: Map<string, string>,
  fingerprintComponents?: Set<string>,
  existingTitleRow?: string[],
  includeFingerprintColumns = false,
): ResponseExportSheetMapping {
  const responseIdHeader = "Response ID";

  const metadataIdHeaders = fingerprintComponents
    ? buildMetadataHeaders(
        fingerprintComponents,
        false,
        includeFingerprintColumns,
      )
    : [responseIdHeader];
  const metadataTitleHeaders = fingerprintComponents
    ? buildMetadataHeaders(
        fingerprintComponents,
        true,
        includeFingerprintColumns,
      )
    : ["回答ID"];

  const suffixRegex = /^(.*) \((\d+)\)$/;
  const getBase = (name: string): string => {
    const m = name.match(suffixRegex);
    return m?.[1] ?? name;
  };
  const getTitleCountKey = (name: string): string => {
    return denormalizeSpreadsheetFormulaValue(name);
  };
  const getExistingTitleCountKey = (name: string): string => {
    return denormalizeSpreadsheetFormulaValue(getBase(name));
  };
  const reserveTitle = (
    title: string,
    usedTitleCount: Record<string, number>,
  ): void => {
    usedTitleCount[title] = (usedTitleCount[title] ?? 0) + 1;
  };
  const allocateTitle = (
    base: string,
    usedTitleCount: Record<string, number>,
  ): string => {
    let titleCount = usedTitleCount[base] ?? 0;
    let finalTitle: string;
    do {
      titleCount += 1;
      finalTitle = titleCount === 1 ? base : `${base} (${titleCount})`;
    } while (usedTitleCount[finalTitle] != null);

    usedTitleCount[base] = titleCount;
    if (finalTitle !== base) {
      reserveTitle(finalTitle, usedTitleCount);
    }
    return finalTitle;
  };

  const hasIdRow =
    existingIdRow.length > 0 && existingIdRow.includes(responseIdHeader);

  if (!hasIdRow) {
    const componentColumns = buildComponentColumnsFromRecords(
      [record],
      blockTitleMap,
      [],
    );
    const componentIds = componentColumns.map((column) => column.id);
    const rawComponentTitles = componentColumns.map((column) => column.title);
    const validationOutputColumns = buildValidationOutputColumnsFromRecords(
      [record],
      [],
    );
    const validationOutputIds = validationOutputColumns.map(
      (column) => column.id,
    );
    const rawValidationOutputTitles = validationOutputColumns.map(
      (column) => column.title,
    );

    const usedTitleCount: Record<string, number> = {};
    const outputTitles = [...rawComponentTitles, ...rawValidationOutputTitles];
    const allocatedOutputTitles = outputTitles.map((rawTitle) => {
      const base = getTitleCountKey(rawTitle);
      return allocateTitle(base, usedTitleCount);
    });

    const idRow = [
      ...metadataIdHeaders,
      ...componentIds,
      ...validationOutputIds,
    ];
    const titleRow = [...metadataTitleHeaders, ...allocatedOutputTitles];

    const rowValues: string[] = [];
    if (fingerprintComponents) {
      rowValues.push(
        ...buildMetadataValues(
          record,
          fingerprintComponents,
          includeFingerprintColumns,
        ),
      );
    } else {
      rowValues.push(record.metadata.id);
    }

    const componentValues = componentColumns.map((column) => {
      const col = record.component_columns.find(
        (c) => c.block_id === column.id,
      );
      return col
        ? stringifyResponseExportValue(
            col.display_value ?? col.value,
            col.block_type,
          )
        : "";
    });
    const validationOutputValueByColumnId = new Map(
      (record.validation_output_columns ?? []).map((value) => [
        buildValidationOutputColumnId(value.rule_id, value.output_key),
        stringifyValidationOutputValue(value.value),
      ]),
    );
    const validationOutputValues = validationOutputColumns.map(
      (column) => validationOutputValueByColumnId.get(column.id) ?? "",
    );

    const row = [...rowValues, ...componentValues, ...validationOutputValues];

    return {
      idRow: neutralizeSpreadsheetFormulaValues(idRow),
      titleRow: neutralizeSpreadsheetFormulaValues(titleRow),
      row: neutralizeSpreadsheetFormulaValues(row),
      isNewLayout: true,
    };
  }

  const idRow = existingIdRow.slice();
  const titleRow: string[] = existingTitleRow
    ? existingTitleRow.slice(0, idRow.length)
    : [];

  while (titleRow.length < idRow.length) {
    titleRow.push("");
  }

  const row: string[] = Array(idRow.length).fill("");

  const usedTitleCount: Record<string, number> = {};
  const existingTitles = new Set(
    titleRow
      .filter(Boolean)
      .map((title) => denormalizeSpreadsheetFormulaValue(title)),
  );
  for (const title of existingTitles) {
    reserveTitle(title, usedTitleCount);
  }
  for (const title of existingTitles) {
    if (!title) continue;
    const base = getExistingTitleCountKey(title);
    if (!existingTitles.has(base)) continue;
    const current = usedTitleCount[base] ?? 0;
    const maybeNumber = title.match(suffixRegex)?.[2];
    const n = maybeNumber ? Number(maybeNumber) : 1;
    usedTitleCount[base] = Math.max(current, n);
  }

  const findIdColumnIndex = (header: string): number =>
    idRow.indexOf(header) !== -1
      ? idRow.indexOf(header)
      : idRow.indexOf(neutralizeSpreadsheetFormulaValue(header));

  if (fingerprintComponents) {
    const metadataValues = buildMetadataValues(
      record,
      fingerprintComponents,
      includeFingerprintColumns,
    );
    metadataIdHeaders.forEach((header, idx) => {
      let colIndex = findIdColumnIndex(header);
      if (colIndex === -1) {
        colIndex = idRow.length;
        idRow.push(header);
        titleRow.push(metadataTitleHeaders[idx] ?? header);
        row.push("");
      }
      row[colIndex] = metadataValues[idx] ?? "";
      if (!titleRow[colIndex]) {
        titleRow[colIndex] = metadataTitleHeaders[idx] ?? header;
      }
    });
  } else {
    let colIndex = findIdColumnIndex(responseIdHeader);
    if (colIndex === -1) {
      colIndex = idRow.length;
      idRow.push(responseIdHeader);
      titleRow.push("回答ID");
      row.push("");
    }
    row[colIndex] = record.metadata.id;
    if (!titleRow[colIndex]) {
      titleRow[colIndex] = "回答ID";
    }
  }

  const idIndexByBlockId = new Map<string, number>();
  idRow.forEach((id, idx) => {
    if (!id) return;
    idIndexByBlockId.set(id, idx);
  });

  const ensureColumnForBlock = (blockId: string, title: string): number => {
    const existing =
      idIndexByBlockId.get(blockId) ??
      idIndexByBlockId.get(neutralizeSpreadsheetFormulaValue(blockId));
    const base = getTitleCountKey(title);
    if (existing != null) {
      const currentTitle = titleRow[existing] ?? "";
      const normalizedCurrentTitle =
        denormalizeSpreadsheetFormulaValue(currentTitle);
      if (
        currentTitle &&
        (normalizedCurrentTitle === base ||
          getExistingTitleCountKey(currentTitle) === base)
      ) {
        return existing;
      }

      titleRow[existing] = allocateTitle(base, usedTitleCount);
      return existing;
    }

    const finalTitle = allocateTitle(base, usedTitleCount);

    const colIndex = idRow.length;
    idRow.push(blockId);
    titleRow.push(finalTitle);
    row.push("");
    idIndexByBlockId.set(blockId, colIndex);
    return colIndex;
  };

  if (record.component_columns) {
    for (const col of record.component_columns) {
      const rawTitle =
        col.question_title?.trim() ||
        blockTitleMap.get(col.block_id) ||
        col.block_id;
      const colIndex = ensureColumnForBlock(col.block_id, rawTitle);
      const value = stringifyResponseExportValue(
        col.display_value ?? col.value,
        col.block_type,
      );
      row[colIndex] = value ?? "";
    }
  }

  const ensureColumnForValidationOutput = (
    column: ResponseExportValidationOutputColumn,
  ): number => {
    const existing =
      idIndexByBlockId.get(column.id) ??
      idIndexByBlockId.get(neutralizeSpreadsheetFormulaValue(column.id));
    const base = getTitleCountKey(column.title);
    if (existing != null) {
      const currentTitle = titleRow[existing] ?? "";
      const normalizedCurrentTitle =
        denormalizeSpreadsheetFormulaValue(currentTitle);
      if (
        currentTitle &&
        (normalizedCurrentTitle === base ||
          getExistingTitleCountKey(currentTitle) === base)
      ) {
        return existing;
      }

      titleRow[existing] = allocateTitle(base, usedTitleCount);
      return existing;
    }

    const finalTitle = allocateTitle(base, usedTitleCount);
    const colIndex = idRow.length;
    idRow.push(column.id);
    titleRow.push(finalTitle);
    row.push("");
    idIndexByBlockId.set(column.id, colIndex);
    return colIndex;
  };

  for (const column of buildValidationOutputColumnsFromRecords([record], [])) {
    const value = record.validation_output_columns?.find(
      (candidate) =>
        buildValidationOutputColumnId(
          candidate.rule_id,
          candidate.output_key,
        ) === column.id,
    );
    const colIndex = ensureColumnForValidationOutput(column);
    row[colIndex] = value ? stringifyValidationOutputValue(value.value) : "";
  }

  while (titleRow.length < idRow.length) {
    titleRow.push("");
  }
  while (row.length < idRow.length) {
    row.push("");
  }

  return {
    idRow: neutralizeSpreadsheetFormulaValues(idRow),
    titleRow: neutralizeSpreadsheetFormulaValues(titleRow),
    row: neutralizeSpreadsheetFormulaValues(row),
    isNewLayout: false,
  };
}
