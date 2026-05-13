import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";

type CurrentUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  isSuspended: boolean;
};

export function SettingsPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await client.api["auth-ext"].me.$get();
        if (!response.ok) {
          throw new Error("設定情報の取得に失敗しました");
        }

        const json = (await response.json()) as { user: CurrentUser | null };
        if (!active) return;

        setUser(json.user);
        setName(json.user?.name ?? "");
      } catch (loadError) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "不明なエラーが発生しました",
        );
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    try {
      setIsSaving(true);
      setError(null);
      setSuccess(null);

      const response = await client.api["auth-ext"].me.$put({
        json: {
          name: name.trim() || undefined,
        },
      });

      if (!response.ok) {
        throw new Error("設定情報の保存に失敗しました");
      }

      const json = (await response.json()) as { user: CurrentUser | null };
      setUser(json.user);
      setName(json.user?.name ?? "");
      setSuccess("設定を保存しました。");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "不明なエラーが発生しました",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="rounded-lg border bg-card p-6">読み込み中...</div>;
  }

  return (
    <section className="rounded-lg border bg-card p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-card-foreground">設定</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        アカウントの表示名を更新できます。
      </p>

      <div className="mt-6 space-y-4">
        <label htmlFor="profile-name" className="block text-sm font-medium">
          表示名
        </label>
        <input
          id="profile-name"
          className="w-full rounded border bg-background px-3 py-2 text-sm"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
            setSuccess(null);
          }}
          placeholder="表示名を入力"
          maxLength={255}
          disabled={isSaving}
        />
        <p className="text-xs text-muted-foreground">
          メール: {user?.email ?? "-"}
        </p>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-600">{success}</p> : null}

        <Button
          type="button"
          variant="outline"
          onClick={() => void save()}
          disabled={isSaving}
        >
          {isSaving ? "保存中..." : "保存"}
        </Button>
      </div>
    </section>
  );
}
