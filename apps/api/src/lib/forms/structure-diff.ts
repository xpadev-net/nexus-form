/**
 * 構造の差分を生成
 *
 * トップレベルのすべてのキーを比較し、追加・削除・変更を検出する。
 */

/**
 * キー順序に依存しない安定した JSON 文字列化
 *
 * JSON.parse 経由のデータのみを対象とする。`undefined` 値のキーは
 * 出力から除外されるため、`{ a: 1, b: undefined }` と `{ a: 1 }` は
 * 同一文字列になる。非 JSON-safe な値（`undefined`, `Date` 等）を含む
 * オブジェクトを渡すと差分が正しく検出されない場合がある。
 */
function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const sorted = Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${sorted.join(",")}}`;
}

export function generateStructureDiff(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
) {
  const changes: Array<{
    type: "added" | "removed" | "modified";
    path: string;
    from?: unknown;
    to?: unknown;
  }> = [];

  const allKeys = new Set([...Object.keys(from), ...Object.keys(to)]);

  for (const key of allKeys) {
    const inFrom = Object.hasOwn(from, key);
    const inTo = Object.hasOwn(to, key);

    if (!inFrom) {
      changes.push({ type: "added", path: key, to: to[key] });
    } else if (!inTo) {
      changes.push({ type: "removed", path: key, from: from[key] });
    } else if (stableStringify(from[key]) !== stableStringify(to[key])) {
      changes.push({
        type: "modified",
        path: key,
        from: from[key],
        to: to[key],
      });
    }
  }

  return changes;
}
