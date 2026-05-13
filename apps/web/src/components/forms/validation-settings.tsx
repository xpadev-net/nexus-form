import { Settings } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface ValidationSettingsProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export function ValidationSettings({
  enabled,
  onEnabledChange,
}: ValidationSettingsProps) {
  return (
    <div className="space-y-3 rounded border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Settings className="h-4 w-4" />
        バリデーション設定
      </h3>
      <div className="flex items-center justify-between">
        <Label
          htmlFor="validation-enabled"
          className="flex flex-col gap-1 text-sm"
        >
          <span>外部サービスバリデーション</span>
          <span className="font-normal text-muted-foreground">
            回答送信時に外部サービスによる検証を実行します
          </span>
        </Label>
        <Switch
          id="validation-enabled"
          checked={enabled}
          onCheckedChange={onEnabledChange}
        />
      </div>
    </div>
  );
}
