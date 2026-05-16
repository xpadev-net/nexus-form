import { useMutation } from "@tanstack/react-query";
import { type FC, useState } from "react";
import { z } from "zod";

// NOTE: This component initialises its local state from `initialSettings` once
// on mount. Callers must pass `key={formId}` (or another value that changes
// with the data) to remount the component when switching forms; otherwise the
// displayed settings will reflect the stale initial values.
interface FormResponseSettingsProps {
  formId: string;
  initialSettings: {
    allowEdit: boolean;
    maxResponses: number | null;
    requireFingerprint: boolean;
  };
  onSaved?: () => void;
}

export const FormResponseSettings: FC<FormResponseSettingsProps> = ({
  formId,
  initialSettings,
  onSaved,
}) => {
  const [settings, setSettings] = useState(initialSettings);

  const saveMutation = useMutation({
    // NOTE: PATCH /:id/settings/responses はサーバー側に未定義のため raw fetch を使用
    mutationFn: async () => {
      const res = await fetch(`/api/forms/${formId}/settings/responses`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(settings),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        const err = json as { error?: string; message?: string } | null;
        throw new Error(err?.error ?? err?.message ?? `HTTP ${res.status}`);
      }
      return z.object({ success: z.boolean() }).parse(json);
    },
    onSuccess: () => {
      onSaved?.();
    },
  });

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">レスポンス設定</h3>

      <div className="space-y-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.allowEdit}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, allowEdit: e.target.checked }))
            }
            className="rounded border-input"
          />
          <span className="text-sm">回答の編集を許可する</span>
        </label>

        <div>
          <label className="block text-sm" htmlFor="maxResponses">
            最大レスポンス数
          </label>
          <input
            id="maxResponses"
            type="number"
            min={0}
            value={settings.maxResponses ?? ""}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                maxResponses: e.target.value ? Number(e.target.value) : null,
              }))
            }
            placeholder="無制限"
            className="mt-1 w-32 rounded-md border px-2 py-1 text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            0 または空欄で無制限
          </p>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.requireFingerprint}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                requireFingerprint: e.target.checked,
              }))
            }
            className="rounded border-input"
          />
          <span className="text-sm">フィンガープリントを要求する</span>
        </label>
      </div>

      <button
        type="button"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm text-primary-foreground hover:bg-blue-700 disabled:opacity-50"
      >
        {saveMutation.isPending ? "保存中..." : "設定を保存"}
      </button>

      {saveMutation.isError && (
        <p className="text-sm text-red-500">設定の保存に失敗しました</p>
      )}
    </div>
  );
};
