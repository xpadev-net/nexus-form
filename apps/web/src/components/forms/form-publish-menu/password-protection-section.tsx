import { KeyRound, Lock } from "lucide-react";
import { type FC, useId } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { PasswordProtectionSectionState } from "./types";

interface PasswordProtectionSectionProps {
  state: PasswordProtectionSectionState;
  onToggle: (checked: boolean) => void;
  onOpenDialog: (mode: "enable" | "change") => void;
}

/**
 * Password protection control section in the publish menu.
 * The actual password text/hint editing itself is delegated to the dialog.
 */
export const PasswordProtectionSection: FC<PasswordProtectionSectionProps> = ({
  state,
  onToggle,
  onOpenDialog,
}) => {
  const isBusy = state.updateState === "processing";
  const isPublishBusy = state.publishActionState === "processing";
  const baseId = useId();
  const passwordToggleId = `${baseId}-password-toggle`;

  const dialogMode: "enable" | "change" = state.isEnabled ? "change" : "enable";
  const buttonLabel =
    dialogMode === "enable" ? "パスワードを設定" : "パスワードを編集";
  const statusLabel = state.isEnabled ? "有効" : "無効";
  const description = state.isEnabled
    ? "保存されたパスワードを使用して保護中です"
    : state.hasPassword
      ? "パスワード保護は現在無効です"
      : "有効化のため、パスワードを入力してください";

  return (
    <>
      <Separator />
      <div className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <label
              htmlFor={passwordToggleId}
              className="flex items-center gap-2 text-sm font-medium"
            >
              <Lock className="h-4 w-4" />
              パスワード保護
            </label>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <Switch
            id={passwordToggleId}
            size="sm"
            checked={state.isEnabled}
            disabled={isBusy || isPublishBusy}
            onCheckedChange={onToggle}
          />
        </div>

        <div className="pl-6 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{statusLabel}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            disabled={isBusy || isPublishBusy}
            onClick={() => onOpenDialog(dialogMode)}
          >
            <KeyRound className="h-3.5 w-3.5" />
            {buttonLabel}
          </Button>
        </div>
      </div>
    </>
  );
};
