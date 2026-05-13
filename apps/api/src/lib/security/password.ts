import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

/**
 * パスワードをハッシュ化する
 * @param password プレーンテキストのパスワード
 * @returns ハッシュ化されたパスワード
 */
export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * プレーンテキストパスワードとハッシュ化されたパスワードを比較する
 * @param password プレーンテキストのパスワード
 * @param hash ハッシュ化されたパスワード
 * @returns 一致するかどうか
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}
