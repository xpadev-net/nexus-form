import type { PasswordProtectionPublicationSnapshot as PasswordProtectionPublicationSnapshotContract } from "@nexus-form/shared";

/**
 * Public API for the UI-normalized password protection publication snapshot.
 *
 * This mirrors the shared API contract while exposing the password presence flag
 * as `hasPassword` for React component callers.
 */
export type PasswordProtectionPublicationSnapshot = {
  /** Whether password protection is enabled for this current or published snapshot. */
  enabled: PasswordProtectionPublicationSnapshotContract["enabled"];
  /** Whether a saved password exists; this does not expose the password hash or value. */
  hasPassword: PasswordProtectionPublicationSnapshotContract["has_password"];
  /** Optional responder-facing hint saved with the password protection setting. */
  password_hint?: PasswordProtectionPublicationSnapshotContract["password_hint"];
};

/**
 * Public API helper that maps a password protection publication snapshot to a
 * Japanese UI label.
 *
 * @param snapshot - UI-normalized snapshot to label.
 * @returns "無効" when disabled, "有効" when enabled with a password, and
 *   "有効（パスワード未設定）" when enabled without a saved password.
 */
export function getPasswordProtectionStatusLabel({
  enabled,
  hasPassword,
}: PasswordProtectionPublicationSnapshot): string {
  if (!enabled) return "無効";
  return hasPassword ? "有効" : "有効（パスワード未設定）";
}
