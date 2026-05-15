import { z } from "zod";

/**
 * DB の `Date` 列をレスポンス用に ISO-8601 文字列へ変換するスキーマ。
 *
 * `.parse()` には Drizzle が返す `Date` を渡し、出力は文字列になる。
 * これにより `z.infer` 型（=Hono RPC がクライアントへ伝える型）が、
 * `c.json()` が実際に送出するワイヤ形式（ISO 文字列）と一致する。
 */
export const isoDate = z.date().transform((d) => d.toISOString());
