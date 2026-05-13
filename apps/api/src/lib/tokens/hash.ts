import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * APIトークンをハッシュ化する
 * @param token プレーンテキストのトークン
 * @returns ハッシュ化されたトークン
 */
export async function hashToken(token: string): Promise<string> {
  const saltRounds = 12;
  return await bcrypt.hash(token, saltRounds);
}

/**
 * プレーンテキストトークンとハッシュ化されたトークンを比較する
 * @param token プレーンテキストのトークン
 * @param hash ハッシュ化されたトークン
 * @returns 一致するかどうか
 */
export async function verifyToken(
  token: string,
  hash: string,
): Promise<boolean> {
  return await bcrypt.compare(token, hash);
}

/**
 * トークンのルックアップ用SHA-256ハッシュを計算する
 * bcryptのO(n)全走査を避けるためのO(1)検索用
 * @param token プレーンテキストのトークン
 * @returns SHA-256ハッシュ（hex）
 */
export function computeLookupHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
