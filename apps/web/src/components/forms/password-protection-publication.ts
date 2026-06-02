export interface PasswordProtectionPublicationLike {
  enabled: boolean;
  hasPassword: boolean;
}

export function getPasswordProtectionStatusLabel({
  enabled,
  hasPassword,
}: PasswordProtectionPublicationLike): string {
  if (!enabled) return "無効";
  return hasPassword ? "有効" : "有効（パスワード未設定）";
}
