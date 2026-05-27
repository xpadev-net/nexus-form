import type { AnswerEntry } from "@/contexts/form-response-context";

export type PrefillData = Record<string, AnswerEntry>;

export function isEntryEmpty(entry: AnswerEntry): boolean {
  return (
    entry.value === undefined &&
    entry.values === undefined &&
    entry.responses === undefined &&
    entry.other_value === undefined &&
    entry.other_values === undefined
  );
}

function isValidScalar(v: unknown): boolean {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

function isValidAnswerEntry(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (
    "value" in entry &&
    entry.value !== undefined &&
    !isValidScalar(entry.value)
  )
    return false;
  if (
    "values" in entry &&
    entry.values !== undefined &&
    !Array.isArray(entry.values)
  )
    return false;
  if ("responses" in entry && entry.responses !== undefined) {
    if (
      typeof entry.responses !== "object" ||
      entry.responses === null ||
      Array.isArray(entry.responses)
    )
      return false;
  }
  if (
    "other_value" in entry &&
    entry.other_value !== undefined &&
    typeof entry.other_value !== "string"
  )
    return false;
  if (
    "other_values" in entry &&
    entry.other_values !== undefined &&
    !Array.isArray(entry.other_values)
  )
    return false;
  return true;
}

function base64UrlEncode(uint8: Uint8Array): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let result = "";
  for (let i = 0; i < uint8.length; i += 3) {
    const b1 = uint8[i] ?? 0;
    const b2 = i + 1 < uint8.length ? (uint8[i + 1] ?? 0) : 0;
    const b3 = i + 2 < uint8.length ? (uint8[i + 2] ?? 0) : 0;
    result += chars[b1 >> 2];
    result += chars[((b1 & 3) << 4) | (b2 >> 4)];
    result += chars[((b2 & 15) << 2) | (b3 >> 6)];
    result += chars[b3 & 63];
  }
  const rem = uint8.length % 3;
  if (rem === 1) result = result.slice(0, -2);
  else if (rem === 2) result = result.slice(0, -1);
  return result;
}

function base64UrlDecode(str: string): Uint8Array {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const map: Record<string, number> = {};
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch != null) map[ch] = i;
  }

  const len = str.length;
  const bytes: number[] = [];
  for (let i = 0; i < len; i += 4) {
    const c1 = map[str[i] ?? ""] ?? 0;
    const c2 = map[str[i + 1] ?? ""] ?? 0;
    const c3 = map[str[i + 2] ?? ""] ?? 0;
    const c4 = map[str[i + 3] ?? ""] ?? 0;
    bytes.push((c1 << 2) | (c2 >> 4));
    if (i + 2 < len) bytes.push(((c2 & 15) << 4) | (c3 >> 2));
    if (i + 3 < len) bytes.push(((c3 & 3) << 6) | c4);
  }
  return new Uint8Array(bytes);
}

export function encodePrefillData(data: PrefillData): string {
  const json = JSON.stringify(data);
  const encoder = new TextEncoder();
  const uint8 = encoder.encode(json);
  return base64UrlEncode(uint8);
}

export function decodePrefillData(encoded: string): PrefillData | null {
  try {
    const uint8 = base64UrlDecode(encoded);
    const decoder = new TextDecoder();
    const json = decoder.decode(uint8);
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    for (const value of Object.values(parsed)) {
      if (!isValidAnswerEntry(value)) return null;
    }
    return parsed as PrefillData;
  } catch {
    return null;
  }
}
