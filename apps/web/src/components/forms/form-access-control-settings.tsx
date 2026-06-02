import { Lock, Save, Upload } from "lucide-react";
import { type FC, type FormEvent, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useFormAccessControl } from "@/hooks/forms/use-form-access-control";

interface FormAccessControlSettingsProps {
  formId: string;
}

export const FormAccessControlSettings: FC<FormAccessControlSettingsProps> = ({
  formId,
}) => {
  const {
    passwordProtection,
    passwordProtectionPublication,
    isLoading,
    isUpdating,
    updatePasswordProtection,
  } = useFormAccessControl(formId);
  const baseId = useId();
  const toggleId = `${baseId}-password-protection`;
  const passwordId = `${baseId}-password`;
  const confirmPasswordId = `${baseId}-password-confirm`;
  const hintId = `${baseId}-password-hint`;
  const [enabled, setEnabled] = useState(passwordProtection.enabled);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordHint, setPasswordHint] = useState(
    passwordProtection.password_hint ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [showPublishNotice, setShowPublishNotice] = useState(false);

  useEffect(() => {
    setEnabled(passwordProtection.enabled);
    setPasswordHint(passwordProtection.password_hint ?? "");
    setPassword("");
    setConfirmPassword("");
    setError(null);
  }, [passwordProtection.enabled, passwordProtection.password_hint]);

  useEffect(() => {
    if (passwordProtectionPublication.isSynced) {
      setShowPublishNotice(false);
    }
  }, [passwordProtectionPublication.isSynced]);

  const handleOpenPublishMenu = () => {
    const publishMenuTrigger = document.getElementById(
      "form-publish-menu-trigger",
    );
    publishMenuTrigger?.click();
    publishMenuTrigger?.focus();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const passwordText = password.trim();
    const hasNewPassword = passwordText.length > 0;
    const shouldSendPassword = enabled && hasNewPassword;
    const hintUpdated =
      passwordHint !== (passwordProtection.password_hint ?? "");

    if (enabled && !passwordProtection.hasPassword && !hasNewPassword) {
      setError("パスワードを入力してから保護を有効にしてください");
      return;
    }

    if (shouldSendPassword && passwordText.length < 8) {
      setError("パスワードは8文字以上で入力してください");
      return;
    }

    if (shouldSendPassword && passwordText !== confirmPassword.trim()) {
      setError("確認用パスワードが一致しません");
      return;
    }

    if (
      !hintUpdated &&
      !shouldSendPassword &&
      enabled === passwordProtection.enabled
    ) {
      return;
    }

    setError(null);
    updatePasswordProtection.mutate(
      {
        enabled,
        password: shouldSendPassword ? passwordText : undefined,
        ...(hintUpdated ? { password_hint: passwordHint } : {}),
      },
      {
        onSuccess: () => {
          toast.success(
            enabled
              ? "パスワード保護を保存しました"
              : "パスワード保護を無効にしました",
          );
          setShowPublishNotice(true);
          setPassword("");
          setConfirmPassword("");
        },
        onError: (mutationError) => {
          setError(
            mutationError instanceof Error
              ? mutationError.message
              : "パスワード保護の保存に失敗しました",
          );
        },
      },
    );
  };

  const statusLabel = enabled ? "有効" : "無効";
  const hasExistingPassword = passwordProtection.hasPassword;
  const currentPublicationLabel = getPasswordProtectionStatusLabel(
    passwordProtectionPublication.current,
  );
  const publishedPublicationLabel = passwordProtectionPublication.published
    ? getPasswordProtectionStatusLabel(passwordProtectionPublication.published)
    : "公開版なし";
  const publishedHint = passwordProtectionPublication.published?.password_hint;
  const isPublishPending = !passwordProtectionPublication.isSynced;

  return (
    <section className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Lock className="h-4 w-4" />
            アクセス制御
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            公開フォームを共有パスワードで保護します。
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            パスワード保護は公開 snapshot
            の対象です。保存後、公開して反映するまで回答者には現在の公開版設定が適用されます。
          </p>
        </div>
        <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
          {statusLabel}
        </span>
      </div>

      <div className="mb-5 border-y py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              管理画面の現在設定
            </p>
            <p className="mt-1 text-sm font-medium">
              {currentPublicationLabel}
            </p>
            {passwordProtectionPublication.current.password_hint ? (
              <p className="mt-1 text-xs text-muted-foreground">
                ヒント: {passwordProtectionPublication.current.password_hint}
              </p>
            ) : null}
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              回答者に効いている公開版
            </p>
            <p className="mt-1 text-sm font-medium">
              {publishedPublicationLabel}
            </p>
            {publishedHint ? (
              <p className="mt-1 text-xs text-muted-foreground">
                ヒント: {publishedHint}
              </p>
            ) : null}
          </div>
        </div>
        {isPublishPending ? (
          <p className="mt-3 text-xs text-amber-600">
            パスワード保護に未公開の変更があります。回答者へ反映するには公開メニューから公開してください。
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            現在設定と公開版設定は一致しています。
          </p>
        )}
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <Label htmlFor={toggleId} className="text-sm font-medium">
            パスワード保護
          </Label>
          <Switch
            id={toggleId}
            checked={enabled}
            disabled={isLoading || isUpdating}
            onCheckedChange={(checked) => {
              setEnabled(checked);
              setError(null);
            }}
          />
        </div>

        {hasExistingPassword ? (
          <div className="space-y-1">
            <Label htmlFor={`${baseId}-existing-password`}>
              現在のパスワード
            </Label>
            <Input
              id={`${baseId}-existing-password`}
              type="password"
              value="••••••••"
              readOnly
              aria-readonly="true"
            />
            <p className="text-xs text-muted-foreground">
              保存済みパスワードは表示されません。変更する場合のみ新しいパスワードを入力してください。
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={passwordId}>新しいパスワード</Label>
            <Input
              id={passwordId}
              type="password"
              autoComplete="new-password"
              placeholder={
                hasExistingPassword ? "空欄なら変更なし" : "8文字以上"
              }
              value={password}
              disabled={isLoading || isUpdating}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={confirmPasswordId}>確認用パスワード</Label>
            <Input
              id={confirmPasswordId}
              type="password"
              autoComplete="new-password"
              placeholder="もう一度入力"
              value={confirmPassword}
              disabled={isLoading || isUpdating}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setError(null);
              }}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor={hintId}>ヒント</Label>
          <Input
            id={hintId}
            type="text"
            maxLength={200}
            placeholder="回答者に表示するヒント（任意）"
            value={passwordHint}
            disabled={isLoading || isUpdating}
            onChange={(event) => {
              setPasswordHint(event.target.value);
              setError(null);
            }}
          />
        </div>

        {error ? (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}

        {showPublishNotice && isPublishPending ? (
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              保存しました。回答者に反映するには、公開 snapshot
              として保存して公開版を更新してください。
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={handleOpenPublishMenu}
            >
              <Upload className="mr-2 h-4 w-4" />
              公開して反映
            </Button>
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={isLoading || isUpdating}>
            <Save className="mr-2 h-4 w-4" />
            {isUpdating ? "保存中..." : "保存"}
          </Button>
        </div>
      </form>
    </section>
  );
};

function getPasswordProtectionStatusLabel({
  enabled,
  hasPassword,
}: {
  enabled: boolean;
  hasPassword: boolean;
}): string {
  if (!enabled) return "無効";
  return hasPassword ? "有効" : "有効（パスワード未設定）";
}
