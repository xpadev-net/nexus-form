import { z } from "zod";

export const ADMINISTRATOR_PERMISSION = BigInt(0x8);

export const ZDiscordPermissionString = z
  .string()
  .regex(/^\d+$/, "Discord permissions must be a numeric string");

export function parseDiscordPermissionBits(permissions: unknown): bigint {
  const parsed = ZDiscordPermissionString.safeParse(permissions);
  if (!parsed.success) {
    throw new Error("Invalid Discord permissions payload");
  }

  try {
    return BigInt(parsed.data);
  } catch {
    throw new Error("Invalid Discord permissions payload");
  }
}

export function hasAdministratorPermission(
  permissions: bigint | number | string,
): boolean {
  const permissionBits =
    typeof permissions === "bigint"
      ? permissions
      : parseDiscordPermissionBits(String(permissions));
  return (
    (permissionBits & ADMINISTRATOR_PERMISSION) === ADMINISTRATOR_PERMISSION
  );
}
