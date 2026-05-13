/**
 * Discord権限定数
 * discord.jsに依存しない実装
 */

/**
 * 管理者権限（ADMINISTRATOR）
 * Discord APIの権限フラグ: 0x8
 */
export const ADMINISTRATOR_PERMISSION = BigInt(0x8);

/**
 * 管理者権限を持っているかチェック
 * @param permissions 権限ビット
 * @returns 管理者権限を持っているかどうか
 */
export function hasAdministratorPermission(
  permissions: bigint | number | string,
): boolean {
  const permissionBits =
    typeof permissions === "string" ? BigInt(permissions) : BigInt(permissions);
  return (
    (permissionBits & ADMINISTRATOR_PERMISSION) === ADMINISTRATOR_PERMISSION
  );
}
