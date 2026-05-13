import type { Response, ResponseData } from "../../types/domain/response";

export type MappingResult = {
  headers: string[];
  row: string[];
};

const RESPONSE_ID_HEADER = "Response ID";

function stringifyValue(data: ResponseData): string {
  switch (data.question_type) {
    case "short_text":
    case "long_text":
    case "radio":
    case "dropdown":
    case "date":
    case "time":
      return (data as { value?: unknown }).value?.toString?.() ?? "";
    case "linear_scale":
    case "rating":
      return (data as { value?: unknown }).value != null
        ? String((data as { value?: unknown }).value)
        : "";
    case "checkbox": {
      return Array.isArray(data.values) ? data.values.join(", ") : "";
    }
    case "choice_grid":
    case "checkbox_grid": {
      const { responses } = data as unknown as {
        responses?: Record<string, unknown>;
      };
      return JSON.stringify(responses ?? {});
    }
    default:
      return "";
  }
}

function resolveTargetHeader(item: ResponseData): string {
  const title = item.question_title?.trim();
  return title || item.question_id;
}

function ensureResponseIdHeader(headers: string[]): string[] {
  if (headers.length === 0) return [RESPONSE_ID_HEADER];
  return headers.slice();
}

export function mapResponseToRow(
  existingHeaders: string[],
  response: Response,
): MappingResult {
  const headers = ensureResponseIdHeader(existingHeaders);

  // ????????: ???????"Choice (2)" -> "Choice"?
  const suffixRegex = /^(.*) \((\d+)\)$/;
  const getBase = (name: string): string => {
    const m = name.match(suffixRegex);
    return m?.[1] ?? name;
  };

  // ??? -> ???????????????????
  const baseToIndexes = new Map<string, number[]>();
  headers.forEach((h, idx) => {
    const base = getBase(h);
    const list = baseToIndexes.get(base) ?? [];
    list.push(idx);
    baseToIndexes.set(base, list);
  });

  // ??????????????????
  const consumedIndexCount: Record<string, number> = {};

  // ????????????????????
  const usedCount: Record<string, number> = {};

  // ?? row
  const row: string[] = Array(headers.length).fill("");

  // Response ID
  const responseIdColIndex = headers.indexOf(RESPONSE_ID_HEADER);
  if (responseIdColIndex >= 0) {
    row[responseIdColIndex] = response.metadata.id;
  }

  // ?????????
  for (const item of response.responses) {
    const resolved = resolveTargetHeader(item);
    const base = getBase(resolved);
    usedCount[base] = (usedCount[base] ?? 0) + 1;
    const ordinal = usedCount[base];

    // ??????????????
    const available = baseToIndexes.get(base) ?? [];
    const consumed = consumedIndexCount[base] ?? 0;

    let colIndex: number | null = null;
    if (consumed < available.length) {
      colIndex = available[consumed] ?? null;
      consumedIndexCount[base] = consumed + 1;
    } else {
      // extend: ????????????????
      let nextName = base;
      if (headers.includes(nextName)) {
        let n = Math.max(2, ordinal);
        while (headers.includes(`${base} (${n})`)) n++;
        nextName = `${base} (${n})`;
      }
      headers.push(nextName);
      const list = baseToIndexes.get(base) ?? [];
      list.push(headers.length - 1);
      baseToIndexes.set(base, list);
      colIndex = headers.length - 1;
      // ????????????????????
      consumedIndexCount[base] = (consumedIndexCount[base] ?? 0) + 1;
    }

    const value = stringifyValue(item);
    if (colIndex != null) {
      row[colIndex] = value ?? "";
    }
  }

  // headers ???? row ???
  if (row.length < headers.length) {
    row.push(...Array(headers.length - row.length).fill(""));
  }

  return { headers, row };
}
