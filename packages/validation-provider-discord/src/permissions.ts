export const ADMINISTRATOR_PERMISSION = BigInt(0x8);

export function hasAdministratorPermission(
  permissions: bigint | number | string,
): boolean {
  const permissionBits =
    typeof permissions === "string" ? BigInt(permissions) : BigInt(permissions);
  return (
    (permissionBits & ADMINISTRATOR_PERMISSION) === ADMINISTRATOR_PERMISSION
  );
}
