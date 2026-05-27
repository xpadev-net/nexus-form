import { KeyRound } from "lucide-react";
import type { FC } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PasswordProtectionDialogProps {
  open: boolean;
  mode: "enable" | "change";
  isProcessing: boolean;
  password: string;
  passwordHint: string;
  hasCurrentPassword: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onPasswordChange: (password: string) => void;
  onHintChange: (hint: string) => void;
  onConfirm: () => void;
}

/**
 * Password protection setting dialog for a published form.
 *
 * @param props.open - Whether the dialog is visible.
 * @param props.mode - Dialog mode: `enable` to configure a new password when enabling protection, `change` to update an existing password.
 * @param props.isProcessing - Whether save/validation is currently in progress.
 * @param props.password - Current password input value.
 * @param props.passwordHint - Current hint input value.
 * @param props.hasCurrentPassword - Indicates whether an existing password was already stored for the form.
 * @param props.error - Error message to show in the dialog, or `null` when no error.
 * @param props.onOpenChange - Callback fired when the dialog open/close state changes.
 * @param props.onPasswordChange - Callback to update the password input state.
 * @param props.onHintChange - Callback to update the password hint input state.
 * @param props.onConfirm - Callback to confirm and persist the changes.
 * @returns {JSX.Element} Rendered password-protection dialog.
 */
export const PasswordProtectionDialog: FC<PasswordProtectionDialogProps> = ({
  open,
  mode,
  isProcessing,
  password,
  passwordHint,
  hasCurrentPassword,
  error,
  onOpenChange,
  onPasswordChange,
  onHintChange,
  onConfirm,
}) => {
  const title =
    mode === "enable" ? "パスワード保護を有効化" : "パスワード設定の更新";
  const description =
    mode === "enable" && !hasCurrentPassword
      ? "有効化するには新しいパスワードを入力してください"
      : "パスワードまたはヒントを更新します";
  const confirmLabel = mode === "enable" ? "有効化して保存" : "保存する";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isProcessing) {
              onConfirm();
            }
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="password-protection-password">パスワード</Label>
            <Input
              id="password-protection-password"
              type="password"
              placeholder={
                hasCurrentPassword
                  ? "変更する場合のみ入力（空欄は変更なし）"
                  : "新しいパスワードを入力"
              }
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              disabled={isProcessing}
            />
            <p className="text-xs text-muted-foreground">
              パスワードを入力する場合は8文字以上で入力してください
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="password-protection-hint">ヒント</Label>
            <Input
              id="password-protection-hint"
              type="text"
              placeholder="ヒントを入力（任意）"
              value={passwordHint}
              onChange={(e) => onHintChange(e.target.value)}
              disabled={isProcessing}
            />
          </div>

          {error ? (
            <div
              role="alert"
              aria-live="assertive"
              className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
            >
              {error}
            </div>
          ) : null}

          <DialogFooter className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isProcessing}
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={isProcessing}>
              <KeyRound className="h-4 w-4 mr-2" />
              {isProcessing ? "保存中..." : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
