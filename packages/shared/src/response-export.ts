import { isAnswerableBlockType } from "./forms/form-block";

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
  }>;
};

export type ResponseExportColumn = {
  id: string;
  title: string;
  blockType?: string;
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

function neutralizeSpreadsheetFormulaValues(values: string[]): string[] {
  return values.map(neutralizeSpreadsheetFormulaValue);
}

function buildMetadataHeaders(
  fingerprintComponents: Set<string>,
  isJapanese = false,
): string[] {
  const baseHeaders = isJapanese
    ? [
        "回答ID",
        "回答者UUID",
        "送信日時",
        "更新日時",
        "国コード",
        "UA UUID",
        "ユニーク度スコア",
      ]
    : [
        "Response ID",
        "Respondent UUID",
        "Submitted At",
        "Updated At",
        "Country Code",
        "UA UUID",
        "Uniqueness Score",
      ];

  const fingerprintHeaders = Array.from(fingerprintComponents)
    .sort()
    .map((component) => `${component} UUID`);

  return [...baseHeaders, ...fingerprintHeaders];
}

function buildMetadataValues(
  record: ResponseExportRecord,
  fingerprintComponents: Set<string>,
): string[] {
  const baseValues = [
    record.metadata.id,
    record.metadata.respondent_uuid,
    record.metadata.submitted_at,
    record.metadata.updated_at || "",
    record.metadata.country_code || "",
    record.metadata.ua_uuid || "",
    record.metadata.uniqueness_score?.toFixed(4) || "",
  ];

  const fingerprintValues = Array.from(fingerprintComponents)
    .sort()
    .map((component) => record.metadata.fingerprint_uuids?.[component] || "");

  return [...baseValues, ...fingerprintValues];
}

function getBlockTitle(
  block: Pick<ResponseExportFormBlock, "blockId" | "content">,
) {
  const content =
    block.content && typeof block.content === "object"
      ? (block.content as Record<string, unknown>)
      : null;
  return (content?.title as string) || block.blockId;
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
): ResponseExportTable {
  const metadataIdHeaders = buildMetadataHeaders(fingerprintComponents, false);
  const metadataTitleHeaders = buildMetadataHeaders(
    fingerprintComponents,
    true,
  );
  const componentColumns = buildComponentColumnsFromRecords(
    records,
    blockTitleMap,
    emptyRecordColumns,
  );
  const headerIds = [
    ...metadataIdHeaders,
    ...componentColumns.map((column) => column.id),
  ];
  const headerTitles = [
    ...metadataTitleHeaders,
    ...componentColumns.map((column) => column.title),
  ];
  const rows = records.map((record) => {
    const metadataValues = buildMetadataValues(record, fingerprintComponents);
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
    return neutralizeSpreadsheetFormulaValues([
      ...metadataValues,
      ...componentValues,
    ]);
  });

  return {
    headerIds: neutralizeSpreadsheetFormulaValues(headerIds),
    headerTitles: neutralizeSpreadsheetFormulaValues(headerTitles),
    rows,
  };
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
): ResponseExportSheetMapping {
  const responseIdHeader = "Response ID";

  const metadataIdHeaders = fingerprintComponents
    ? buildMetadataHeaders(fingerprintComponents, false)
    : [responseIdHeader];
  const metadataTitleHeaders = fingerprintComponents
    ? buildMetadataHeaders(fingerprintComponents, true)
    : ["回答ID"];

  const suffixRegex = /^(.*) \((\d+)\)$/;
  const getBase = (name: string): string => {
    const m = name.match(suffixRegex);
    return m?.[1] ?? name;
  };
  const getTitleCountKey = (name: string): string => {
    const base = getBase(name);
    if (!base.startsWith("'")) return base;

    const possibleOriginal = base.slice(1);
    return neutralizeSpreadsheetFormulaValue(possibleOriginal) === base
      ? possibleOriginal
      : base;
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

    const usedTitleCount: Record<string, number> = {};
    const componentTitles = rawComponentTitles.map((rawTitle) => {
      const base = getTitleCountKey(rawTitle);
      usedTitleCount[base] = (usedTitleCount[base] ?? 0) + 1;
      const titleCount = usedTitleCount[base];
      return titleCount === 1 ? base : `${base} (${titleCount})`;
    });

    const idRow = [...metadataIdHeaders, ...componentIds];
    const titleRow = [...metadataTitleHeaders, ...componentTitles];

    const rowValues: string[] = [];
    if (fingerprintComponents) {
      rowValues.push(...buildMetadataValues(record, fingerprintComponents));
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

    const row = [...rowValues, ...componentValues];

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
  for (const title of titleRow) {
    if (!title) continue;
    const base = getTitleCountKey(title);
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
    const metadataValues = buildMetadataValues(record, fingerprintComponents);
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
    if (existing != null) return existing;

    const base = getTitleCountKey(title);
    usedTitleCount[base] = (usedTitleCount[base] ?? 0) + 1;
    const titleCount = usedTitleCount[base];
    const finalTitle = titleCount === 1 ? base : `${base} (${titleCount})`;

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
