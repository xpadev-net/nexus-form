export interface PasswordProtectionPublicationSnapshot {
  enabled: boolean;
  hasPassword: boolean;
  password_hint?: string;
}

export function getPasswordProtectionStatusLabel({
  enabled,
  hasPassword,
}: PasswordProtectionPublicationSnapshot): string {
  if (!enabled) return "無効";
  return hasPassword ? "有効" : "有効（パスワード未設定）";
}
