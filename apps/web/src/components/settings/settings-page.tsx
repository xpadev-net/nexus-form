import { useEffect, useReducer } from "react";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import { client } from "@/lib/api";

type CurrentUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  isSuspended: boolean;
};

type SettingsState = {
  user: CurrentUser | null;
  name: string;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  success: string | null;
};

type SettingsAction =
  | { type: "load-start" }
  | { type: "load-success"; user: CurrentUser | null }
  | { type: "load-error"; message: string }
  | { type: "name-change"; name: string }
  | { type: "save-start" }
  | { type: "save-success"; user: CurrentUser | null }
  | { type: "save-error"; message: string };

const initialSettingsState: SettingsState = {
  user: null,
  name: "",
  isLoading: true,
  isSaving: false,
  error: null,
  success: null,
};

const settingsReducer = (
  state: SettingsState,
  action: SettingsAction,
): SettingsState => {
  switch (action.type) {
    case "load-start":
      return { ...state, isLoading: true, error: null };
    case "load-success":
      return {
        ...state,
        user: action.user,
        name: action.user?.name ?? "",
        isLoading: false,
      };
    case "load-error":
      return { ...state, isLoading: false, error: action.message };
    case "name-change":
      return {
        ...state,
        name: action.name,
        error: null,
        success: null,
      };
    case "save-start":
      return { ...state, isSaving: true, error: null, success: null };
    case "save-success":
      return {
        ...state,
        user: action.user,
        name: action.user?.name ?? "",
        isSaving: false,
        success: "設定を保存しました。",
      };
    case "save-error":
      return { ...state, isSaving: false, error: action.message };
  }
};

export function SettingsPage() {
  usePageTitle("設定");
  const [state, dispatch] = useReducer(settingsReducer, initialSettingsState);
  const { error, isLoading, isSaving, name, success, user } = state;

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        dispatch({ type: "load-start" });

        const response = await client.api["auth-ext"].me.$get();
        if (!response.ok) {
          throw new Error("設定情報の取得に失敗しました");
        }

        const json = (await response.json()) as { user: CurrentUser | null };
        if (!active) return;

        dispatch({ type: "load-success", user: json.user });
      } catch (loadError) {
        if (!active) return;
        dispatch({
          type: "load-error",
          message:
            loadError instanceof Error
              ? loadError.message
              : "不明なエラーが発生しました",
        });
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    try {
      dispatch({ type: "save-start" });

      const response = await client.api["auth-ext"].me.$put({
        json: {
          name: name.trim() || undefined,
        },
      });

      if (!response.ok) {
        throw new Error("設定情報の保存に失敗しました");
      }

      const json = (await response.json()) as { user: CurrentUser | null };
      dispatch({ type: "save-success", user: json.user });
    } catch (saveError) {
      dispatch({
        type: "save-error",
        message:
          saveError instanceof Error
            ? saveError.message
            : "不明なエラーが発生しました",
      });
    }
  };

  return isLoading ? (
    <div className="rounded-lg border bg-card p-6">読み込み中...</div>
  ) : (
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
            dispatch({ type: "name-change", name: event.target.value });
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
