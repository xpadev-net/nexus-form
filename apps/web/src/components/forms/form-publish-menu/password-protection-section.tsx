import { KeyRound, Lock } from "lucide-react";
import { type FC, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { PasswordProtectionSectionState } from "./types";

interface PasswordProtectionSectionProps {
  state: PasswordProtectionSectionState;
  onToggle: (checked: boolean) => void;
  onPasswordChange: (value: string) => void;
  onHintChange: (value: string) => void;
  onSave: () => void;
}

/**
 * Renders password-protection controls for the publish menu.
 *
 * The component owns only presentation and delegates all mutation work through
 * its callbacks. Callers must pass the derived section state from the publish
 * menu model so publish and password update busy states stay synchronized.
 */
export const PasswordProtectionSection: FC<PasswordProtectionSectionProps> = ({
  state,
  onToggle,
  onPasswordChange,
  onHintChange,
  onSave,
}) => {
  const isBusy = state.updateState === "processing";
  const isPublishBusy = state.publishActionState === "processing";
  const baseId = useId();
  const passwordToggleId = `${baseId}-password-toggle`;
  const passwordInputId = `${baseId}-password-input`;
  const passwordHintInputId = `${baseId}-password-hint-input`;

  return (
    <>
      <Separator />
      <div className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <Label
            htmlFor={passwordToggleId}
            className="flex items-center gap-2 text-sm font-medium"
          >
            <Lock className="h-4 w-4" />
            パスワード保護
          </Label>
          <Switch
            id={passwordToggleId}
            size="sm"
            checked={state.isEnabled}
            disabled={isBusy || isPublishBusy}
            onCheckedChange={onToggle}
          />
        </div>
        {(state.isEnabled || !state.hasPassword) && (
          <div className="space-y-2 pl-6">
            <div className="space-y-1">
              <Label htmlFor={passwordInputId} className="text-xs">
                パスワード
              </Label>
              <div className="flex gap-1">
                <Input
                  id={passwordInputId}
                  type="password"
                  placeholder={
                    state.hasPassword
                      ? "変更する場合のみ入力"
                      : "パスワードを入力"
                  }
                  value={state.input}
                  onChange={(e) => onPasswordChange(e.target.value)}
                  className="h-8 text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0"
                  disabled={
                    isBusy || isPublishBusy || (!state.input && !state.isDirty)
                  }
                  onClick={onSave}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor={passwordHintInputId} className="text-xs">
                ヒント
              </Label>
              <Input
                id={passwordHintInputId}
                type="text"
                placeholder="パスワードのヒント（任意）"
                value={state.hintInput}
                onChange={(e) => onHintChange(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
};
